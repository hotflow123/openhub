/**
 * fal.ai Schema 匹配器
 *
 * 将站点发现的原始模型名映射到 fal.ai 百科的 endpointId，
 * 从而获得该模型的完整 API 参数结构（input_schema / parameters）。
 *
 * 匹配链路：
 *   站点 rawName
 *     -> 归一化
 *     -> 查询 model_schema_alias.normalized
 *     -> 返回 endpointId + aliasType
 *
 * 与 model_catalog 的区别：
 *   - model_catalog：模型身份（厂商/家族/能力标志），用于路由和显示
 *   - model_schema_catalog：模型调用（参数结构），用于表单和参数映射
 *   - 两者独立匹配，同一 rawName 可能同时匹配两者
 */

import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { modelSchemaCatalog, modelSchemaAlias, models } from "../../db/schema/index.js";
import {
  normalize,
  rankModelCandidates,
  type ModelIdentityCandidate,
} from "@openhub/catalog/matcher";

export interface SchemaCatalogCandidate {
  endpointId: string;
  title: string;
  modality: string;
  pricing: string | null;
  parameters: string | null;
  falCategory: string | null;
  falSource: string | null;
}

export interface SchemaMatchResult {
  /** fal.ai 验证后的 endpointId（如 "bytedance/seedance-2.5/text-to-video"）*/
  endpointId: string;
  /** 别名来源（bytedance | kling | wan | hailuo | auto）*/
  aliasType: string;
  /** fal.ai Schema 标题 */
  title: string | null;
  /** modality */
  modality: string | null;
  /** 定价信息 */
  pricing: string | null;
  /** 完整输入参数列表（扁平化） */
  parameters: Array<{
    name: string;
    type: string;
    required: boolean;
    description?: string;
    default?: unknown;
    enum?: unknown[];
  }>;
  /** fal category */
  falCategory: string | null;
  /** fal source（queue/realtime） */
  falSource: string | null;
  /** 匹配证据状态 */
  status: "candidate" | "confirmed";
  confidence: "high" | "medium" | "low";
  reason: string;
  aliasSource: string;
}

export interface SchemaMatchOptions {
  modality?: string | null;
  candidates?: readonly SchemaCatalogCandidate[];
}

/**
 * Fal snapshots describe a specific endpoint, not merely a similarly named
 * upstream model. Keep candidates visible for review, but never leave their
 * old snapshot-derived limits active.
 */
function clearUnconfirmedSchemaCapabilities() {
  return {
    schemaSyncedAt: null,
    falParametersSnapshot: null,
    falInputSchemaSnapshot: null,
    falPricing: null,
    falDescription: null,
    falSource: null,
    videoDurationEnum: null,
    videoAspectRatios: null,
    videoResolutions: null,
    videoRequiredParams: null,
    videoOptionalParams: null,
    generateAudioSupported: 0,
    maxReferenceImages: null,
    maxReferenceVideos: null,
    maxReferenceAudios: null,
  };
}

export async function loadSchemaCandidates(): Promise<SchemaCatalogCandidate[]> {
  return db
    .select({
      endpointId: modelSchemaCatalog.endpointId,
      title: modelSchemaCatalog.title,
      modality: modelSchemaCatalog.modality,
      pricing: modelSchemaCatalog.pricing,
      parameters: modelSchemaCatalog.parameters,
      falCategory: modelSchemaCatalog.falCategory,
      falSource: modelSchemaCatalog.falSource,
    })
    .from(modelSchemaCatalog)
    .where(eq(modelSchemaCatalog.status, "ok"));
}

function identityCandidate(row: SchemaCatalogCandidate): ModelIdentityCandidate {
  return {
    id: row.endpointId,
    name: row.title,
    family: row.falCategory,
    modality: row.modality,
  };
}

function parseParameters(value: string | null): SchemaMatchResult["parameters"] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildSchemaMatch(
  schemaRow: SchemaCatalogCandidate,
  metadata: {
    aliasType: string;
    aliasSource: string;
    confidence: SchemaMatchResult["confidence"];
    reason: string;
  },
): SchemaMatchResult {
  return {
    endpointId: schemaRow.endpointId,
    aliasType: metadata.aliasType,
    title: schemaRow.title,
    modality: schemaRow.modality,
    pricing: schemaRow.pricing,
    parameters: parseParameters(schemaRow.parameters),
    falCategory: schemaRow.falCategory,
    falSource: schemaRow.falSource,
    status: "candidate",
    confidence: metadata.confidence,
    reason: metadata.reason,
    aliasSource: metadata.aliasSource,
  };
}

function modalityMatches(queryModality: string | null | undefined, schema: SchemaCatalogCandidate): boolean {
  if (!queryModality || queryModality === "unknown") return true;
  return schema.modality === queryModality;
}

/**
 * 将原始模型名匹配到 fal.ai Schema。
 *
 * Exact aliases remain the first choice. If no alias exists, the same generic
 * token/version matcher used by the model catalog supplies a reviewable
 * candidate instead of requiring one alias per upstream naming convention.
 */
export async function matchSchema(
  rawName: string,
  options: SchemaMatchOptions = {},
): Promise<SchemaMatchResult | null> {
  const normalized = normalize(rawName);
  const candidates = options.candidates ?? (await loadSchemaCandidates());
  const rowsByEndpoint = new Map(candidates.map((row) => [row.endpointId, row]));

  // Step 1: 归一化精确匹配
  const aliasRows = await db
    .select({
      endpointId: modelSchemaAlias.endpointId,
      aliasType: modelSchemaAlias.aliasType,
      alias: modelSchemaAlias.alias,
      source: modelSchemaAlias.source,
    })
    .from(modelSchemaAlias)
    .where(eq(modelSchemaAlias.normalized, normalized))
    .orderBy(modelSchemaAlias.priority, modelSchemaAlias.id)
    .limit(20);

  for (const aliasRow of aliasRows) {
    const schemaRow = rowsByEndpoint.get(aliasRow.endpointId);
    if (!schemaRow || !modalityMatches(options.modality, schemaRow)) continue;

    const manuallyCurated = aliasRow.source !== "fal-ai" || aliasRow.aliasType === "manual";
    const exactEndpoint =
      aliasRow.source === "fal-ai" && normalize(aliasRow.alias) === normalize(schemaRow.endpointId);
    return buildSchemaMatch(schemaRow, {
      aliasType: aliasRow.aliasType,
      aliasSource: aliasRow.source,
      confidence: manuallyCurated || exactEndpoint ? "high" : "medium",
      reason: manuallyCurated
        ? "curated_alias_needs_review"
        : exactEndpoint
          ? "exact_endpoint_alias_needs_review"
          : "exact_generated_alias_needs_review",
    });
  }

  // Step 2: generic model identity match
  const ranked = rankModelCandidates(
    rawName,
    candidates.map(identityCandidate),
    { modality: options.modality },
  );
  const [best, next] = ranked;
  if (!best || best.score < 0.58) return null;

  const margin = next ? best.score - next.score : best.score;
  const confidence: SchemaMatchResult["confidence"] =
    best.score >= 0.78 ? "high" : best.score >= 0.62 ? "medium" : "low";
  const reason = margin < 0.06 ? "model_identity_match_ambiguous" : "model_identity_match";
  const schemaRow = rowsByEndpoint.get(best.candidate.id);
  return schemaRow
    ? buildSchemaMatch(schemaRow, {
        aliasType: "inference",
        aliasSource: "model-identity",
        confidence,
        reason,
      })
    : null;
}

/**
 * 对指定站点的所有模型执行 Schema 关联
 * 在 refresh-mappings 之后调用，或在向导保存时调用
 */
export async function matchSchemasForSite(
  siteId: string,
): Promise<{ matched: number; total: number }> {
  const schemaCandidates = await loadSchemaCandidates();
  const siteModels = await db
    .select({
      id: models.id,
      rawName: models.rawName,
      modality: models.modality,
      schemaEndpointId: models.schemaEndpointId,
      schemaMatchSource: models.schemaMatchSource,
      schemaMatchStatus: models.schemaMatchStatus,
      schemaMatchConfidence: models.schemaMatchConfidence,
      schemaMatchReason: models.schemaMatchReason,
    })
    .from(models)
    .where(eq(models.siteId, siteId));

  let matched = 0;

  for (const model of siteModels) {
    // 只对非 LLM 模型匹配 Schema（LLM 用 model_catalog）
    if (model.modality === "llm" || model.modality === "embedding") {
      if (model.schemaMatchStatus !== "confirmed") {
        await db
          .update(models)
          .set({
            ...clearUnconfirmedSchemaCapabilities(),
            schemaEndpointId: null,
            schemaMatchSource: null,
            schemaMatchStatus: "unmatched",
            schemaMatchConfidence: null,
            schemaMatchReason: "schema_not_applicable_to_modality",
            updatedAt: new Date(),
          })
          .where(eq(models.id, model.id));
      }
      continue;
    }

    // Only an auditable wizard selection is an approved mapping. Historical
    // manual writes are candidates because their correctness is unknown.
    if (
      model.schemaMatchSource === "manual" &&
      model.schemaEndpointId &&
      model.schemaMatchStatus === "confirmed"
    ) {
      await db
        .update(models)
        .set({
          schemaMatchStatus: "confirmed",
          schemaMatchConfidence: "high",
          schemaMatchReason: model.schemaMatchReason ?? "wizard_apply_schema",
          updatedAt: new Date(),
        })
        .where(eq(models.id, model.id));
      matched++;
      continue;
    }

    if (model.schemaMatchSource === "manual" && model.schemaEndpointId) {
      await db
        .update(models)
        .set({
          ...clearUnconfirmedSchemaCapabilities(),
          schemaMatchStatus: "candidate",
          schemaMatchConfidence: "low",
          schemaMatchReason: model.schemaMatchReason ?? "legacy_manual_unverified",
          updatedAt: new Date(),
        })
        .where(eq(models.id, model.id));
      matched++;
      continue;
    }

    const result = await matchSchema(model.rawName, {
      modality: model.modality,
      candidates: schemaCandidates,
    });

    if (result) {
      await db
        .update(models)
        .set({
          ...(result.status === "confirmed" ? {} : clearUnconfirmedSchemaCapabilities()),
          ...(result.status === "confirmed"
            ? {}
            : { falParametersSnapshot: result.parameters.length ? JSON.stringify(result.parameters) : null }),
          schemaEndpointId: result.endpointId,
          schemaMatchSource: result.aliasType,
          schemaMatchStatus: result.status,
          schemaMatchConfidence: result.confidence,
          schemaMatchReason: result.reason,
          schemaSyncedAt: result.status === "confirmed" ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(models.id, model.id));
      matched++;
    } else if (model.schemaMatchStatus === "candidate" && model.schemaEndpointId) {
      // A candidate is deliberately retained for an administrator to review.
      // It has no Fal snapshot or limits until manual confirmation.
      await db
        .update(models)
        .set({
          ...clearUnconfirmedSchemaCapabilities(),
          schemaMatchConfidence: "low",
          schemaMatchReason: "candidate_endpoint_needs_review",
          updatedAt: new Date(),
        })
        .where(eq(models.id, model.id));
    } else {
      await db
        .update(models)
        .set({
          ...clearUnconfirmedSchemaCapabilities(),
          schemaEndpointId: null,
          schemaMatchSource: null,
          schemaMatchStatus: "unmatched",
          schemaMatchConfidence: null,
          schemaMatchReason: "no_exact_alias",
          updatedAt: new Date(),
        })
        .where(eq(models.id, model.id));
    }
  }

  return { matched, total: siteModels.length };
}
