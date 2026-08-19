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

/** 归一化：lowercase + 去掉 _/- 分隔符 + 压缩空格 */
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[_\-\/]/g, " ").replace(/\s+/g, " ");
}

/**
 * 将原始模型名匹配到 fal.ai Schema
 * @param rawName 站点原始模型名（如 "doubao-seedance-2-0", "kling-video-v2-5", "wanx-pro"）
 */
export async function matchSchema(rawName: string): Promise<SchemaMatchResult | null> {
  const normalized = normalize(rawName);

  // Step 1: 归一化精确匹配
  const [aliasRow] = await db
    .select({
      endpointId: modelSchemaAlias.endpointId,
      aliasType: modelSchemaAlias.aliasType,
      alias: modelSchemaAlias.alias,
      source: modelSchemaAlias.source,
    })
    .from(modelSchemaAlias)
    .where(eq(modelSchemaAlias.normalized, normalized))
    .orderBy(modelSchemaAlias.priority, modelSchemaAlias.id)
    .limit(1);

  if (!aliasRow) return null;

  // Step 2: 获取 Schema 明细
  const [schemaRow] = await db
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
    .where(eq(modelSchemaCatalog.endpointId, aliasRow.endpointId))
    .limit(1);

  if (!schemaRow) return null;

  let parameters: SchemaMatchResult["parameters"] = [];
  if (schemaRow.parameters && typeof schemaRow.parameters === "string") {
    try {
      parameters = JSON.parse(schemaRow.parameters);
    } catch {
      parameters = [];
    }
  }

  const manuallyCurated = aliasRow.source !== "fal-ai" || aliasRow.aliasType === "manual";
  const exactEndpoint =
    aliasRow.source === "fal-ai" &&
    normalize(aliasRow.alias) === normalize(schemaRow.endpointId);

  return {
    endpointId: schemaRow.endpointId,
    aliasType: aliasRow.aliasType,
    title: schemaRow.title,
    modality: schemaRow.modality,
    pricing: schemaRow.pricing,
    parameters,
    falCategory: schemaRow.falCategory,
    falSource: schemaRow.falSource,
    // An alias is useful matching evidence, but only the explicit wizard
    // selection has a model-level audit record. Do not auto-confirm a model
    // just because its name resembles a Fal endpoint.
    status: "candidate",
    confidence: manuallyCurated || exactEndpoint ? "high" : "medium",
    reason: manuallyCurated
      ? "curated_alias_needs_review"
      : exactEndpoint
        ? "exact_endpoint_alias_needs_review"
        : "exact_generated_alias_needs_review",
    aliasSource: aliasRow.source,
  };
}

/**
 * 对指定站点的所有模型执行 Schema 关联
 * 在 refresh-mappings 之后调用，或在向导保存时调用
 */
export async function matchSchemasForSite(
  siteId: string,
): Promise<{ matched: number; total: number }> {
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
    if (model.modality === "llm" || model.modality === "embedding") continue;

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

    const result = await matchSchema(model.rawName);

    if (result) {
      await db
        .update(models)
        .set({
          ...(result.status === "confirmed" ? {} : clearUnconfirmedSchemaCapabilities()),
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
