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
    })
    .from(modelSchemaAlias)
    .where(eq(modelSchemaAlias.normalized, normalized))
    .orderBy(modelSchemaAlias.priority)
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

  return {
    endpointId: schemaRow.endpointId,
    aliasType: aliasRow.aliasType,
    title: schemaRow.title,
    modality: schemaRow.modality,
    pricing: schemaRow.pricing,
    parameters,
    falCategory: schemaRow.falCategory,
    falSource: schemaRow.falSource,
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
    .select({ id: models.id, rawName: models.rawName, modality: models.modality })
    .from(models)
    .where(eq(models.siteId, siteId));

  let matched = 0;

  for (const model of siteModels) {
    // 只对非 LLM 模型匹配 Schema（LLM 用 model_catalog）
    if (model.modality === "llm" || model.modality === "embedding") continue;

    const result = await matchSchema(model.rawName);

    if (result) {
      await db
        .update(models)
        .set({
          schemaEndpointId: result.endpointId,
          schemaMatchSource: result.aliasType,
          schemaSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(models.id, model.id));
      matched++;
    }
  }

  return { matched, total: siteModels.length };
}
