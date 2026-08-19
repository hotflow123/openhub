/**
 * 模型引导配置向导（Wizard）
 *
 * 4 个步骤：
 *   Step 1 身份确认（model raw_name → catalog_id 候选）
 *   Step 2 能力选择（endpoint_caps + param_caps + modality）
 *   Step 3 参数细化（adapter_config / param_mapping 默认值）
 *   Step 4 确认生成（写入 variants + 更新 models.caps_* + sites.adapter_id）
 *
 * 没有 LLM 变体时降级为纯手动（候选列表只用目录/关键词）。
 */

import { asc, eq, like } from "drizzle-orm";
import { db } from "../../db/index";
import { models, variants, modelCatalog } from "../../db/schema/index";
import { matchModel } from "@openhub/catalog/matcher";
import type { Modality } from "./types";

// 复用 matcher 的 MatchResult 类型
export type MatchSource = "exact" | "normalized" | "alias" | "keyword" | "admin" | "probe" | "none" | null;
export type MatchConfidence = "high" | "medium" | "low" | null;

export interface WizardStep1Result {
  modelId: string;
  rawName: string;
  siteName: string;
  candidates: Array<{
    catalogId: string | null;
    catalogName: string | null;
    modality: Modality | null;
    confidence: number;
    source: MatchSource;
    family?: string | null;
  }>;
  suggestedModality: Modality | "unknown";
  prefill: {
    catalogModelId: string | null;
    catalogMatchSource: MatchSource;
    catalogMatchConfidence: MatchConfidence;
  };
}

export interface WizardStep2Payload {
  catalogId?: string | null;
  modality: Modality;
  endpointCaps: string[];
  paramCaps: string[];
}

export interface WizardStep3Payload {
  adapterId: string;
  variantName: string;
  description?: string;
  paramOverrides?: Record<string, unknown>;
  paramBlocked?: string[];
  fieldMapping?: Record<string, string>;
}

/**
 * Step 1：身份确认
 */
export async function step1Identity(modelId: string): Promise<WizardStep1Result> {
  const [model] = await db.select().from(models).where(eq(models.id, modelId)).limit(1);
  if (!model) throw new WizardError("model_not_found", 404);

  const match = await matchModel(
    {
      findCatalogById: async (id) => {
        const [row] = await db
          .select({ id: modelCatalog.id })
          .from(modelCatalog)
          .where(eq(modelCatalog.id, id))
          .limit(1);
        return row ? { id: row.id } : undefined;
      },
      findCatalogByNormalized: async (n) => {
        const [row] = await db
          .select({ id: modelCatalog.id })
          .from(modelCatalog)
          .where(eq(modelCatalog.id, n.replace(/\s+/g, "-")))
          .limit(1);
        return row ? { id: row.id } : undefined;
      },
      findCatalogAlias: async (alias) => {
        const { modelCatalogAlias } = await import("../../db/schema/index");
        const [row] = await db
          .select({ catalogId: modelCatalogAlias.catalogId })
          .from(modelCatalogAlias)
          .where(eq(modelCatalogAlias.normalized, alias))
          .orderBy(asc(modelCatalogAlias.priority), asc(modelCatalogAlias.catalogId))
          .limit(1);
        return row ? { catalogId: row.catalogId } : undefined;
      },
      findCatalogByFamily: async (family) => {
        const [row] = await db
          .select({ id: modelCatalog.id })
          .from(modelCatalog)
          .where(eq(modelCatalog.family, family))
          .limit(1);
        return row ? { id: row.id } : undefined;
      },
      findCatalogByIdPrefix: async (prefix) => {
        const [row] = await db
          .select({ id: modelCatalog.id })
          .from(modelCatalog)
          .where(like(modelCatalog.id, prefix))
          .limit(1);
        return row ? { id: row.id } : undefined;
      },
    },
    model.rawName,
    { allowKeywordFallback: true },
  );

  // 再做一次 LIKE 搜索，给管理员手动挑选的备选
  const likeRows = await db
    .select({
      id: modelCatalog.id,
      name: modelCatalog.name,
      modalitiesIn: modelCatalog.modalitiesIn,
      modalitiesOut: modelCatalog.modalitiesOut,
      family: modelCatalog.family,
    })
    .from(modelCatalog)
    .where(eq(modelCatalog.id, model.rawName))
    .limit(5);

  const candidates: WizardStep1Result["candidates"] = [];

  if (match.catalogModelId) {
    const [hit] = await db
      .select({
        name: modelCatalog.name,
        modalitiesIn: modelCatalog.modalitiesIn,
        modalitiesOut: modelCatalog.modalitiesOut,
        family: modelCatalog.family,
      })
      .from(modelCatalog)
      .where(eq(modelCatalog.id, match.catalogModelId))
      .limit(1);
    candidates.push({
      catalogId: match.catalogModelId,
      catalogName: hit?.name ?? null,
      modality: inferModalityFromCatalog(hit?.modalitiesIn, hit?.modalitiesOut),
      confidence: match.confidence,
      source: match.source,
      family: hit?.family ?? null,
    });
  }

  for (const row of likeRows) {
    if (candidates.some((c) => c.catalogId === row.id)) continue;
    candidates.push({
      catalogId: row.id,
      catalogName: row.name,
      modality: inferModalityFromCatalog(row.modalitiesIn, row.modalitiesOut),
      confidence: 0.5,
      source: "keyword",
      family: row.family ?? null,
    });
  }

  if (candidates.length === 0) {
    candidates.push({
      catalogId: null,
      catalogName: null,
      modality: null,
      confidence: 0,
      source: null,
    });
  }

  const suggestedModality: Modality | "unknown" =
    candidates[0]?.modality ?? guessModalityFromName(model.rawName);

  const { sites } = await import("../../db/schema/index");
  const [site] = await db.select().from(sites).where(eq(sites.id, model.siteId)).limit(1);

  return {
    modelId: model.id,
    rawName: model.rawName,
    siteName: site?.name ?? "unknown",
    candidates,
    suggestedModality,
    prefill: {
      catalogModelId: model.catalogModelId,
      catalogMatchSource: (model.catalogMatchSource as MatchSource) ?? null,
      catalogMatchConfidence: (model.catalogMatchConfidence as MatchConfidence) ?? null,
    },
  };
}

/**
 * Step 2：能力选择
 */
export function step2Capability(
  modality: Modality,
  suggestedEndpointCaps: string[] = [],
  suggestedParamCaps: string[] = [],
) {
  const template = capabilityTemplates[modality];
  return {
    modality,
    template: {
      endpoint_caps: template.endpoint_caps,
      param_caps: template.param_caps,
    },
    suggested: {
      endpoint_caps: mergeUnique(template.endpoint_caps, suggestedEndpointCaps),
      param_caps: mergeUnique(template.param_caps, suggestedParamCaps),
    },
  };
}

/**
 * Step 3：参数细化
 */
export function step3Params() {
  return {
    adapter_id_options: ["openai", "kling", "wan", "seedance", "grok"],
    param_mapping_template: {
      param_overrides: {},
      param_blocked: [],
      field_mapping: {},
    },
    adapter_config_template: {
      fixedParams: {},
      param_defaults: {},
      transforms: {},
    },
  };
}

/**
 * Step 4：确认生成
 *
 * 严格按 DESIGN 7 章：
 * - 更新 model.caps_overridden = 1（人工已确认）
 * - 写入 endpoint_caps / param_caps / modality / caps_overridden
 * - 写入 catalog_* 关联字段
 * - 创建 variant（拆三字段 param_overrides/param_blocked/field_mapping）
 */
export async function step4Confirm(
  modelId: string,
  step2: WizardStep2Payload,
  step3: WizardStep3Payload,
): Promise<{ modelId: string; variantId: string }> {
  const [model] = await db.select().from(models).where(eq(models.id, modelId)).limit(1);
  if (!model) throw new WizardError("model_not_found", 404);

  const now = new Date();
  // 更新 model
  await db
    .update(models)
    .set({
      catalogModelId: step2.catalogId ?? null,
      catalogMatchSource: "admin",
      catalogMatchConfidence: "high",
      catalogSyncedAt: now,
      updatedAt: now,
      modality: step2.modality,
      endpointCaps: JSON.stringify(step2.endpointCaps),
      paramCaps: JSON.stringify(step2.paramCaps),
      capsOverridden: 1,
      syncedAt: now,
      status: "active",
    })
    .where(eq(models.id, modelId));

  // 创建 variant
  const variantId = `var_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const adapterConfig = JSON.stringify({
    fixedParams: {},
    param_defaults: {},
    transforms: {},
  });

  await db.insert(variants).values({
    id: variantId,
    name: step3.variantName,
    description: step3.description ?? null,
    modelId: model.id,
    adapterConfig,
    paramOverrides: step3.paramOverrides ? JSON.stringify(step3.paramOverrides) : null,
    paramBlocked: step3.paramBlocked ? JSON.stringify(step3.paramBlocked) : null,
    fieldMapping: step3.fieldMapping ? JSON.stringify(step3.fieldMapping) : null,
    isPublic: 1,
    createdAt: now,
    updatedAt: now,
  });

  // 站点 adapter_id 也同步更新
  if (step3.adapterId) {
    const { sites } = await import("../../db/schema/index");
    await db
      .update(sites)
      .set({ adapterId: step3.adapterId, updatedAt: now })
      .where(eq(sites.id, model.siteId));
  }

  return { modelId: model.id, variantId };
}

export class WizardError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

// ───────── helpers ─────────

function inferModalityFromCatalog(inJson: string | null, outJson: string | null): Modality | null {
  const inM = inJson ? (JSON.parse(inJson) as string[]) : [];
  const outM = outJson ? (JSON.parse(outJson) as string[]) : [];
  if (outM.includes("video")) return "video";
  if (outM.includes("image")) return "image";
  if (outM.includes("audio") || inM.includes("audio")) return "audio";
  if (outM.includes("text")) return "llm";
  if (outM.includes("embedding")) return "embedding";
  return null;
}

function guessModalityFromName(name: string): Modality | "unknown" {
  const n = name.toLowerCase();
  if (/(sora|kling|runway|veo|pika|hailuo|jimeng|seedance|wan|grok-imagine|veo-|dream-machine)/.test(n)) return "video";
  if (/(dall-e|stable-diffusion|sd-|flux|imagen|ideogram|recraft)/.test(n)) return "image";
  if (/(whisper|tts|speech|elevenlabs|melotts|lyria|bark|vits)/.test(n)) return "audio";
  if (/(embedding|embed|bge-|voyage-|text-embedding)/.test(n)) return "embedding";
  if (/(gpt|claude|llama|qwen|deepseek|gemini|kimi|moonshot|ernie|glm|hunyuan|grok|sonar|mistral|yi-)/.test(n))
    return "llm";
  return "unknown";
}

function mergeUnique(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}

const capabilityTemplates: Record<Modality, { endpoint_caps: string[]; param_caps: string[] }> = {
  llm: {
    endpoint_caps: ["chat", "vision", "function_calling"],
    param_caps: ["stream", "tool_choice", "json_mode", "seed"],
  },
  embedding: { endpoint_caps: ["embedding"], param_caps: [] },
  image: { endpoint_caps: ["image_generation"], param_caps: [] },
  audio: { endpoint_caps: ["tts", "stt"], param_caps: [] },
  video: { endpoint_caps: ["video_generation"], param_caps: [] },
};