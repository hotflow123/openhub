import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db";
import {
  models,
  modelProtocolBindings,
  protocolCatalog,
} from "../db/schema";
import type { ProtocolStore } from "./memefast-protocol-sync";
import type { ProtocolDocument } from "./memefast-protocol-sync";

export const protocolStore: ProtocolStore = {
  async findByIdentity(protocolId, version) {
    const rows = await db
      .select()
      .from(protocolCatalog)
      .where(eq(protocolCatalog.protocolId, protocolId));
    return rows
      .filter((row) => row.version === version)
      .sort((left, right) => Number(right.fetchedAt) - Number(left.fetchedAt));
  },
  async insertProtocol(row) {
    await db.insert(protocolCatalog).values(row as typeof protocolCatalog.$inferInsert);
  },
  async insertRun(row) {
    const { protocolSyncRuns } = await import("../db/schema");
    await db.insert(protocolSyncRuns).values(row as typeof protocolSyncRuns.$inferInsert);
  },
};

export async function listProtocolCatalog(protocolId?: string) {
  const rows = await db
    .select()
    .from(protocolCatalog)
    .orderBy(desc(protocolCatalog.fetchedAt));
  return protocolId ? rows.filter((row) => row.protocolId === protocolId) : rows;
}

export async function getProtocolCatalogRecord(recordId: string) {
  const [row] = await db
    .select()
    .from(protocolCatalog)
    .where(eq(protocolCatalog.recordId, recordId))
    .limit(1);
  return row;
}

export async function listModelProtocolBindings(modelId?: string) {
  const rows = await db
    .select()
    .from(modelProtocolBindings)
    .orderBy(desc(modelProtocolBindings.updatedAt));
  return modelId ? rows.filter((row) => row.modelId === modelId) : rows;
}

function parseDocument(row: typeof protocolCatalog.$inferSelect): ProtocolDocument | null {
  try {
    const value = JSON.parse(row.rawDocument) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as ProtocolDocument;
  } catch {
    return null;
  }
}

function normalizeModelName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function textTokens(value: string): string[] {
  const ignored = new Set(["video", "image", "audio", "model", "models", "task", "tasks", "generate", "generation"]);
  const tokens = value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return tokens
    .filter((token) => !ignored.has(token));
}

function hasFamilyToken(tokens: string[], family: string): boolean {
  return tokens.some((token) =>
    token === family || token.startsWith(family) && /^\d/.test(token.slice(family.length)),
  );
}

function parseSourceMetadata(sourceMetadata: string | null): Record<string, unknown> {
  if (!sourceMetadata) return {};
  try {
    const value = JSON.parse(sourceMetadata) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function protocolFamilyTokens(
  document: ProtocolDocument,
  row: typeof protocolCatalog.$inferSelect,
): string[] {
  const modalities = new Set(["llm", "image", "audio", "video", "embedding", "unknown"]);
  const values = [
    ...row.protocolId.split(/[._-]+/),
    ...document.operations.flatMap((operation) => {
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) return [];
      const platform = (operation as Record<string, unknown>).platform;
      return typeof platform === "string" ? platform.split(/[._-]+/) : [];
    }),
  ];
  return values
    .filter((token): token is string =>
      typeof token === "string" &&
      token !== "memefast" &&
      token !== "v1" &&
      !modalities.has(token) &&
      token.length >= 2,
    );
}

function protocolModelFamilyTokens(document: ProtocolDocument): string[] {
  return (document.modelNames ?? [])
    .map((modelName) => modelName.toLowerCase().match(/^[a-z]{2,}/)?.[0])
    .filter((token): token is string => typeof token === "string" && token.length >= 2);
}

function isGenericProtocol(document: ProtocolDocument): boolean {
  const paths = document.operations
    .filter((operation): operation is Record<string, unknown> =>
      Boolean(operation) && typeof operation === "object" && !Array.isArray(operation),
    )
    .map((operation) => String(operation.path ?? ""));
  const requiredPath = document.modality === "llm"
    ? /\/v1\/(?:chat\/completions|responses)/
    : document.modality === "image"
      ? /\/v1\/images\/generations/
      : document.modality === "audio"
        ? /\/v1\/audio\/(?:speech|transcriptions)/
        : document.modality === "embedding"
          ? /\/v1\/embeddings/
          : null;
  return Boolean(requiredPath && paths.some((path) => requiredPath.test(path)));
}

interface ProtocolMatch {
  score: number;
  reason: string;
  familyMatch: boolean;
  endpointFamilyMatch: boolean;
  modelNameFamilyMatch: boolean;
}

function modelMatchScore(
  model: typeof models.$inferSelect,
  document: ProtocolDocument,
  row: typeof protocolCatalog.$inferSelect,
): ProtocolMatch {
  if (document.modality !== model.modality) {
    return {
      score: 0,
      reason: "modality_mismatch",
      familyMatch: false,
      endpointFamilyMatch: false,
      modelNameFamilyMatch: false,
    };
  }

  const normalized = normalizeModelName(model.rawName);
  const exact = document.modelNames?.some((candidate) => candidate === model.rawName);
  const normalizedMatch = document.modelNames?.some((candidate) => normalizeModelName(candidate) === normalized);
  let score = exact ? 200 : normalizedMatch ? 180 : 0;
  let reason = exact
    ? "exact_model_name_in_memefast_protocol"
    : normalizedMatch
      ? "normalized_model_name_in_memefast_protocol"
      : "no_runtime_protocol_evidence";

  const metadata = parseSourceMetadata(model.sourceMetadata);
  const endpointTypes = Array.isArray(metadata.supported_endpoint_types)
    ? metadata.supported_endpoint_types.filter((item): item is string => typeof item === "string")
    : [];
  const families = protocolFamilyTokens(document, row);
  const modelNameTokens = textTokens(model.rawName);
  const modelFamilyMatch = families.some((family) =>
    hasFamilyToken(modelNameTokens, family),
  );
  const endpointFamilyMatch = families.some((family) =>
    endpointTypes.some((endpoint) => hasFamilyToken(textTokens(endpoint), family)),
  );
  const modelNameFamilyMatch = protocolModelFamilyTokens(document).some((family) =>
    hasFamilyToken(modelNameTokens, family),
  );
  if (score === 0 && isGenericProtocol(document)) {
    score = 50;
    reason = endpointTypes.length > 0
      ? "runtime_endpoint_type_matches_generic_memefast_protocol"
      : "generic_protocol_modality_fallback";
  }

  if (endpointFamilyMatch) {
    score += 100;
    reason = "runtime_endpoint_type_matches_documented_protocol_family";
  } else if (modelFamilyMatch) {
    score += 90;
    reason = "model_name_matches_documented_protocol_family";
  } else if (modelNameFamilyMatch) {
    score += 80;
    reason = "protocol_model_family_matches_runtime_name";
  }

  return {
    score,
    reason,
    familyMatch: modelFamilyMatch,
    endpointFamilyMatch,
    modelNameFamilyMatch,
  };
}

interface ProtocolCandidate {
  row: typeof protocolCatalog.$inferSelect;
  document: ProtocolDocument;
  match: ProtocolMatch;
}

export interface ProtocolReadiness {
  ready: boolean;
  missing: string[];
}

function hasProtocolOperation(
  document: ProtocolDocument,
  role: "video.submit" | "video.query",
  method: "POST" | "GET",
): boolean {
  return document.operations.some((operation) => {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) return false;
    const value = operation as Record<string, unknown>;
    const operationRole = value.operationRole ?? value.operationId;
    return operationRole === role &&
      String(value.method ?? "").toUpperCase() === method &&
      typeof value.path === "string" &&
      value.path.trim().length > 0 &&
      !/^https?:\/\//i.test(value.path);
  });
}

export function assessProtocolReadiness(document: ProtocolDocument): ProtocolReadiness {
  if (document.modality !== "video") {
    return { ready: false, missing: ["video.modality"] };
  }
  const missing: string[] = [];
  if (!hasProtocolOperation(document, "video.submit", "POST")) {
    missing.push("video.submit");
  }
  if (!hasProtocolOperation(document, "video.query", "GET")) {
    missing.push("video.query");
  }
  return { ready: missing.length === 0, missing };
}

export function isExecutableVideoProtocol(document: ProtocolDocument): boolean {
  return assessProtocolReadiness(document).ready;
}

export function chooseProtocolCandidate(
  model: typeof models.$inferSelect,
  candidates: Array<{
    row: typeof protocolCatalog.$inferSelect;
    document: ProtocolDocument;
  }>,
): ProtocolCandidate | null {
  const metadata = parseSourceMetadata(model.sourceMetadata);
  const endpointTypes = Array.isArray(metadata.supported_endpoint_types)
    ? metadata.supported_endpoint_types.filter((item): item is string => typeof item === "string")
    : [];
  const modelTokens = new Set([
    ...textTokens(model.rawName),
    ...endpointTypes.flatMap(textTokens),
  ]);
  const knownFamilies = new Set(
    candidates.flatMap(({ row, document }) => protocolFamilyTokens(document, row)),
  );
  const modelFamilyEvidence = [...knownFamilies].filter((family) =>
    hasFamilyToken([...modelTokens], family),
  );
  const ranked = candidates
    .map(({ row, document }) => ({
      row,
      document,
      match: modelMatchScore(model, document, row),
    }))
    .filter(({ document, row, match }) => {
      if (match.score <= 0) return false;
      if (modelFamilyEvidence.length === 0 || isGenericProtocol(document)) return true;
      return match.familyMatch || match.endpointFamilyMatch;
    })
    .sort((left, right) =>
      right.match.score - left.match.score ||
      Number(right.row.fetchedAt) - Number(left.row.fetchedAt),
    );
  const best = ranked[0];
  if (!best) return null;

  const tied = ranked.filter(({ match }) => match.score === best.match.score);
  if (tied.length > 1 && !best.match.familyMatch && !best.match.endpointFamilyMatch) {
    const generic = tied.filter(({ document }) => isGenericProtocol(document));
    if (generic.length === 1) return generic[0];
    return null;
  }
  return best;
}

export interface ProtocolBindingSyncResult {
  inspected: number;
  bound: number;
  existing: number;
  updated: number;
  unmatched: number;
}

export async function bindModelsToLatestProtocols(siteId?: string): Promise<ProtocolBindingSyncResult> {
  const modelRows = await db
    .select()
    .from(models)
    .where(siteId
      ? and(eq(models.siteId, siteId), eq(models.adapterId, "memefast"))
      : eq(models.adapterId, "memefast"));
  const protocolRows = await db
    .select()
    .from(protocolCatalog)
    .orderBy(desc(protocolCatalog.fetchedAt));
  const existingRows = await db.select().from(modelProtocolBindings);
  const scopedModelIds = new Set(modelRows.map((model) => model.id));
  for (const existing of existingRows) {
    if (scopedModelIds.has(existing.modelId)) continue;
    if (existing.evidenceStatus === "enabled" || existing.evidenceStatus === "runtime_verified") continue;
    await db
      .delete(modelProtocolBindings)
      .where(eq(modelProtocolBindings.id, existing.id));
  }
  const existingByModel = new Map(existingRows.map((row) => [row.modelId, row]));
  const latestByIdentity = new Map<string, typeof protocolRows[number]>();
  for (const row of protocolRows) {
    const identity = `${row.protocolId}\0${row.version}`;
    const previous = latestByIdentity.get(identity);
    if (!previous || Number(row.fetchedAt) > Number(previous.fetchedAt)) {
      latestByIdentity.set(identity, row);
    }
  }
  const candidates = [...latestByIdentity.values()]
    .map((row) => ({ row, document: parseDocument(row) }))
    .filter((item): item is { row: typeof protocolRows[number]; document: ProtocolDocument } =>
      Boolean(item.document),
    );

  const result: ProtocolBindingSyncResult = {
    inspected: 0,
    bound: 0,
    existing: 0,
    updated: 0,
    unmatched: 0,
  };

  for (const model of modelRows) {
    if (siteId && model.siteId !== siteId) continue;
    result.inspected += 1;
    const match = chooseProtocolCandidate(model, candidates);
    if (!match) {
      const existing = existingByModel.get(model.id);
      if (existing && existing.evidenceStatus !== "enabled" && existing.evidenceStatus !== "runtime_verified") {
        await db
          .delete(modelProtocolBindings)
          .where(and(
            eq(modelProtocolBindings.id, existing.id),
            eq(modelProtocolBindings.modelId, model.id),
          ));
      }
      result.unmatched += 1;
      continue;
    }

    const existing = existingByModel.get(model.id);
    const binding = {
      protocolRecordId: match.row.recordId,
      protocolId: match.row.protocolId,
      protocolVersion: match.row.version,
      parameterTemplateId: model.schemaMatchStatus === "confirmed"
        ? model.schemaEndpointId
        : null,
      evidenceStatus: match.match.score >= 95 ? "documented" as const : "imported" as const,
      bindingReason: match.match.reason,
      updatedAt: new Date(),
    };
    if (existing) {
      if (
        existing.protocolRecordId !== binding.protocolRecordId ||
        existing.parameterTemplateId !== binding.parameterTemplateId ||
        existing.bindingReason !== binding.bindingReason
      ) {
        await db
          .update(modelProtocolBindings)
          .set(binding)
          .where(eq(modelProtocolBindings.id, existing.id));
        result.updated += 1;
      } else {
        result.existing += 1;
      }
      continue;
    }
    await db.insert(modelProtocolBindings).values({
      id: nanoid(),
      modelId: model.id,
      ...binding,
      fieldMapping: "{}",
      capabilityOverrides: JSON.stringify({
        sourceEndpointTypes: parseSourceMetadata(model.sourceMetadata).supported_endpoint_types ?? [],
      }),
    });
    result.bound += 1;
  }
  return result;
}

export async function resolveModelProtocol(modelId: string): Promise<{
  binding: typeof modelProtocolBindings.$inferSelect;
  catalog: typeof protocolCatalog.$inferSelect;
  document: ProtocolDocument;
} | null> {
  const [binding] = await db
    .select()
    .from(modelProtocolBindings)
    .where(eq(modelProtocolBindings.modelId, modelId))
    .orderBy(desc(modelProtocolBindings.updatedAt))
    .limit(1);
  if (!binding) return null;
  const catalog = await getProtocolCatalogRecord(binding.protocolRecordId);
  if (!catalog) return null;
  const document = parseDocument(catalog);
  return document ? { binding, catalog, document } : null;
}
