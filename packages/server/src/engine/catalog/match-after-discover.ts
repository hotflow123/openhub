/**
 * 模型发现后批量匹配目录
 *
 * DESIGN 第 7 章：
 *   catalog_match_confidence 字段是 high | medium | low 字符串
 *   catalog_match_source 可以是 exact | normalized | alias | keyword | null
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index";
import { modelCatalog, models } from "../../db/schema/index";
import { matchModel } from "@openhub/catalog/matcher";
import { matcherDb } from "./db-adapter";
import { buildCatalogProfileUpdate, clearCatalogProfileUpdate } from "./profile";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { matchParameterTemplates } from "./parameter-template-matcher";
import { getProviderAdapterRegistration } from "../adapter-manifest";
import { modelParameterTemplates } from "../../db/schema/index";
import type { OpenGenerativeAiSnapshot } from "@openhub/catalog/parameter-template";

export function getOpenGenerativeAiSnapshotPath(): string {
  return process.env.OPENHUB_PARAMETER_TEMPLATE_SNAPSHOT_PATH?.trim()
    || fileURLToPath(new URL("../../../../catalog/data/open-generative-ai.snapshot.json", import.meta.url));
}

export async function loadOpenGenerativeAiSnapshot(): Promise<OpenGenerativeAiSnapshot> {
  const path = getOpenGenerativeAiSnapshotPath();
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Open-Generative-AI snapshot load failed at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!snapshot || typeof snapshot !== "object" || (snapshot as OpenGenerativeAiSnapshot).source !== "open-generative-ai" || !Array.isArray((snapshot as OpenGenerativeAiSnapshot).records) || typeof (snapshot as OpenGenerativeAiSnapshot).snapshotSha256 !== "string") {
    throw new Error(`Open-Generative-AI snapshot is invalid at ${path}`);
  }
  return snapshot as OpenGenerativeAiSnapshot;
}

export async function syncOpenGenerativeAiCandidatesForSite(siteId: string): Promise<{ synced: number; snapshotSha256: string }> {
  const snapshot = await loadOpenGenerativeAiSnapshot();
  const rows = await db.select().from(models).where(eq(models.siteId, siteId));
  let count = 0;
  for (const model of rows) {
    const registration = getProviderAdapterRegistration(model.adapterId === "openai-compatible" ? "memefast" : model.adapterId) ?? null;
    for (const item of matchParameterTemplates({ model, templates: snapshot.records, registration })) {
      const id = `pt_${nanoid(12)}`;
      const matchStatus = item.compatibility.decision === "confirmed" ? "confirmed" : item.compatibility.decision;
      await db.insert(modelParameterTemplates).values({
        id,
        modelId: model.id,
        source: "open_generative_ai",
        sourceModelId: item.template.sourceModelId,
        sourceCollection: item.template.sourceCollection,
        operation: item.template.operation,
        modality: item.template.modality,
        templateSnapshot: JSON.stringify(item.template),
        fieldMapping: JSON.stringify(item.compatibility.fieldMapping),
        matchStatus,
        matchConfidence: item.confidence,
        matchReason: item.compatibility.reasons.join(","),
        sourceCommit: snapshot.sourceCommit,
        sourceFileSha256: snapshot.sourceFileSha256,
        snapshotSha256: snapshot.snapshotSha256,
        syncedAt: new Date(),
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [modelParameterTemplates.modelId, modelParameterTemplates.source, modelParameterTemplates.sourceModelId, modelParameterTemplates.operation],
        set: {
          templateSnapshot: JSON.stringify(item.template),
          fieldMapping: JSON.stringify(item.compatibility.fieldMapping),
          matchStatus: sql`CASE WHEN ${modelParameterTemplates.matchStatus} = 'applied' AND ${modelParameterTemplates.snapshotSha256} = ${snapshot.snapshotSha256} THEN 'applied' ELSE ${matchStatus} END`,
          matchConfidence: item.confidence,
          matchReason: item.compatibility.reasons.join(","),
          sourceCommit: snapshot.sourceCommit,
          sourceFileSha256: snapshot.sourceFileSha256,
          snapshotSha256: snapshot.snapshotSha256,
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      count++;
    }
  }
  return { synced: count, snapshotSha256: snapshot.snapshotSha256 };
}

export async function matchModelsForSite(siteId: string): Promise<{
  matched: number;
  unmatched: number;
  parameterTemplatesSynced: number;
  parameterTemplateSnapshotSha256: string;
}> {
  const rows = await db
    .select()
    .from(models)
    .where(eq(models.siteId, siteId));

  let matched = 0;
  let unmatched = 0;

  for (const row of rows) {
    if (row.catalogMatchSource === "admin" && row.catalogModelId) {
      matched++;
      continue;
    }

    const result = await matchModel(matcherDb, row.rawName, {
      modality: row.modality,
    });

    if (result.catalogModelId && result.confidence >= 0.9) {
      const confidence =
        result.confidence >= 0.9 ? "high" : result.confidence >= 0.6 ? "medium" : "low";
      const [catalog] = await db
        .select({
          labName: modelCatalog.labName,
          family: modelCatalog.family,
          contextLimit: modelCatalog.contextLimit,
          outputLimit: modelCatalog.outputLimit,
          reasoning: modelCatalog.reasoning,
          toolCall: modelCatalog.toolCall,
          modalitiesIn: modelCatalog.modalitiesIn,
          modalitiesOut: modelCatalog.modalitiesOut,
        })
        .from(modelCatalog)
        .where(eq(modelCatalog.id, result.catalogModelId))
        .limit(1);
      const profileUpdate = catalog
        ? buildCatalogProfileUpdate(row, catalog, confidence)
        : {};
    const catalogConfirmsIdentity = result.source === "exact"
      || result.source === "normalized"
      || (result.source === "alias" && ["exact", "provider_id", "slug", "legacy", "manual"].includes(result.aliasType ?? ""))
      || (result.source === "structured" && result.confidence >= 0.9);
      const hasStrongIdentity = ["adapter-manifest", "runtime", "admin"].includes(row.modelIdentitySource ?? "")
        || (row.modelIdentitySource === "name"
          && row.modelIdentityStatus === "recognized"
          && row.modelIdentityReason === "model_name_identity_match");
      const identityUpdate = catalogConfirmsIdentity || hasStrongIdentity
        ? {}
        : {
          modelIdentityStatus: "ambiguous" as const,
          modelIdentitySource: "catalog",
          modelIdentityReason: `catalog_${result.source}_candidate`,
        };
      await db
        .update(models)
        .set({
          catalogModelId: result.catalogModelId,
          catalogMatchSource: result.source,
          catalogMatchConfidence: confidence,
          catalogSyncedAt: new Date(),
          ...(catalogConfirmsIdentity
            ? {
              modelIdentityStatus: "recognized" as const,
              modelIdentitySource: "catalog",
              modelIdentityReason: `catalog_${result.source}_match`,
            }
            : identityUpdate),
          ...profileUpdate,
          updatedAt: new Date(),
        })
        .where(eq(models.id, row.id));
      matched++;
    } else {
      await db
        .update(models)
        .set({
          catalogModelId: null,
          catalogMatchSource: "none",
          catalogMatchConfidence: null,
          catalogSyncedAt: new Date(),
          ...clearCatalogProfileUpdate(row),
          updatedAt: new Date(),
        })
        .where(eq(models.id, row.id));
      unmatched++;
    }
  }

  const templateSync = await syncOpenGenerativeAiCandidatesForSite(siteId);
  return {
    matched,
    unmatched,
    parameterTemplatesSynced: templateSync.synced,
    parameterTemplateSnapshotSha256: templateSync.snapshotSha256,
  };
}
