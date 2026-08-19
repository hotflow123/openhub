/**
 * 四步目录匹配器
 *
 *  Step 1 - exact      : 站点 model.remoteId == catalog.id
 *  Step 2 - normalized : 归一化字符串后 == catalog.id
 *  Step 3 - alias      : 查询 model_catalog_alias 表
 *  Step 4 - keyword    : 通过 family 关键词 + inferKimiFamily 等规则推断
 */

import type { MatchResult } from "../sync/types.js";

export interface MatcherDb {
  findCatalogById(id: string): Promise<{ id: string } | undefined>;
  findCatalogByNormalized(normalized: string): Promise<{ id: string } | undefined>;
  findCatalogAlias(alias: string): Promise<{ catalogId: string } | undefined>;
  findCatalogByFamily(family: string): Promise<{ id: string } | undefined>;
  /** 通过 id 前缀查找（如 "jimeng/%"） */
  findCatalogByIdPrefix(prefix: string): Promise<{ id: string } | undefined>;
}

export interface MatchOptions {
  /** 额外的 family 推断函数，可由 server 注入更多规则 */
  customInferrers?: Array<(name: string) => string | undefined>;
  /** family 只能作为人工确认前的候选建议，不能默认写入自动映射 */
  allowKeywordFallback?: boolean;
}

export function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[_\-\/]/g, " ").replace(/\s+/g, " ");
}

/**
 * 在 catalog 表里查 family 关键字匹配时使用的简化规则
 * Phase 3 可扩展为完整规则库
 */
function defaultFamilyInferrers(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (/claude[-_ ]?opus/i.test(lower)) return "claude-opus";
  if (/claude[-_ ]?sonnet/i.test(lower)) return "claude-sonnet";
  if (/claude[-_ ]?haiku/i.test(lower)) return "claude-haiku";
  if (/gemini[-_ ]?flash/i.test(lower)) return "gemini-flash";
  if (/gemini[-_ ]?pro/i.test(lower)) return "gemini-pro";
  if (/gpt[-_ ]?4o|chatgpt-4o/i.test(lower)) return "gpt";
  if (/deepseek/i.test(lower) && /thinking/i.test(lower)) return "deepseek-thinking";
  if (/deepseek/i.test(lower)) return "deepseek";
  if (/qwen[-_ ]?\d/i.test(lower)) return "qwen";
  if (/llama[-_ ]?\d/i.test(lower)) return "llama";
  if (/mistral/i.test(lower)) return "mistral";
  if (/stable[-_ ]?diffusion/i.test(lower)) return "stable-diffusion";
  if (/flux/i.test(lower)) return "flux";
  if (/wan[-_ ]?2/i.test(lower)) return "wan";
  if (/kling[-_ ]?v?\d/i.test(lower)) return "kling";
  if (/sora/i.test(lower)) return "sora";
  if (/step[-_ ]?\d|step1/i.test(lower)) return "stepfun";
  if (/hunyuan/i.test(lower)) return "hunyuan";
  if (/doubao[-_ ]?seed(?!ance)/i.test(lower) || /seed[-_ ]?\d/i.test(lower)) return "seed";
  if (/minimax|abab\d/i.test(lower)) return "minimax";
  if (/dall[-_ ]?e/i.test(lower)) return "dall-e";
  if (/text[-_ ]?embedding/i.test(lower)) return "text-embedding";
  if (/tts[-_ ]?1/i.test(lower)) return "tts";
  return undefined;
}

export async function matchModel(
  db: MatcherDb,
  modelName: string,
  options: MatchOptions = {},
): Promise<MatchResult> {
  // Step 1: exact
  const exact = await db.findCatalogById(modelName);
  if (exact) return { catalogModelId: exact.id, confidence: 1.0, source: "exact" };

  // Step 2: normalized
  const normalized = normalize(modelName);
  const norm = await db.findCatalogByNormalized(normalized);
  if (norm) return { catalogModelId: norm.id, confidence: 0.95, source: "normalized" };

  // Step 3: alias
  const alias = await db.findCatalogAlias(normalized);
  if (alias) return { catalogModelId: alias.catalogId, confidence: 0.9, source: "alias" };

  // Step 4: keyword family. Family only proves a lineage, not an exact model identity.
  if (options.allowKeywordFallback) {
    const lower = modelName.toLowerCase();

    // 特殊处理：seedance/jimeng 视频模型（它们的 family 是 null）
    if (/seedance|jimeng|doubao.*video/i.test(lower)) {
      const match = await db.findCatalogByIdPrefix("jimeng/");
      if (match) return { catalogModelId: match.id, confidence: 0.7, source: "keyword" };
    }

    // 特殊处理：Grok 视频模型
    if (/grok.*video|imagine.*video/i.test(lower)) {
      const match = await db.findCatalogByIdPrefix("xai/grok%");
      if (match) return { catalogModelId: match.id, confidence: 0.7, source: "keyword" };
    }

    // 特殊处理：Veo 视频模型
    if (/veo|google.*video/i.test(lower)) {
      const match = await db.findCatalogByIdPrefix("google/veo%");
      if (match) return { catalogModelId: match.id, confidence: 0.7, source: "keyword" };
    }

    // 通用 family 推断
    const inferrers = [...(options.customInferrers ?? []), defaultFamilyInferrers];
    for (const infer of inferrers) {
      const family = infer(modelName);
      if (family) {
        const match = await db.findCatalogByFamily(family);
        if (match) {
          return { catalogModelId: match.id, confidence: 0.7, source: "keyword" };
        }
      }
    }
  }

  return { catalogModelId: null, confidence: 0, source: null };
}