/**
 * LLM 推断服务（internal-only）
 *
 * 让 OpenHub 自身可以调用任意公开 chat 变体（variant）：
 *  - 用途：识别新模型能力、修复历史 caption、catalog 推断等。
 *  - 不走用户 API Key 限制（用 admin system token 而非 hubKey）
 *  - 不计入租户配额
 *
 * 用法（不在路由内直接暴露；仅供内部脚本调用）：
 *   import { inferFromVariant } from "../../engine/infer";
 *   const result = await inferFromVariant("e2e-wizard-...", [{role:"user",content:"..."}]);
 */
import { db } from "../db/index";
import { variants, models, sites } from "../db/schema/index";
import { eq } from "drizzle-orm";
import { decrypt, getMasterKey } from "../lib/crypto";
import { mapParams } from "./param-mapper";
import type { Variant } from "../db/schema/index";
import type { ChatRequest } from "./adapter";

export interface InferMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface InferOptions {
  /** max tokens */
  maxTokens?: number;
  /** temperature */
  temperature?: number;
  /** 超时毫秒 */
  timeoutMs?: number;
  /** 强制 stream=false */
  stream?: false;
}

export interface InferResult {
  text: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  raw: unknown;
}

function applyVariantParamMapping(
  body: Record<string, unknown>,
  variant: Variant | undefined,
): ChatRequest {
  if (!variant) return body as ChatRequest;
  try {
    const { body: mapped } = mapParams({
      callerBody: body,
      variant: {
        param_overrides: variant.paramOverrides ? JSON.parse(variant.paramOverrides) : undefined,
        param_blocked: variant.paramBlocked ? JSON.parse(variant.paramBlocked) : undefined,
        field_mapping: variant.fieldMapping ? JSON.parse(variant.fieldMapping) : undefined,
        adapter_config: variant.adapterConfig ? JSON.parse(variant.adapterConfig) : undefined,
      },
      adapter: {},
    });
    return mapped as unknown as ChatRequest;
  } catch (e) {
    console.error("[infer] param apply failed:", e);
    return body as ChatRequest;
  }
}

/**
 * 通过指定 variantName 调用任意 LLM chat 变体
 */
export async function inferFromVariant(
  variantName: string,
  messages: InferMessage[],
  options: InferOptions = {},
): Promise<InferResult> {
  const [variant] = await db
    .select()
    .from(variants)
    .where(eq(variants.name, variantName))
    .limit(1);
  if (!variant) throw new Error(`variant not found: ${variantName}`);

  const [modelRow] = await db
    .select()
    .from(models)
    .where(eq(models.id, variant.modelId))
    .limit(1);
  if (!modelRow) throw new Error(`model not found: ${variant.modelId}`);

  const [site] = await db
    .select()
    .from(sites)
    .where(eq(sites.id, modelRow.siteId))
    .limit(1);
  if (!site) throw new Error(`site not found: ${modelRow.siteId}`);

  const apiKey = await decrypt(site.apiKeyEnc, site.apiKeyIv, getMasterKey());

  const body = applyVariantParamMapping(
    {
      model: modelRow.rawName,
      messages,
      stream: false,
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    } as Record<string, unknown>,
    variant,
  );

  const url = `${site.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`upstream ${resp.status}: ${text.slice(0, 500)}`);
  }

  const json = (await resp.json()) as Record<string, unknown>;
  const choices = (json.choices ?? []) as Array<{ message?: { content?: string } }>;
  const text = choices[0]?.message?.content ?? "";
  const usage = json.usage as InferResult["usage"] | undefined;
  return { text, usage, raw: json };
}

// ============================================================
// 模型能力推理引擎
// ============================================================

export interface VideoCapability {
  maxDurationSec?: number;
  supportedResolutions?: string[];
  requiresAsync?: boolean;
  durationEnum?: Array<string | number>;
  aspectRatios?: string[];
  requiredParams?: string[];
  optionalParams?: string[];
  generateAudio?: boolean;
  // 完整参数快照（来自 fal.ai parameters[]）
  parameters?: ParameterSnapshot[];
}

export interface ImageCapability {
  supportedSizes?: string[];
  supportsInpainting?: boolean;
  requiredParams?: string[];
  optionalParams?: string[];
  parameters?: ParameterSnapshot[];
}

export interface AudioCapability {
  supportedFormats?: string[];
  maxDurationSec?: number;
  requiredParams?: string[];
  optionalParams?: string[];
  parameters?: ParameterSnapshot[];
}

/**
 * 单个参数快照（来自 fal.ai parameters[] 数组中的每条记录）
 */
export interface ParameterSnapshot {
  name: string;
  type: string;
  required: boolean;
  nullable?: boolean;
  default?: unknown;
  enum?: unknown[];
  description?: string;
  examples?: unknown[];
  items?: unknown;
}

export interface InferredCapability {
  inferredVendor?: string;
  inferredFamily?: string;
  inferredVersion?: string;
  modality: "llm" | "video" | "image" | "audio";
  confidence: number;
  // fal.ai schema 元数据快照
  falEndpointId?: string;
  falSource?: "queue" | "realtime";
  falCategory?: string;
  pricing?: string;
  description?: string;
  /** 原始 fal input schema（保留完整参数结构） */
  inputSchema?: string | Record<string, unknown> | null;
  // 完整 parameters 数组（来自 fal.ai 百科）
  parameters?: ParameterSnapshot[];
  llm?: {
    contextWindow?: number;
    supportsVision?: boolean;
    supportsFunctionCalling?: boolean;
  };
  video?: VideoCapability;
  image?: ImageCapability;
  audio?: AudioCapability;
}

export interface InferOptions {
  /** 可选的 fal.ai schema endpoint_id（从 fal 百科关联） */
  schemaEndpointId?: string | null;
  /** 可选的站点 ID */
  siteId?: string;
}

/**
 * 规则引擎：通过模型名称推断能力
 */
function inferByRules(rawName: string): InferredCapability | null {
  const lower = rawName.toLowerCase();

  // Video 模型识别
  if (
    lower.includes("video") ||
    lower.includes("seedance") ||
    lower.includes("kling") ||
    lower.includes("sora") ||
    lower.includes("veo") ||
    lower.includes("imagine-video") ||
    lower.match(/\bh3video\b/)
  ) {
    let vendor = "Unknown";
    let family = "";
    let version = "";

    // 识别厂商
    if (lower.includes("doubao") || lower.includes("seedance")) {
      vendor = "Doubao / ByteDance";
      family = "seedance";
      // 提取版本：doubao-seedance-2-0 -> 2-0
      const match = rawName.match(/seedance[-_]?([\d.-]+)/i);
      version = match ? match[1] : "";
    } else if (lower.includes("kling")) {
      vendor = "Kuaishou";
      family = "kling";
      const match = rawName.match(/kling[-_]?([\d.]+)/i);
      version = match ? match[1] : "";
    } else if (lower.includes("sora")) {
      vendor = "OpenAI";
      family = "sora";
      const match = rawName.match(/sora[-_]?v?([\d.-]+)/i);
      version = match ? match[1] : "";
    } else if (lower.includes("veo")) {
      vendor = "Google";
      family = "veo";
      const match = rawName.match(/veo[-_]?([\d.]+)/i);
      version = match ? match[1] : "";
    } else if (lower.includes("imagine-video") || lower.includes("grok-imagine")) {
      vendor = "xAI";
      family = "grok-imagine-video";
      const match = rawName.match(/imagine[-_]video[-_]?([\d.]+)/i);
      version = match ? match[1] : "";
    }

    return {
      inferredVendor: vendor,
      inferredFamily: family,
      inferredVersion: version,
      modality: "video",
      confidence: 0.9,
      video: {
        maxDurationSec: 10,
        supportedResolutions: ["720p", "1080p"],
        requiresAsync: true,
      },
    };
  }

  // Image 模型识别
  if (
    lower.includes("image") ||
    lower.includes("flux") ||
    lower.includes("dall-e") ||
    lower.includes("dalle") ||
    lower.includes("midjourney") ||
    lower.includes("sd-") ||
    lower.includes("stable-diffusion")
  ) {
    let vendor = "Unknown";
    let family = "";

    if (lower.includes("flux")) {
      vendor = "Black Forest Labs";
      family = "flux";
    } else if (lower.includes("dall-e") || lower.includes("dalle")) {
      vendor = "OpenAI";
      family = "dall-e";
    } else if (lower.includes("gpt") && lower.includes("image")) {
      vendor = "OpenAI";
      family = "gpt-image";
    } else if (lower.includes("gemini") && lower.includes("image")) {
      vendor = "Google";
      family = "gemini-image";
    } else if (lower.includes("sd-") || lower.includes("stable-diffusion")) {
      vendor = "Stability AI";
      family = "stable-diffusion";
    }

    return {
      inferredVendor: vendor,
      inferredFamily: family,
      modality: "image",
      confidence: 0.85,
      image: {
        supportedSizes: ["512x512", "1024x1024"],
        supportsInpainting: false,
      },
    };
  }

  // Audio 模型识别
  if (lower.includes("whisper") || lower.includes("audio") || lower.includes("tts")) {
    let vendor = "Unknown";
    let family = "";

    if (lower.includes("whisper")) {
      vendor = "OpenAI";
      family = "whisper";
    }

    return {
      inferredVendor: vendor,
      inferredFamily: family,
      modality: "audio",
      confidence: 0.8,
      audio: {
        supportedFormats: ["mp3", "wav"],
        maxDurationSec: 300,
      },
    };
  }

  // LLM 模型识别
  let vendor = "Unknown";
  let family = "";
  let version = "";

  if (lower.includes("gpt")) {
    vendor = "OpenAI";
    family = "gpt";
    const match = rawName.match(/gpt[-_]?([\d.]+)/i);
    version = match ? match[1] : "";
  } else if (lower.includes("claude")) {
    vendor = "Anthropic";
    family = "claude";
    const match = rawName.match(/claude[-_](\w+)[-_]?([\d.]+)/i);
    if (match) {
      family = `claude-${match[1]}`;
      version = match[2] || "";
    }
  } else if (lower.includes("gemini")) {
    vendor = "Google";
    family = "gemini";
    const match = rawName.match(/gemini[-_]?([\d.]+)/i);
    version = match ? match[1] : "";
  } else if (lower.includes("deepseek")) {
    vendor = "DeepSeek";
    family = "deepseek";
    const match = rawName.match(/deepseek[-_]?v?([\d.]+)/i);
    version = match ? match[1] : "";
  } else if (lower.includes("grok")) {
    vendor = "xAI";
    family = "grok";
    const match = rawName.match(/grok[-_]?([\d.]+)/i);
    version = match ? match[1] : "";
  } else if (lower.includes("kimi")) {
    vendor = "Moonshot";
    family = "kimi";
    const match = rawName.match(/kimi[-_]?k?([\d.]+)/i);
    version = match ? match[1] : "";
  }

  return {
    inferredVendor: vendor,
    inferredFamily: family,
    inferredVersion: version,
    modality: "llm",
    confidence: 0.7,
    llm: {
      contextWindow: 128000,
      supportsVision: false,
      supportsFunctionCalling: true,
    },
  };
}

/**
 * 主入口：推断模型能力
 * 
 * 优先使用 fal.ai schema 的详细信息，如果提供了 schemaEndpointId
 */
export async function inferModelCapability(
  rawName: string,
  options: InferOptions = {},
): Promise<InferredCapability> {
  const { schemaEndpointId } = options;

  // 1. 如果提供了 fal.ai schema，先尝试从中获取信息
  if (schemaEndpointId) {
    try {
      const schema = await getSchemaByEndpointId(schemaEndpointId);
      if (schema) {
        const result = convertSchemaToCapability(schema);
        if (result.confidence >= 0.9) {
          return result;
        }
      }
    } catch (err) {
      console.warn(`[infer] Failed to get schema ${schemaEndpointId}:`, err);
    }
  }

  // 2. 尝试规则引擎
  const ruleResult = inferByRules(rawName);
  if (ruleResult && ruleResult.confidence >= 0.7) {
    return ruleResult;
  }

  // 3. Fallback：默认为 LLM
  return {
    inferredVendor: "Unknown",
    inferredFamily: "",
    inferredVersion: "",
    modality: "llm",
    confidence: 0.5,
    llm: {
      contextWindow: 128000,
      supportsVision: false,
      supportsFunctionCalling: false,
    },
  };
}

/**
 * 通过 endpoint_id 从 fal.ai schema 获取详细信息
 */
async function getSchemaByEndpointId(endpointId: string): Promise<any | null> {
  const { modelSchemaCatalog } = await import("../db/schema/index.js");
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../db/index.js");

  const [row] = await db
    .select()
    .from(modelSchemaCatalog)
    .where(eq(modelSchemaCatalog.endpointId, endpointId))
    .limit(1);

  return row ?? null;
}

/**
 * 将 fal.ai schema 转换为 InferredCapability
 *
 * 关键修复：从 model_schema_catalog 行读取完整 parameters 数组和 metadata，
 * 不再做粗粒度降维。原本只提取 duration/resolution/mask_url 等少数字段，
 * 导致 fal 百科里的 image_urls/video_urls/audio_urls/generate_audio/end_image_url 等
 * 特有参数全部丢失。
 */
function convertSchemaToCapability(schema: any): InferredCapability {
  const {
    falCategory,
    title,
    endpointId,
    falSource,
    pricing,
    description,
    parameters: parametersJson,
    inputSchema,
  } = schema;

  const lower = endpointId.toLowerCase();

  // 1) 解析 parameters JSON 字符串（fal 百科的扁平参数数组）
  let parameters: ParameterSnapshot[] = [];
  if (typeof parametersJson === "string") {
    try {
      const parsed = JSON.parse(parametersJson);
      if (Array.isArray(parsed)) {
        parameters = parsed.map(normalizeParameter);
      }
    } catch {
      /* ignore parse error */
    }
  } else if (Array.isArray(parametersJson)) {
    parameters = parametersJson.map(normalizeParameter);
  }

  // 2) 从 category 确定模态
  let modality: "llm" | "video" | "image" | "audio" = "llm";
  let confidence = 0.95;

  if (
    falCategory === "text-to-video" ||
    falCategory === "image-to-video" ||
    falCategory === "video-to-video"
  ) {
    modality = "video";
  } else if (
    falCategory === "text-to-image" ||
    falCategory === "image-to-image"
  ) {
    modality = "image";
  } else if (
    falCategory === "text-to-speech" ||
    falCategory === "speech-to-text" ||
    falCategory === "audio-to-text"
  ) {
    modality = "audio";
  }

  // 3) 构建基础结果（含 fal 元数据 + 完整 parameters）
  const result: InferredCapability = {
    modality,
    confidence,
    inferredVendor: extractVendor(lower),
    inferredFamily: extractFamily(lower),
    inferredVersion: extractVersion(lower),
    falEndpointId: endpointId,
    falSource: (falSource as "queue" | "realtime") ?? undefined,
    falCategory: falCategory ?? undefined,
    pricing: pricing ?? undefined,
    description: description ?? undefined,
    inputSchema: inputSchema ?? null,
    parameters,
  };

  // 4) 根据 modality 提取特定字段 —— 直接读 fal parameters 数组（不再硬编码）
  const requiredParams = parameters.filter((p) => p.required).map((p) => p.name);
  const optionalParams = parameters.filter((p) => !p.required).map((p) => p.name);

  if (modality === "video") {
    const durationParam = parameters.find((p) => p.name === "duration");
    const resolutionParam = parameters.find((p) => p.name === "resolution");
    const aspectRatioParam = parameters.find((p) => p.name === "aspect_ratio");
    const generateAudioParam = parameters.find(
      (p) => p.name === "generate_audio",
    );

    // 真正从 fal enum 解析，不再写死 [720p, 1080p] / maxDurationSec: 10
    const durationEnum = Array.isArray(durationParam?.enum)
      ? (durationParam!.enum as Array<string | number>)
      : undefined;
    const maxDurationSec = parseMaxDuration(durationEnum);

    const supportedResolutions = Array.isArray(resolutionParam?.enum)
      ? (resolutionParam!.enum as Array<string | number>).map(String)
      : ["720p", "1080p"];

    const aspectRatios = Array.isArray(aspectRatioParam?.enum)
      ? (aspectRatioParam!.enum as Array<string | number>).map(String)
      : undefined;

    result.video = {
      maxDurationSec,
      supportedResolutions,
      requiresAsync: falSource === "queue",
      durationEnum,
      aspectRatios,
      requiredParams,
      optionalParams,
      generateAudio:
        typeof generateAudioParam?.default === "boolean"
          ? generateAudioParam.default
          : undefined,
      parameters,
    };
  } else if (modality === "image") {
    const sizeParam =
      parameters.find((p) => p.name === "image_size") ??
      parameters.find((p) => p.name === "size") ??
      parameters.find((p) => p.name === "resolution");

    const supportedSizes = Array.isArray(sizeParam?.enum)
      ? (sizeParam!.enum as Array<string | number>).map(String)
      : ["512x512", "1024x1024"];

    const supportsInpainting = parameters.some(
      (p) => p.name === "mask_url" || p.name === "inpaint",
    );

    result.image = {
      supportedSizes,
      supportsInpainting,
      requiredParams,
      optionalParams,
      parameters,
    };
  } else if (modality === "audio") {
    const formatParam = parameters.find((p) => p.name === "format");
    const supportedFormats = Array.isArray(formatParam?.enum)
      ? (formatParam!.enum as Array<string | number>).map(String)
      : ["mp3", "wav"];

    result.audio = {
      supportedFormats,
      requiredParams,
      optionalParams,
      parameters,
    };
  }

  return result;
}

/**
 * 归一化 fal parameters[] 元素为 ParameterSnapshot
 */
function normalizeParameter(p: any): ParameterSnapshot {
  if (!p || typeof p !== "object") {
    return {
      name: String(p ?? ""),
      type: "string",
      required: false,
    };
  }
  return {
    name: String(p.name ?? ""),
    type: String(p.type ?? "string"),
    required: p.required === true,
    nullable: p.nullable === true,
    default: p.default,
    enum: Array.isArray(p.enum) ? p.enum : undefined,
    description: typeof p.description === "string" ? p.description : undefined,
    examples: Array.isArray(p.examples) ? p.examples : undefined,
    items: p.items,
  };
}

/**
 * 从 fal duration enum（如 ["auto", "4", "5", ..., "30"]）解析最大秒数
 * 跳过 "auto"，取最大数字值
 */
function parseMaxDuration(
  enumValues: Array<string | number> | undefined,
): number | undefined {
  if (!enumValues || enumValues.length === 0) return undefined;

  let max: number | undefined;
  for (const v of enumValues) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) {
      if (max === undefined || n > max) max = n;
    }
  }
  return max;
}

/**
 * 从 endpoint_id 提取厂商
 */
function extractVendor(lower: string): string {
  if (lower.includes("bytedance") || lower.includes("doubao") || lower.includes("seedance")) {
    return "ByteDance";
  }
  if (lower.includes("kling")) return "Kuaishou";
  if (lower.includes("minimax") || lower.includes("hailuo")) return "MiniMax";
  if (lower.includes("openai") || lower.includes("sora")) return "OpenAI";
  if (lower.includes("google") || lower.includes("veo")) return "Google";
  if (lower.includes("xai") || lower.includes("grok")) return "xAI";
  if (lower.includes("fal-ai") || lower.includes("fal")) return "fal.ai";
  return "Unknown";
}

/**
 * 从 endpoint_id 提取家族
 */
function extractFamily(lower: string): string {
  if (lower.includes("seedance")) return "seedance";
  if (lower.includes("seedream")) return "seedream";
  if (lower.includes("kling")) return "kling";
  if (lower.includes("hailuo") || lower.includes("minimax")) return "hailuo";
  if (lower.includes("sora")) return "sora";
  if (lower.includes("veo")) return "veo";
  if (lower.includes("grok") && lower.includes("imagine")) return "grok-imagine";
  if (lower.includes("flux")) return "flux";
  if (lower.includes("stable") || lower.includes("sd-")) return "stable-diffusion";
  return "";
}

/**
 * 从 endpoint_id 提取版本
 */
function extractVersion(lower: string): string {
  const patterns = [
    /v?(\d+[._]\d+(?:[._]\d+)?)/,
    /(\d+[._]\d+(?:[._]\d+)?)/,
  ];

  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match) {
      return match[1].replace(/_/g, ".");
    }
  }
  return "";
}

/**
 * 从 input_schema properties 提取视频最大时长
 */
function extractMaxDuration(props: Record<string, any>): number | undefined {
  // 常见字段名
  const durationFields = ["duration", "max_duration", "video_duration", "length"];
  for (const field of durationFields) {
    if (props[field]) {
      const prop = props[field];
      if (prop.default) return Number(prop.default);
      if (prop.maximum) return prop.maximum;
      if (prop.type === "number" || prop.type === "integer") {
        if (prop.default !== undefined) return Number(prop.default);
      }
    }
  }
  return 10; // 默认 10 秒
}

/**
 * 从 input_schema properties 提取支持的分辨率
 */
function extractResolutions(props: Record<string, any>): string[] {
  const resolutionFields = ["resolution", "quality", "aspect_ratio", "size"];
  for (const field of resolutionFields) {
    if (props[field]) {
      const prop = props[field];
      if (prop.enum && Array.isArray(prop.enum)) {
        return prop.enum.map(String);
      }
    }
  }
  return ["720p", "1080p"];
}

/**
 * 从 input_schema properties 提取图像尺寸
 */
function extractImageSizes(props: Record<string, any>): string[] {
  const sizeFields = ["size", "resolution", "width", "height", "aspect_ratio"];
  for (const field of sizeFields) {
    if (props[field]) {
      const prop = props[field];
      if (prop.enum && Array.isArray(prop.enum)) {
        return prop.enum.map(String);
      }
    }
  }
  return ["512x512", "1024x1024"];
}
