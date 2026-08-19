/**
 * LLM 模型能力推理引擎
 *
 * 当模型无法通过规则匹配到 catalog 时，用 LLM 做智能推断。
 *
 * 完整流程：
 *   1. 构建上下文：从 knowledge base（fal.ai Schema + catalog）找相似模型
 *   2. 构造 prompt：告诉 LLM 这个模型名可能的含义，让它推断能力
 *   3. 调用 LLM（通过 inferFromVariant）
 *   4. 解析 JSON 响应，校验结构
 *   5. 返回结构化的 ModelCapability 供用户确认
 *
 * 知识库上下文（决定推理质量）：
 *   - LLM 模型：从 model_catalog 找同名或 family 相同的模型
 *   - 视频模型：从 model_schema_catalog 找 fal.category=video 的模型（按名称相似度排序）
 *   - 图像模型：从 model_schema_catalog 找 fal.category=image 的模型
 *   - 音频模型：从 model_schema_catalog 找 fal.category=audio 的模型
 */

import { eq } from "drizzle-orm";
import { inferFromVariant } from "./infer";
import { db } from "../db/index";
import { modelCatalog, modelSchemaCatalog, models, variants } from "../db/schema/index";

/** 推理结果：完整的模型能力 */
export interface ModelCapability {
  /** LLM 推断的模型厂商（可能是 LLM 推断的） */
  inferredVendor: string | null;
  /** LLM 推断的模型家族 */
  inferredFamily: string | null;
  /** LLM 推断的模型版本 */
  inferredVersion: string | null;
  /** 模态 */
  modality: "llm" | "image" | "video" | "audio" | "embedding" | "unknown";
  /** 输入模态 */
  modalitiesIn: string[];
  /** 输出模态 */
  modalitiesOut: string[];
  /** LLM 特有能力 */
  llm?: {
    reasoning: boolean;
    toolCall: boolean;
    structuredOutput: boolean;
    attachment: boolean;
    temperature: boolean;
    contextWindow: number | null;
    inputLimit: number | null;
    outputLimit: number | null;
    knowledgeCutoff: string | null;
  };
  /** 视频模型特有参数 */
  video?: {
    maxDurationSec: number;
    supportedResolutions: string[];
    supportedAspectRatios: string[];
    maxReferenceImages: number;
    supportsReferenceVideo: boolean;
    supportsReferenceAudio: boolean;
    requiresAsync: boolean;
    falEndpointId: string | null;
    falParameters: FalParameter[] | null;
  };
  /** 图像模型特有参数 */
  image?: {
    maxResolution: string;
    supportedSizes: string[];
    maxReferenceImages: number;
    supportsMask: boolean;
    supportsControlNet: boolean;
    falEndpointId: string | null;
    falParameters: FalParameter[] | null;
  };
  /** 音频模型特有参数 */
  audio?: {
    maxDurationSec: number;
    supportsVoiceClone: boolean;
    supportsEmotionControl: boolean;
    falEndpointId: string | null;
    falParameters: FalParameter[] | null;
  };
  /** 置信度 0-1 */
  confidence: number;
  /** 推理说明 */
  reasoning: string;
}

/** fal.ai 参数结构（扁平化） */
export interface FalParameter {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

/** 推理选项 */
export interface InferCapabilityOptions {
  /** 调用的 LLM variant 名称（默认使用第一个可用的 LLM variant） */
  variantName?: string;
  /** 超时 ms（默认 30000） */
  timeoutMs?: number;
  /** 最大输出 tokens（默认 2048） */
  maxTokens?: number;
  /** 强制 modality 猜测（不指定则让 LLM 自己判断） */
  forcedModality?: ModelCapability["modality"];
}

interface CatalogModelRow {
  id: string;
  labId: string;
  labName: string | null;
  name: string;
  family: string | null;
  modalitiesIn: string | null;
  modalitiesOut: string | null;
  reasoning: number | null;
  toolCall: number | null;
  structuredOutput: number | null;
  attachment: number | null;
  temperature: number | null;
  contextLimit: number | null;
  inputLimit: number | null;
  outputLimit: number | null;
  description: string | null;
}

interface SchemaModelRow {
  endpointId: string;
  title: string;
  modality: string;
  falCategory: string | null;
  falSource: string | null;
  description: string | null;
  pricing: string | null;
  parameters: string | null;
}

// ─────────────────────────────────────────────────────────────────
// 上下文构建
// ─────────────────────────────────────────────────────────────────

/** 从 catalog 找相似 LLM 模型（按名称相似度） */
async function buildLlmContext(rawName: string): Promise<string> {
  const candidates = await db
    .select({
      id: modelCatalog.id,
      labId: modelCatalog.labId,
      labName: modelCatalog.labName,
      name: modelCatalog.name,
      family: modelCatalog.family,
      modalitiesIn: modelCatalog.modalitiesIn,
      modalitiesOut: modelCatalog.modalitiesOut,
      reasoning: modelCatalog.reasoning,
      toolCall: modelCatalog.toolCall,
      structuredOutput: modelCatalog.structuredOutput,
      attachment: modelCatalog.attachment,
      temperature: modelCatalog.temperature,
      contextLimit: modelCatalog.contextLimit,
      inputLimit: modelCatalog.inputLimit,
      outputLimit: modelCatalog.outputLimit,
      description: modelCatalog.description,
    })
    .from(modelCatalog)
    .limit(30);

  // 按名称相似度排序
  const normalizedRaw = rawName.toLowerCase().replace(/[_\-\.\s]/g, "");
  const scored = candidates.map((c) => {
    const n = c.name.toLowerCase().replace(/[_\-\.\s]/g, "");
    const score = normalizedRaw.includes(n) || n.includes(normalizedRaw) ? 1 : 0;
    return { ...c, _score: score };
  });
  scored.sort((a: typeof scored[number], b: typeof scored[number]) => b._score - a._score);
  const top = scored.slice(0, 10);

  if (top.length === 0) return "";

  const lines = top.map((c) => {
    const caps = [
      c.reasoning ? "支持推理" : "",
      c.toolCall ? "支持工具调用" : "",
      c.structuredOutput ? "支持结构化输出" : "",
      c.attachment ? "支持附件上传" : "",
      c.temperature ? "支持温度调节" : "",
    ]
      .filter(Boolean)
      .join("; ");
    const ctx = c.contextLimit ? `上下文 ${c.contextLimit.toLocaleString()} tokens` : "";
    const mods = [c.modalitiesIn, c.modalitiesOut].filter(Boolean).join(" -> ");
    return `- ${c.id}: ${c.labName ?? c.labId} ${c.name} (${c.family ?? "无家族"})${mods ? ` [${mods}]` : ""}${caps ? ` {${caps}}` : ""}${ctx ? ` ${ctx}` : ""}`;
  });

  return lines.join("\n");
}

/** 从 fal.ai Schema 找相似模型（video/image/audio） */
async function buildFalContext(
  rawName: string,
  modality: string,
): Promise<string> {
  // 归一化模型名用于搜索
  const normalizedRaw = rawName
    .toLowerCase()
    .replace(/[_\-\.\s]/g, " ")
    .trim();

  // 提取关键词
  const keywords = normalizedRaw.split(/\s+/).filter((k) => k.length > 1);

  // 找 fal category
  const falCategory = modality === "video" ? "text-to-video" : modality === "image" ? "text-to-image" : modality === "audio" ? "text-to-audio" : null;

  const query = db
    .select({
      endpointId: modelSchemaCatalog.endpointId,
      title: modelSchemaCatalog.title,
      modality: modelSchemaCatalog.modality,
      falCategory: modelSchemaCatalog.falCategory,
      description: modelSchemaCatalog.description,
      parameters: modelSchemaCatalog.parameters,
      pricing: modelSchemaCatalog.pricing,
    })
    .from(modelSchemaCatalog)
    .limit(50);

  const allRows = await query;
  const filtered = falCategory
    ? allRows.filter((r) => r.falCategory === falCategory)
    : allRows.filter((r) => r.modality === modality);

  // 按关键词命中数排序
  const scored = filtered.map((r) => {
    const n = r.title.toLowerCase().replace(/[_\-\.\s]/g, " ");
    const hits = keywords.filter((k) => n.includes(k)).length;
    return { ...r, _hits: hits };
  });
  scored.sort((a: typeof scored[number], b: typeof scored[number]) => b._hits - a._hits);
  const top = scored.slice(0, 8);

  if (top.length === 0) return "";

  const lines = top.map((r) => {
    let params = "";
    if (r.parameters && typeof r.parameters === "string") {
      try {
        const ps = JSON.parse(r.parameters) as FalParameter[];
        params = ps.map((p) => p.name).join(", ");
      } catch {
        params = "";
      }
    }
    return `- ${r.endpointId}: ${r.title}${params ? ` [{${params}}]` : ""}${r.pricing ? ` [${r.pricing}]` : ""}`;
  });

  return lines.join("\n");
}

/** 猜测最可能的 modality */
function guessModality(rawName: string): ModelCapability["modality"] {
  const n = rawName.toLowerCase();
  if (/video|t2v|i2v|gen-video|sora|kling|wan|hailuo|seedance|runway|pixverse/.test(n)) return "video";
  if (/image|img|gen-image|flux|stable.?diffusion|dalle|recraft|midjourney|stable.?image/.test(n)) return "image";
  if (/audio|speech|tts|stt|voice|music|sound|elevenlabs|kokoro/.test(n)) return "audio";
  if (/embedding|embed/.test(n)) return "embedding";
  if (/gpt|claude|gemini|llama|qwen|deepseek|minimax|moonshot|kimi|bailian|yi|step|mistral|mixtral|command/.test(n)) return "llm";
  return "unknown";
}

/** 基于规则的推断（LLM 调用失败时的 fallback） */
function buildRuleBasedInference(
  rawName: string,
  modality: ModelCapability["modality"],
  llmContext: string,
  falContext: string,
): ModelCapability {
  const n = rawName.toLowerCase();
  
  // 提取厂商
  let vendor: string | null = null;
  let family: string | null = null;
  let version: string | null = null;
  
  if (/doubao|bytedance/.test(n)) {
    vendor = "Doubao / ByteDance";
    if (/seedance/.test(n)) family = "seedance";
  } else if (/claude/.test(n)) {
    vendor = "Anthropic";
    family = "claude";
  } else if (/gpt/.test(n)) {
    vendor = "OpenAI";
    family = "gpt";
  } else if (/gemini/.test(n)) {
    vendor = "Google";
    family = "gemini";
  } else if (/deepseek/.test(n)) {
    vendor = "DeepSeek";
    family = "deepseek";
  } else if (/grok/.test(n)) {
    vendor = "xAI";
    family = "grok";
  } else if (/kling/.test(n)) {
    vendor = "Kuaishou";
    family = "kling";
  } else if (/wan|wanx/.test(n)) {
    vendor = "Alibaba";
    family = "wan";
  } else if (/hailuo/.test(n)) {
    vendor = "MiniMax";
    family = "hailuo";
  }
  
  // 提取版本号
  const versionMatch = n.match(/\d+(?:\.\d+)?(?:-\d+)?/);
  if (versionMatch) version = versionMatch[0];
  
  // 按 modality 构造能力
  const base: ModelCapability = {
    inferredVendor: vendor,
    inferredFamily: family,
    inferredVersion: version,
    modality,
    modalitiesIn: modality === "llm" ? ["text"] : ["text", "image"],
    modalitiesOut: modality === "llm" ? ["text"] : [modality],
    confidence: vendor && family ? 0.7 : 0.5,
    reasoning: `规则推断（LLM 调用失败）：从模型名识别出 ${vendor || "未知厂商"} ${family || "未知家族"}`,
  };
  
  if (modality === "llm") {
    base.llm = {
      reasoning: /thinking|reason/.test(n),
      toolCall: true,
      structuredOutput: true,
      attachment: /vision|omni/.test(n),
      temperature: true,
      contextWindow: 128000,
      inputLimit: 128000,
      outputLimit: 4096,
      knowledgeCutoff: null,
    };
  } else if (modality === "video") {
    base.video = {
      maxDurationSec: 10,
      supportedResolutions: ["720p", "1080p"],
      supportedAspectRatios: ["16:9", "9:16", "1:1"],
      maxReferenceImages: 1,
      supportsReferenceVideo: false,
      supportsReferenceAudio: false,
      requiresAsync: true,
      falEndpointId: null,
      falParameters: null,
    };
  } else if (modality === "image") {
    base.image = {
      maxResolution: "2048x2048",
      supportedSizes: ["1024x1024", "512x512"],
      maxReferenceImages: 1,
      supportsMask: false,
      supportsControlNet: false,
      falEndpointId: null,
      falParameters: null,
    };
  } else if (modality === "audio") {
    base.audio = {
      maxDurationSec: 60,
      supportsVoiceClone: false,
      supportsEmotionControl: false,
      falEndpointId: null,
      falParameters: null,
    };
  }
  
  return base;
}

// ─────────────────────────────────────────────────────────────────
// Prompt 构建
// ─────────────────────────────────────────────────────────────────

function buildCapabilityInferPrompt(
  rawName: string,
  modality: ModelCapability["modality"],
  llmContext: string,
  falContext: string,
  forcedModality: ModelCapability["modality"] | undefined,
): string {
  const modalityHint = forcedModality
    ? `已知模态：${forcedModality}（仅作为参考，模型名可能误导）`
    : "模态：未知（请自行判断）";

  return `你是一个 AI 模型能力推理专家。请根据模型名称推断该模型的完整能力。

## 待推理模型
名称：${rawName}
${modalityHint}

## 可用知识库上下文

### LLM 模型参考（来自 model_catalog）
${llmContext || "（无相关 LLM 参考）"}

### 视频/图像/音频模型参考（来自 fal.ai Schema）
fal.ai 是全球最大的 AI 生成模型聚合平台，以下是与其名称相似的模型及其参数结构：

${falContext || "（无相关生成模型参考）"}

## 输出要求

请输出一个 JSON 对象，包含对该模型能力的完整推断：

\`\`\`json
{
  "inferredVendor": "厂商名，如 Doubao / OpenAI / MiniMax",
  "inferredFamily": "模型家族，如 seedance / gpt / kling",
  "inferredVersion": "版本号，如 2.5 / 4o / v3",
  "modality": "llm | image | video | audio | embedding | unknown",
  "modalitiesIn": ["text", "image"] // 输入模态数组
  "modalitiesOut": ["text"] // 输出模态数组
  "confidence": 0.75, // 0-1 的置信度
  "reasoning": "推断理由，简短描述为什么这样判断",
  // modality = llm 时必填
  "llm": {
    "reasoning": true,
    "toolCall": false,
    "structuredOutput": true,
    "attachment": true,
    "temperature": true,
    "contextWindow": 128000,
    "inputLimit": 128000,
    "outputLimit": 16384,
    "knowledgeCutoff": "2025-06"
  },
  // modality = video 时必填
  "video": {
    "maxDurationSec": 10,
    "supportedResolutions": ["720p", "1080p"],
    "supportedAspectRatios": ["16:9", "9:16", "1:1"],
    "maxReferenceImages": 3,
    "supportsReferenceVideo": false,
    "supportsReferenceAudio": false,
    "requiresAsync": true,
    "falEndpointId": "bytedance/seedance-2.5/text-to-video" // 如果 fal.ai 有对应模型
  },
  // modality = image 时必填
  "image": {
    "maxResolution": "2048x2048",
    "supportedSizes": ["1024x1024", "512x512"],
    "maxReferenceImages": 1,
    "supportsMask": true,
    "supportsControlNet": false,
    "falEndpointId": null
  },
  // modality = audio 时必填
  "audio": {
    "maxDurationSec": 60,
    "supportsVoiceClone": true,
    "supportsEmotionControl": false,
    "falEndpointId": null
  }
}
\`\`\`

## 规则

1. 只输出 JSON，不要有 markdown 格式、不要有解释
2. 如果不确定某个字段，设为 null 而非猜测
3. confidence 要反映你的确定性：名字很明确（seedance/kling/gpt）时 0.9+，模糊名称（random-model-123）时 0.3-0.5
4. 如果 falContext 中有名称完全匹配的模型，直接使用那个模型的参数结构，confidence 设为 0.95+
5. modality 优先从 falContext 推断（fal.ai 的 category 映射比模型名更可靠）
6. 视频模型优先匹配 falContext 中的 video 模型；图像匹配 falContext 中的 image 模型
7. 如果模型是 LLM 但 falContext 出现了视频模型，按 LLM 处理（可能模型名误导）
`;
}

// ─────────────────────────────────────────────────────────────────
// JSON 解析
// ─────────────────────────────────────────────────────────────────

function parseCapabilityJson(raw: string): ModelCapability | null {
  // 去掉 markdown 代码块包裹
  let cleaned = raw.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  try {
    return JSON.parse(cleaned) as ModelCapability;
  } catch {
    // 尝试用正则提取 JSON
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]!) as ModelCapability;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// 校验推断结果
// ─────────────────────────────────────────────────────────────────

function validateCapability(cap: ModelCapability): cap is ModelCapability {
  if (!cap.modality) return false;
  if (typeof cap.confidence !== "number" || cap.confidence < 0 || cap.confidence > 1) return false;
  if (!Array.isArray(cap.modalitiesIn) || !Array.isArray(cap.modalitiesOut)) return false;
  const valid = ["llm", "image", "video", "audio", "embedding", "unknown"] as const;
  if (!valid.includes(cap.modality)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────
// 主推理函数
// ─────────────────────────────────────────────────────────────────

/** 找可用的 LLM variant（用于推理调用） */
async function findInferVariant(): Promise<string | null> {
  const rows = await db
    .select({ name: variants.name, modelId: variants.modelId })
    .from(variants)
    .leftJoin(models, eq(variants.modelId, models.id))
    .where(eq(models.modality, "llm"))
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0]!.name;
}

/**
 * 对指定模型执行 LLM 能力推断
 */
export async function inferModelCapability(
  rawName: string,
  options: InferCapabilityOptions = {},
): Promise<ModelCapability> {
  // 1. 猜测 modality（优先从 fal context 确定）
  const guessedModality = guessModality(rawName);
  const modality = options.forcedModality ?? guessedModality;

  // 2. 构建上下文
  const [llmContext, falContext] = await Promise.all([
    buildLlmContext(rawName),
    buildFalContext(rawName, modality),
  ]);

  // 3. 构造 prompt
  const prompt = buildCapabilityInferPrompt(rawName, modality, llmContext, falContext, options.forcedModality);

  // 4. 找可用的推理 variant
  const variantName = options.variantName ?? (await findInferVariant());
  if (!variantName) {
    return {
      inferredVendor: null,
      inferredFamily: null,
      inferredVersion: null,
      modality: "unknown",
      modalitiesIn: [],
      modalitiesOut: [],
      confidence: 0,
      reasoning: "无可用的 LLM variant 进行推理",
    };
  }

  // 5. 调用 LLM
  let text = "";
  try {
    const result = await inferFromVariant(variantName, [
      { role: "user" as const, content: prompt },
    ], {
      maxTokens: options.maxTokens ?? 2048,
      temperature: 0.1,
      timeoutMs: options.timeoutMs ?? 30_000,
    });
    text = result.text;
  } catch (err) {
    // Fallback: 当 LLM 调用失败时，返回基于规则的推断
    console.warn(`[infer] LLM call failed, using rule-based fallback:`, err);
    
    return buildRuleBasedInference(rawName, modality, llmContext, falContext);
  }

  // 6. 解析 JSON
  const parsed = parseCapabilityJson(text);
  if (!parsed || !validateCapability(parsed)) {
    return {
      inferredVendor: null,
      inferredFamily: null,
      inferredVersion: null,
      modality: modality === "unknown" ? "unknown" : modality,
      modalitiesIn: [],
      modalitiesOut: [],
      confidence: 0,
      reasoning: `LLM 返回格式无法解析: ${text.slice(0, 200)}`,
    };
  }

  return parsed;
}

/**
 * 单个模型的推理结果
 */
export interface ModelInferResult {
  modelId: string;
  rawName: string;
  success: boolean;
  capability?: ModelCapability;
  error?: string;
}

/**
 * 对站点下所有未匹配的模型批量执行 LLM 推理
 * 跳过已有 catalogModelId 或已有 catalogMatchSource != 'none' 的模型
 */
export async function inferUnmatchedModels(siteId: string): Promise<{
  total: number;
  inferred: number;
  failed: number;
  results: ModelInferResult[];
}> {
  const rows = await db
    .select({
      id: models.id,
      rawName: models.rawName,
      modality: models.modality,
      catalogModelId: models.catalogModelId,
      schemaEndpointId: models.schemaEndpointId,
    })
    .from(models)
    .where(eq(models.siteId, siteId));

  // 只推理未匹配的
  const unmatched = rows.filter(
    (r) => !r.catalogModelId || r.catalogModelId === "none",
  );

  const results: ModelInferResult[] = [];

  for (const row of unmatched) {
    try {
      const capability = await inferModelCapability(row.rawName);
      results.push({
        modelId: row.id,
        rawName: row.rawName,
        success: capability.confidence > 0,
        capability: capability.confidence > 0 ? capability : undefined,
        error: capability.confidence === 0 ? capability.reasoning : undefined,
      });
    } catch (err) {
      results.push({
        modelId: row.id,
        rawName: row.rawName,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    total: unmatched.length,
    inferred: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}
