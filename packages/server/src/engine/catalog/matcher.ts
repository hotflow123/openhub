/**
 * 四步模型匹配器 (DESIGN.md 第 5 章 + 第 19 章)
 * 
 * 输入：站点模型的 rawName
 * 输出：catalogModelId + matchSource + confidence
 * 
 * 匹配顺序（优先级递减）：
 *   1. exact      - 精确匹配 catalog.id（如 "openai/gpt-4o"）
 *   2. normalized - 归一化匹配（lowercase + 去掉 _/- 差异）
 *   3. alias      - 别名表匹配
 *   4. keyword    - 关键词匹配（family）
 */

import { eq, like, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { modelCatalog, modelCatalogAlias, models } from "../../db/schema/index.js";

export type MatchResult = {
  catalogModelId: string | null;
  matchSource: "exact" | "normalized" | "alias" | "keyword" | null;
  confidence: number; // 0.0 - 1.0
};

/**
 * 四步匹配核心逻辑
 */
export async function matchModelName(rawName: string): Promise<MatchResult> {
  // Step 1: Exact match
  const exactMatch = await db
    .select({ id: modelCatalog.id })
    .from(modelCatalog)
    .where(eq(modelCatalog.id, rawName))
    .limit(1);

  if (exactMatch.length > 0) {
    return {
      catalogModelId: exactMatch[0].id,
      matchSource: "exact",
      confidence: 1.0,
    };
  }

  // Step 2: Normalized match (lowercase, replace _ and - with space, collapse whitespace)
  const normalized = normalize(rawName);
  const normalizedMatch = await db
    .select({ id: modelCatalog.id })
    .from(modelCatalog)
    .where(
      sql`LOWER(REPLACE(REPLACE(REPLACE(${modelCatalog.id}, '_', ' '), '-', ' '), '/', ' ')) = ${normalized}`,
    )
    .limit(1);

  if (normalizedMatch.length > 0) {
    return {
      catalogModelId: normalizedMatch[0].id,
      matchSource: "normalized",
      confidence: 0.95,
    };
  }

  // Step 3: Alias match
  const aliasMatch = await db
    .select({ catalogId: modelCatalogAlias.catalogId })
    .from(modelCatalogAlias)
    .where(eq(modelCatalogAlias.normalized, normalized))
    .limit(1);

  if (aliasMatch.length > 0) {
    return {
      catalogModelId: aliasMatch[0].catalogId,
      matchSource: "alias",
      confidence: 0.90,
    };
  }

  // Step 4: Keyword match (family 关键词)
  const keywordResult = await keywordMatch(rawName);
  if (keywordResult) {
    return {
      catalogModelId: keywordResult.id,
      matchSource: "keyword",
      confidence: 0.70,
    };
  }

  return {
    catalogModelId: null,
    matchSource: null,
    confidence: 0,
  };
}

/**
 * 归一化字符串：lowercase + 去掉特殊字符 + 压缩空格
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[_\-\/]/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * 关键词匹配（基于 family）
 * 
 * 规则：
 *  - "gpt-4o" / "gpt4o" / "gpt-4" → family="gpt"
 *  - "claude-3" / "claude3.5" → family="claude"
 *  - "dall-e-3" / "dalle3" → family="dall-e"
 *  - "kimi-k1" → family="kimi"
 */
async function keywordMatch(rawName: string): Promise<{ id: string } | null> {
  const lower = rawName.toLowerCase();

  // GPT 系列
  if (/gpt[-_\s]?[345o]/.test(lower) || lower.startsWith("gpt")) {
    const rows = await db
      .select({ id: modelCatalog.id })
      .from(modelCatalog)
      .where(eq(modelCatalog.family, "gpt"))
      .limit(1);
    if (rows.length > 0) return rows[0];
  }

  // Claude 系列
  if (/claude/.test(lower)) {
    const rows = await db
      .select({ id: modelCatalog.id })
      .from(modelCatalog)
      .where(eq(modelCatalog.family, "claude"))
      .limit(1);
    if (rows.length > 0) return rows[0];
  }

  // DALL-E 系列
  if (/dall[-_\s]?e/.test(lower)) {
    const rows = await db
      .select({ id: modelCatalog.id })
      .from(modelCatalog)
      .where(eq(modelCatalog.family, "dall-e"))
      .limit(1);
    if (rows.length > 0) return rows[0];
  }

  // Kimi 系列
  if (/kimi/.test(lower)) {
    const rows = await db
      .select({ id: modelCatalog.id })
      .from(modelCatalog)
      .where(eq(modelCatalog.family, "kimi"))
      .limit(1);
    if (rows.length > 0) return rows[0];
  }

  // Kling 视频
  if (/kling/.test(lower)) {
    const rows = await db
      .select({ id: modelCatalog.id })
      .from(modelCatalog)
      .where(like(modelCatalog.id, "kling/%"))
      .limit(1);
    if (rows.length > 0) return rows[0];
  }

  // Seedance 视频
  if (/seedance|jimeng/.test(lower)) {
    const rows = await db
      .select({ id: modelCatalog.id })
      .from(modelCatalog)
      .where(like(modelCatalog.id, "jimeng/%"))
      .limit(1);
    if (rows.length > 0) return rows[0];
  }

  // 万相视频
  if (/wanx|万相/.test(lower)) {
    const rows = await db
      .select({ id: modelCatalog.id })
      .from(modelCatalog)
      .where(like(modelCatalog.id, "alibaba/%"))
      .limit(1);
    if (rows.length > 0) return rows[0];
  }

  // Grok 视频
  if (/grok.*video/.test(lower)) {
    const rows = await db
      .select({ id: modelCatalog.id })
      .from(modelCatalog)
      .where(like(modelCatalog.id, "xai/grok%"))
      .limit(1);
    if (rows.length > 0) return rows[0];
  }

  return null;
}

function confidenceLabel(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.7) return "medium";
  return "low";
}

/**
 * 对指定站点的所有模型执行匹配
 */
export async function matchModelsForSite(siteId: string): Promise<{ matched: number; total: number }> {
  const siteModels = await db
    .select({ id: models.id, rawName: models.rawName })
    .from(models)
    .where(eq(models.siteId, siteId));

  let matched = 0;

  for (const model of siteModels) {
    const result = await matchModelName(model.rawName);

    if (result.catalogModelId) {
      await db
        .update(models)
        .set({
          catalogModelId: result.catalogModelId,
          catalogMatchSource: result.matchSource,
          catalogMatchConfidence: confidenceLabel(result.confidence),
          catalogSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(models.id, model.id));
      matched++;
    } else {
      await db
        .update(models)
        .set({
          catalogModelId: null,
          catalogMatchSource: "none",
          catalogMatchConfidence: null,
          catalogSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(models.id, model.id));
    }
  }

  return { matched, total: siteModels.length };
}