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
import { extractInputSchemaCapabilities } from "../../lib/fal-input-schema";
import { getAdapter, normalizeAdapterId } from "../adapter";
import { getProviderAdapterRegistration, type AdapterRegistration } from "../adapter-manifest";
import type { ModelRow } from "../../db/schema/models";
import type { NormalizedParameterTemplate, ParameterField } from "@openhub/catalog/parameter-template";

export interface SchemaCatalogCandidate {
  endpointId: string;
  title: string;
  modality: string;
  pricing: string | null;
  parameters: string | null;
  inputSchema: string | null;
  outputSchema: string | null;
  description: string | null;
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
  inputSchema: string | null;
  outputSchema: string | null;
  description: string | null;
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
  adapterCapabilities?: readonly string[];
}

export interface SchemaTemplateCompatibility {
  decision: "confirmed" | "candidate" | "incompatible";
  templateId: string | null;
  operations: string[];
  fieldMapping: Record<string, string>;
  overridableFields: string[];
  requiredFields: string[];
  unmappedRequiredFields: string[];
  unsupportedFields: string[];
  reasons: string[];
}

/** Convert the legacy Fal row into the source-neutral template shape. */
export function falSchemaToParameterTemplate(schema: SchemaCatalogCandidate): NormalizedParameterTemplate {
  const parameters = parseParameters(schema.parameters);
  const inputs: Record<string, ParameterField> = {};
  for (const parameter of parameters) inputs[parameter.name] = { ...parameter, type: parameter.type === "int" ? "integer" : parameter.type };
  const category = schema.falCategory ?? "";
  const operation = category.includes("image-to-image") ? "image.image_to_image"
    : category.includes("text-to-image") ? "image.text_to_image"
      : category.includes("image-to-video") ? "video.image_to_video"
        : category.includes("video-to-video") ? "video.video_to_video"
          : category.includes("text-to-video") ? "video.text_to_video"
            : schema.modality === "audio" ? "audio.source" : `${schema.modality}.source`;
  return {
    sourceModelId: schema.endpointId,
    sourceCollection: "fal_schema",
    sourceIndex: 0,
    operation,
    modality: schema.modality as NormalizedParameterTemplate["modality"],
    provider: "fal-ai",
    providerName: "fal.ai",
    endpointHint: schema.endpointId,
    inputs,
    required: parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name),
    provenance: { sourceCommit: "", file: "fal_model_encyclopedia.json", collection: "model_schema_catalog", index: 0 },
  };
}

const CANONICAL_TEMPLATE_FIELDS = new Set([
  "model", "prompt", "content", "duration", "aspect_ratio", "resolution", "size", "quality", "style",
  "image", "mask", "image_url", "image_urls", "video_url", "video_urls", "audio_url", "audio_urls",
  "reference_image_url", "reference_image_urls", "reference_video_url", "reference_video_urls",
  "reference_audio_url", "reference_audio_urls", "generate_audio", "input", "voice", "file", "n",
  "response_format", "speed", "language", "temperature", "seed", "provider_options",
]);

export function evaluateSchemaTemplateCompatibility(input: {
  model: ModelRow;
  schema: SchemaCatalogCandidate;
  registration?: AdapterRegistration | null;
  protocolId?: string | null;
  schemaConfirmed?: boolean;
}): SchemaTemplateCompatibility {
  const reasons: string[] = [];
  const requiredFields = parseParameters(input.schema.parameters)
    .filter((parameter) => parameter.required)
    .map((parameter) => parameter.name);
  const fieldMapping: Record<string, string> = {};
  const overridableFields: string[] = [];
  const unsupportedFields: string[] = [];
  const unmappedRequiredFields: string[] = [];
  const registration = input.registration ?? null;
  const adapterCapabilities = registration?.manifest.capabilities ?? [];

  if (!registration) {
    return {
      decision: "incompatible",
      templateId: null,
      operations: [],
      fieldMapping,
      overridableFields,
      requiredFields,
      unmappedRequiredFields: requiredFields,
      unsupportedFields,
      reasons: ["adapter_registration_missing"],
    };
  }
  if (input.schema.modality !== input.model.modality) reasons.push("schema_model_modality_mismatch");
  if (!adapterSupportsSchema(input.schema.modality, adapterCapabilities)) reasons.push("adapter_does_not_support_schema_modality");
  if (!hasSchemaContract(input.schema)) reasons.push("schema_input_contract_missing");

  const bindings = (registration.manifest.templateBindings ?? []).filter((candidate) => candidate.modality === input.schema.modality);
  const binding = bindings.length > 1 && input.schema.modality === "video" && !input.protocolId
    ? undefined
    : bindings.find((candidate) => !input.protocolId || candidate.id === input.protocolId);
  if (!binding) {
    reasons.push(input.protocolId
      ? "requested_template_binding_missing"
      : input.schema.modality === "video" && bindings.length > 1
        ? "video_protocol_binding_required"
        : "adapter_template_binding_missing");
  }

  const operations = binding?.operations ?? [];
  const declaredFields = binding?.fields ?? {};
  for (const parameter of parseParameters(input.schema.parameters)) {
    const mapping = declaredFields[parameter.name];
    if (mapping) {
      fieldMapping[parameter.name] = mapping.target;
      if (mapping.overridable) overridableFields.push(parameter.name);
      continue;
    }
    if (CANONICAL_TEMPLATE_FIELDS.has(parameter.name)) {
      fieldMapping[parameter.name] = parameter.name;
      if (["duration", "aspect_ratio", "resolution", "content", "image_url", "image_urls", "video_url", "video_urls", "audio_url", "audio_urls"].includes(parameter.name)) {
        overridableFields.push(parameter.name);
      }
      continue;
    }
    unsupportedFields.push(parameter.name);
    if (parameter.required) unmappedRequiredFields.push(parameter.name);
  }

  if (binding && input.schema.modality === "video" && (!operations.includes("video.submit") || !operations.includes("video.query"))) {
    reasons.push("video_submit_query_lifecycle_missing");
  }
  if (unmappedRequiredFields.length > 0) reasons.push("required_schema_fields_unmapped");
  if (unsupportedFields.length > 0) reasons.push("schema_fields_need_provider_options_or_adapter_mapping");
  if (input.schemaConfirmed === false) reasons.push("schema_identity_not_confirmed");

  const incompatible = reasons.includes("schema_model_modality_mismatch")
    || reasons.includes("adapter_does_not_support_schema_modality")
    || reasons.includes("schema_input_contract_missing")
    || reasons.includes("adapter_registration_missing")
    || reasons.includes("video_submit_query_lifecycle_missing")
    || reasons.includes("requested_template_binding_missing")
    || unmappedRequiredFields.length > 0;
  const decision = incompatible
    ? "incompatible"
    : reasons.length === 0 && (input.schemaConfirmed ?? true) && Boolean(binding)
      ? "confirmed"
      : "candidate";

  return {
    decision,
    templateId: binding?.id ?? null,
    operations,
    fieldMapping,
    overridableFields: Array.from(new Set(overridableFields)),
    requiredFields,
    unmappedRequiredFields,
    unsupportedFields: Array.from(new Set(unsupportedFields)),
    reasons: reasons.length > 0 ? reasons : ["template_compatible"],
  };
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
      inputSchema: modelSchemaCatalog.inputSchema,
      outputSchema: modelSchemaCatalog.outputSchema,
      description: modelSchemaCatalog.description,
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
    status: SchemaMatchResult["status"];
  },
): SchemaMatchResult {
  return {
    endpointId: schemaRow.endpointId,
    aliasType: metadata.aliasType,
    title: schemaRow.title,
    modality: schemaRow.modality,
    pricing: schemaRow.pricing,
    parameters: parseParameters(schemaRow.parameters),
    inputSchema: schemaRow.inputSchema,
    outputSchema: schemaRow.outputSchema,
    description: schemaRow.description,
    falCategory: schemaRow.falCategory,
    falSource: schemaRow.falSource,
    status: metadata.status,
    confidence: metadata.confidence,
    reason: metadata.reason,
    aliasSource: metadata.aliasSource,
  };
}

function adapterSupportsSchema(modality: string, capabilities: readonly string[] | undefined): boolean {
  if (!capabilities) return true;
  if (modality === "video") return capabilities.includes("video.submit") && capabilities.includes("video.query");
  if (modality === "image") return capabilities.some((capability) => capability.startsWith("image."));
  if (modality === "audio") return capabilities.some((capability) => capability.startsWith("audio."));
  if (modality === "embedding") return capabilities.includes("embedding");
  if (modality === "llm") return capabilities.includes("chat");
  return false;
}

function hasSchemaContract(row: SchemaCatalogCandidate): boolean {
  return Boolean(row.inputSchema || row.parameters);
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
    const identityConfirmed = manuallyCurated || exactEndpoint;
    const compatible = modalityMatches(options.modality, schemaRow)
      && adapterSupportsSchema(schemaRow.modality, options.adapterCapabilities)
      && hasSchemaContract(schemaRow);
    return buildSchemaMatch(schemaRow, {
      aliasType: aliasRow.aliasType,
      aliasSource: aliasRow.source,
      confidence: manuallyCurated || exactEndpoint ? "high" : "medium",
      status: identityConfirmed && compatible ? "confirmed" : "candidate",
      reason: !compatible
        ? "schema_adapter_or_contract_incompatible"
        : manuallyCurated
          ? "curated_alias_applied"
          : exactEndpoint
            ? "exact_endpoint_applied"
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
  if (!schemaRow) return null;
  const identityConfirmed = best.score >= 0.94 && margin >= 0.06;
  const compatible = adapterSupportsSchema(schemaRow.modality, options.adapterCapabilities)
    && hasSchemaContract(schemaRow);
  return buildSchemaMatch(schemaRow, {
        aliasType: "inference",
        aliasSource: "model-identity",
        confidence,
        status: identityConfirmed && compatible ? "confirmed" : "candidate",
        reason: !compatible
          ? "schema_adapter_or_contract_incompatible"
          : identityConfirmed
            ? "strong_model_identity_applied"
            : reason,
      });
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
      adapterId: models.adapterId,
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
      adapterCapabilities: getAdapter(normalizeAdapterId(model.adapterId) ?? model.adapterId)?.capabilities ?? [],
    });

    if (result) {
      const adapterId = normalizeAdapterId(model.adapterId) ?? model.adapterId;
      const registration = getProviderAdapterRegistration(adapterId);
      const templateCompatibility = registration
        ? evaluateSchemaTemplateCompatibility({
          model: model as ModelRow,
          schema: schemaCandidates.find((candidate) => candidate.endpointId === result.endpointId) ?? {
            endpointId: result.endpointId,
            title: result.title ?? result.endpointId,
            modality: result.modality ?? model.modality,
            pricing: result.pricing,
            parameters: result.parameters.length > 0 ? JSON.stringify(result.parameters) : null,
            inputSchema: result.inputSchema,
            outputSchema: result.outputSchema,
            description: result.description,
            falCategory: result.falCategory,
            falSource: result.falSource,
          },
          registration,
          schemaConfirmed: result.status === "confirmed",
        })
        : null;
      const templateDecision = templateCompatibility?.decision ?? result.status;
      const templateReason = templateCompatibility?.reasons.join(",") ?? result.reason;
      const capabilities = extractInputSchemaCapabilities(result.inputSchema, result.parameters.length > 0 ? JSON.stringify(result.parameters) : null);
      const durationValues = result.parameters.find((parameter) => parameter.name === "duration")?.enum ?? [];
      const requiredParams = result.parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name);
      const optionalParams = result.parameters.filter((parameter) => !parameter.required).map((parameter) => parameter.name);
      const numericDurations = durationValues.map(Number).filter((value) => Number.isFinite(value) && value > 0);
      await db
        .update(models)
        .set({
          ...(templateDecision === "confirmed"
            ? {
              falParametersSnapshot: result.parameters.length > 0 ? JSON.stringify(result.parameters) : null,
              falInputSchemaSnapshot: result.inputSchema,
              falDescription: result.description,
              falPricing: result.pricing,
              falSource: result.falSource,
              videoDurationEnum: durationValues.length > 0 ? JSON.stringify(durationValues.map(String)) : null,
              videoRequiredParams: requiredParams.length > 0 ? JSON.stringify(requiredParams) : null,
              videoOptionalParams: optionalParams.length > 0 ? JSON.stringify(optionalParams) : null,
              maxDurationSec: numericDurations.length > 0 ? Math.max(...numericDurations) : undefined,
              maxReferenceImages: capabilities.maxReferenceImages,
              maxReferenceVideos: capabilities.maxReferenceVideos,
              maxReferenceAudios: capabilities.maxReferenceAudios,
              schemaSyncedAt: new Date(),
            }
            : clearUnconfirmedSchemaCapabilities()),
          ...(templateDecision === "confirmed"
            ? {}
            : { falParametersSnapshot: result.parameters.length ? JSON.stringify(result.parameters) : null }),
          schemaEndpointId: result.endpointId,
          schemaMatchSource: result.aliasType,
          schemaMatchStatus: templateDecision === "incompatible" ? "candidate" : templateDecision,
          schemaMatchConfidence: result.confidence,
          schemaMatchReason: templateReason,
          schemaSyncedAt: templateDecision === "confirmed" ? new Date() : null,
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
