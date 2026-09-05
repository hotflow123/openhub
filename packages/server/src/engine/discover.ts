import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { models, sites, variants } from "../db/schema/index";
import { nanoid } from "nanoid";
import { inferModelCapability } from "./infer";
import { matchSchema } from "./catalog/schema-matcher";
import { extractInputSchemaCapabilities } from "../lib/fal-input-schema";
import type { InferredCapability, ParameterSnapshot } from "./infer";
import { resolveAdapterForModel } from "./adapter";
import { resolveModelProtocol, assessProtocolReadiness } from "./protocol-catalog";
import { assessPublication } from "./publication-policy";

interface DiscoveredModel {
  id: string;
  object?: string;
  created?: number;
  name?: string;
  owned_by?: string;
  model_type?: string;
  description?: string;
  tags?: string;
  supported_endpoint_types?: string[];
  [key: string]: unknown;
}

function metadataScore(model: DiscoveredModel): number {
  return Number(Boolean(model.model_type)) +
    Number(Boolean(model.description)) +
    Number(Boolean(model.tags)) +
    Number(Array.isArray(model.supported_endpoint_types) && model.supported_endpoint_types.length > 0);
}

function modelAliasBases(id: string): string[] {
  const bases: string[] = [];
  let current = id;
  for (let index = 0; index < 4; index += 1) {
    current = current
      .replace(/-\d{4}-\d{2}-\d{2}$/, "")
      .replace(/-(?:low|medium|high|xhigh|max|ultra|latest|preview)$/, "");
    if (current === id || bases.includes(current)) break;
    bases.push(current);
  }
  return bases;
}

export function resolveEffectiveRuntimeModel(
  model: DiscoveredModel,
  allModels: DiscoveredModel[],
): DiscoveredModel {
  if (metadataScore(model) > 0) return model;
  const byId = new Map(allModels.map((candidate) => [candidate.id, candidate]));
  for (const base of modelAliasBases(model.id)) {
    const candidate = byId.get(base);
    if (candidate && metadataScore(candidate) > 0) {
      return {
        ...model,
        model_type: model.model_type ?? candidate.model_type,
        description: model.description ?? candidate.description,
        tags: model.tags ?? candidate.tags,
        supported_endpoint_types: model.supported_endpoint_types?.length
          ? model.supported_endpoint_types
          : candidate.supported_endpoint_types,
        _openhubMetadataInheritedFrom: candidate.id,
      };
    }
  }
  return model;
}

export function inferRuntimeModality(model: Pick<
  DiscoveredModel,
  "model_type" | "tags" | "supported_endpoint_types" | "id" | "description"
>): "llm" | "image" | "audio" | "video" | "embedding" | null {
  const type = model.model_type ?? "";
  const tags = model.tags ?? "";
  const endpoints = Array.isArray(model.supported_endpoint_types)
    ? model.supported_endpoint_types.join(" ")
    : "";
  const metadata = `${type} ${tags} ${endpoints}`.toLowerCase();

  if (/(检索|embedding|rerank|重排序|向量)/i.test(metadata)) return "embedding";
  if (/(音频|audio|speech|tts|语音|音乐|sound effect)/i.test(metadata)) return "audio";
  if (/(视频|video|text to video|image to video|video generation)/i.test(metadata)) return "video";
  if (/(图像|图片|image generation|image edit|绘图)/i.test(metadata)) return "image";
  if (/(对话|chat|completion|openai|anthropic|gemini|claude|deepseek)/i.test(metadata)) return "llm";

  const fallback = `${model.id} ${model.description ?? ""}`.toLowerCase();
  if (/(embedding|rerank|重排序|向量)/i.test(fallback)) return "embedding";
  if (/(audio|speech|tts|voice|语音|音乐|suno)/i.test(fallback)) return "audio";
  if (/(image|图片|图像|绘图)/i.test(fallback)) return "image";
  if (/(video|视频|seedance|veo|kling|sora|pixverse|vidu|runway|luma|hailuo)/i.test(fallback)) return "video";
  if (/(^|[-_/])mj(?:$|[-_/])|midjourney|flux|seedream/i.test(fallback)) return "image";
  if (/(chat|completion|messages|对话|llm|gemini|claude|deepseek|openai|gpt|qwen|wen|llama|glm|kimi|ernie|sparkdesk|mimo|qwq|qvq|o1|o3|o4|davinci|babbage|doubao)/i.test(fallback)) return "llm";
  return null;
}

/**
 * 站点内全局唯一 model id（同一站点的同一个远程模型只有一条记录）
 */
export function deriveModelId(siteId: string, remoteId: string): string {
  return `${siteId}__${remoteId}`;
}

async function ensureAutoVariant(modelId: string, rawName: string): Promise<void> {
  const [model] = await db
    .select()
    .from(models)
    .where(eq(models.id, modelId))
    .limit(1);
  if (!model) return;
  const [site] = await db
    .select()
    .from(sites)
    .where(eq(sites.id, model.siteId))
    .limit(1);
  const resolved = site ? resolveAdapterForModel(model.adapterId, site.adapterId) : null;
  const protocol = model.modality === "video"
    ? await resolveModelProtocol(model.id)
    : null;
  const decision = assessPublication({
    siteActive: site?.status === "active",
    modelStatus: model.status,
    modality: model.modality,
    adapterCapabilities: resolved?.adapter.capabilities ?? [],
    protocolReady: Boolean(
      protocol &&
      protocol.catalog.enabled &&
      protocol.catalog.status === "active" &&
      assessProtocolReadiness(protocol.document).ready,
    ),
  });
  const [existing] = await db
    .select({ id: variants.id })
    .from(variants)
    .where(eq(variants.modelId, modelId))
    .limit(1);
  if (existing) {
    if (existing.id.startsWith("auto_")) {
      await db
        .update(variants)
        .set({ isPublic: decision.public ? 1 : 0, updatedAt: new Date() })
        .where(eq(variants.id, existing.id));
    }
    return;
  }
  const [nameTaken] = await db
    .select({ id: variants.id })
    .from(variants)
    .where(eq(variants.name, rawName))
    .limit(1);
  if (nameTaken) return;
  await db.insert(variants).values({
    id: `auto_${nanoid(10)}`,
    name: rawName,
    modelId,
    description: "Automatically discovered from the upstream model list",
    isPublic: decision.public ? 1 : 0,
  });
}

export async function refreshAutoVariantsForSite(siteId: string): Promise<void> {
  const rows = await db
    .select({ id: models.id, rawName: models.rawName })
    .from(models)
    .where(eq(models.siteId, siteId));
  for (let offset = 0; offset < rows.length; offset += 16) {
    const batch = rows.slice(offset, offset + 16);
    await Promise.all(batch.map((row) => ensureAutoVariant(row.id, row.rawName)));
  }
}

/**
 * 调用站点 /v1/models，发现模型并写入 models 表（增量）
 *
 * DESIGN 第 7 章：
 * - raw_name 存站点返回的原始 id（如 "gpt-4o-mini"）
 * - display_name 暂用 m.name ?? m.id
 * - modality 缺省 "unknown"（discover 阶段无法判断）
 * - caps_overridden = 0（首次发现，尚未被人工确认）
 * - status = "active"
 * 
 * 同时尝试从 fal.ai schema 表关联模型参数
 */
export async function discoverModels(
  siteId: string,
  baseUrl: string,
  apiKey: string,
  adapterId = "openai",
  options: { enrich?: boolean } = {},
): Promise<{ discovered: number; skipped: number }> {
  const url = `${baseUrl.replace(/\/$/, "")}/v1/models`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Discover models failed: HTTP ${response.status}`);
  }
  const data = (await response.json()) as { data?: unknown };
  if (!data || !Array.isArray(data.data)) {
    throw new Error("Discover models failed: invalid /v1/models response");
  }
  const discoveredModels = data.data.filter(
    (model): model is DiscoveredModel =>
      Boolean(model) &&
      typeof model === "object" &&
      typeof (model as DiscoveredModel).id === "string" &&
      Boolean((model as DiscoveredModel).id.trim()),
  );

  let discovered = 0;
  let skipped = data.data.length - discoveredModels.length;
  const effectiveModels = discoveredModels.map((model) =>
    resolveEffectiveRuntimeModel(model, discoveredModels),
  );
  const existingRows = await db
    .select()
    .from(models)
    .where(eq(models.siteId, siteId));
  const existingById = new Map(existingRows.map((model) => [model.id, model]));

  for (let index = 0; index < discoveredModels.length; index += 1) {
    const m = discoveredModels[index];
    const effectiveModel = effectiveModels[index];
    const modelId = deriveModelId(siteId, m.id);
    const existing = existingById.get(modelId);

    if (existing) {
      if (options.enrich === false) {
        skipped++;
        continue;
      }
      const runtimeModality = inferRuntimeModality(effectiveModel);
      if (
        existing.adapterId !== adapterId ||
        existing.sourceMetadata !== JSON.stringify(effectiveModel) ||
        runtimeModality && !existing.capsOverridden
      ) {
        await db
          .update(models)
          .set({
            adapterId,
            ...(runtimeModality ? { modality: runtimeModality } : {}),
            sourceMetadata: JSON.stringify(effectiveModel),
            updatedAt: new Date(),
          })
          .where(eq(models.id, modelId));
      }
      skipped++;
      continue;
    }

    if (options.enrich === false) {
      await db.insert(models).values({
        id: modelId,
        siteId,
        rawName: m.id,
        displayName: m.name ?? m.id,
        adapterId,
        modality: inferRuntimeModality(effectiveModel) ?? "unknown",
        sourceMetadata: JSON.stringify(effectiveModel),
        endpointCaps: "[]",
        paramCaps: "[]",
        capsOverridden: 0,
        schemaMatchStatus: "unmatched",
        schemaMatchReason: "enrichment_pending",
        supportsStream: 1,
        status: "active",
        syncedAt: new Date(),
      });
      discovered++;
      continue;
    }

    // 1. 尝试从 fal.ai schema 关联参数
    let schemaEndpointId: string | null = null;
    let schemaMatchSource: string | null = null;
    let schemaMatchStatus: "unmatched" | "candidate" | "confirmed" | "partial" = "unmatched";
    let schemaMatchConfidence: "high" | "medium" | "low" | null = null;
    let schemaMatchReason: string | null = "no_exact_alias";
    try {
      const schemaMatch = await matchSchema(m.id);
      if (schemaMatch) {
        schemaEndpointId = schemaMatch.endpointId;
        schemaMatchSource = schemaMatch.aliasType;
        schemaMatchStatus = schemaMatch.status;
        schemaMatchConfidence = schemaMatch.confidence;
        schemaMatchReason = schemaMatch.reason;
        console.log(
          `[discover] Schema ${schemaMatch.status}: ${m.id} -> ${schemaEndpointId} (${schemaMatch.reason})`,
        );
      }
    } catch (err) {
      console.warn(`[discover] Schema lookup failed for ${m.id}:`, err);
    }

    // 2. 自动推理模型能力（如果 schema 没有提供足够信息）
    let modality: "llm" | "image" | "audio" | "video" | "embedding" | "unknown" =
      inferRuntimeModality(effectiveModel) ?? "unknown";
    let endpointCaps = "[]";
    let contextWindow: number | null = null;
    let maxOutputTokens: number | null = null;
    let maxDurationSec: number | null = null;
    let requiresAsync = 0;
    let supportedSizes: string | null = null;
    let supportsStream = 1;

    // fal 真实参数快照
    let falParametersSnapshot: string | null = null;
    let falInputSchemaSnapshot: string | null = null;
    let falPricing: string | null = null;
    let falDescription: string | null = null;
    let falSource: string | null = null;
    let videoDurationEnum: string | null = null;
    let videoAspectRatios: string | null = null;
    let videoResolutions: string | null = null;
    let videoRequiredParams: string | null = null;
    let videoOptionalParams: string | null = null;
    let generateAudioSupported = 0;
    let maxReferenceImages: number | null = null;
    let maxReferenceVideos: number | null = null;
    let maxReferenceAudios: number | null = null;
    let supportsFunctionCalling = 0;
    let supportsVision = 0;
    let supportsReasoning = 0;
    let inferredVendor: string | undefined;
    let inferredFamily: string | undefined;
    let inferredVersion: string | undefined;

    try {
      // A candidate only suggests an endpoint to an administrator. It must not
      // populate real parameter limits until the association is confirmed.
      const inferred = await inferModelCapability(m.id, {
        schemaEndpointId: schemaMatchStatus === "confirmed" ? schemaEndpointId : null,
      });
      inferredVendor = inferred.inferredVendor;
      inferredFamily = inferred.inferredFamily;
      inferredVersion = inferred.inferredVersion;
      modality = inferred.modality;
      modality = inferRuntimeModality(effectiveModel) ?? modality;

      // === 持久化 fal.ai 完整元数据（之前完全丢失）===
      if (inferred.falEndpointId) {
        if (!schemaEndpointId) {
          schemaEndpointId = inferred.falEndpointId;
          schemaMatchSource = "inference";
          schemaMatchStatus = "candidate";
          schemaMatchConfidence = inferred.confidence >= 0.9 ? "medium" : "low";
          schemaMatchReason = "inference_endpoint_needs_review";
        }
      }
      if (inferred.falSource) {
        falSource = inferred.falSource;
        requiresAsync = inferred.falSource === "queue" ? 1 : 0;
      }
      if (inferred.pricing) falPricing = inferred.pricing;
      if (inferred.description) falDescription = inferred.description;

      // === 完整 parameters 数组快照（核心修复）===
      if (inferred.parameters && inferred.parameters.length > 0) {
        falParametersSnapshot = JSON.stringify(inferred.parameters);
      }
      if (inferred.inputSchema) {
        const inputCaps = extractInputSchemaCapabilities(
          inferred.inputSchema,
          falParametersSnapshot,
        );
        falInputSchemaSnapshot = inputCaps.inputSchemaJson;
        maxReferenceImages = inputCaps.maxReferenceImages;
        maxReferenceVideos = inputCaps.maxReferenceVideos;
        maxReferenceAudios = inputCaps.maxReferenceAudios;
      }

      // === 从 parameters[] 直接提取视频参数枚举 ===
      // 无论 modality 是什么（video / image-to-video / text-to-video），
      // 只要 parameters 里有 duration/resolution/aspect_ratio 等字段，就提取其 enum。
      // 不再依赖 convertSchemaToCapability 的 video{} 分支（该分支只对 fal_category=text-to-video 生效）。
      const params = inferred.parameters ?? [];

      const durationParam = params.find((p) => p.name === "duration");
      const resolutionParam = params.find((p) => p.name === "resolution");
      const aspectRatioParam = params.find((p) => p.name === "aspect_ratio");
      const generateAudioParam = params.find((p) => p.name === "generate_audio");
      const maxDurationParam = params.find((p) => p.name === "max_duration");
      const imageSizeParam = params.find((p) => p.name === "image_size" || p.name === "size");

      // 从 fal parameters enum 提取视频时长枚举
      if (durationParam?.enum && Array.isArray(durationParam.enum)) {
        const nums = durationParam.enum
          .map((v) => Number(v))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (nums.length > 0) {
          videoDurationEnum = JSON.stringify(durationParam.enum.map(String));
          if (maxDurationSec == null) {
            maxDurationSec = Math.max(...nums);
          }
        }
      }

      // 视频分辨率枚举（直接取 resolution 参数的 enum）
      if (resolutionParam?.enum && Array.isArray(resolutionParam.enum)) {
        videoResolutions = JSON.stringify(resolutionParam.enum.map(String));
      }

      // 宽高比枚举
      if (aspectRatioParam?.enum && Array.isArray(aspectRatioParam.enum)) {
        videoAspectRatios = JSON.stringify(aspectRatioParam.enum.map(String));
      }

      // generate_audio 标记
      if (generateAudioParam !== undefined) {
        if (typeof generateAudioParam.default === "boolean") {
          generateAudioSupported = generateAudioParam.default ? 1 : 0;
        }
      }

      // === 根据 modality 持久化 endpointCaps ===
      if (modality === "video") {
        endpointCaps = JSON.stringify(["video_generation"]);
        if (inferred.video) {
          // 补充从 video{} 来的额外信息（仅当 video{} 存在时）
          if (inferred.video.maxDurationSec !== undefined && maxDurationSec == null) {
            maxDurationSec = inferred.video.maxDurationSec;
          }
          if (inferred.video.requiredParams) {
            videoRequiredParams = JSON.stringify(inferred.video.requiredParams);
          }
          if (inferred.video.optionalParams) {
            videoOptionalParams = JSON.stringify(inferred.video.optionalParams);
          }
        }
        if (inferred.video?.requiresAsync) {
          requiresAsync = 1;
        }
      } else if (modality === "image") {
        const caps = ["image_generation"];
        if (inferred.image?.supportsInpainting) caps.push("image_editing");
        endpointCaps = JSON.stringify(caps);
        if (inferred.image?.supportedSizes?.length) {
          supportedSizes = JSON.stringify(inferred.image.supportedSizes);
        }
        // 图片尺寸枚举（从 parameters 提取）
        if (imageSizeParam?.enum && Array.isArray(imageSizeParam.enum)) {
          supportedSizes = JSON.stringify(imageSizeParam.enum.map(String));
        }
        if (inferred.image?.requiredParams) {
          videoRequiredParams = JSON.stringify(inferred.image.requiredParams);
        }
        if (inferred.image?.optionalParams) {
          videoOptionalParams = JSON.stringify(inferred.image.optionalParams);
        }
      } else if (modality === "llm") {
        const caps = ["chat"];
        if (inferred.llm?.supportsVision) {
          caps.push("vision");
          supportsVision = 1;
        }
        if (inferred.llm?.supportsFunctionCalling) {
          caps.push("function_calling");
          supportsFunctionCalling = 1;
        }
        endpointCaps = JSON.stringify(caps);
        contextWindow = inferred.llm?.contextWindow ?? null;
      }

      console.log(`[discover] Inferred ${m.id}: ${modality} (confidence: ${inferred.confidence}, params: ${inferred.parameters?.length ?? 0})`);
    } catch (err) {
      console.warn(`[discover] Failed to infer ${m.id}; leaving inferred capabilities unknown:`, err);
    }

    await db.insert(models).values({
      id: modelId,
      siteId,
      rawName: m.id,
      displayName: m.name ?? m.id,
      vendor: inferredVendor,
      family: inferredFamily,
      modelVersion: inferredVersion,
      adapterId,
      modality,
      sourceMetadata: JSON.stringify(effectiveModel),
      endpointCaps,
      paramCaps: "[]",
      capsOverridden: 0,
      // fal.ai 完整快照
      schemaEndpointId,
      schemaMatchSource,
      schemaMatchStatus,
      schemaMatchConfidence,
      schemaMatchReason,
      schemaSyncedAt: schemaMatchStatus === "confirmed" ? new Date() : undefined,
      falParametersSnapshot,
      falInputSchemaSnapshot,
      falPricing,
      falDescription,
      falSource,
      videoDurationEnum,
      videoAspectRatios,
      videoResolutions,
      videoRequiredParams,
      videoOptionalParams,
      generateAudioSupported,
      // LLM 能力
      contextWindow,
      maxOutputTokens,
      supportsReasoning,
      supportsFunctionCalling,
      supportsVision,
      // 媒体限制
      supportedSizes,
      maxDurationSec,
      maxReferenceImages,
      maxReferenceVideos,
      maxReferenceAudios,
      // 调用方式
      supportsStream,
      requiresAsync,
      status: "active",
      syncedAt: new Date(),
    });
    discovered++;
  }

  const currentNames = new Set(discoveredModels.map((model) => model.id));
  const siteModels = await db
    .select({ id: models.id, rawName: models.rawName, status: models.status })
    .from(models)
    .where(eq(models.siteId, siteId));
  let stale = 0;
  for (const model of siteModels) {
    if (currentNames.has(model.rawName) || model.status === "offline") continue;
    await db
      .update(models)
      .set({
        status: "offline",
        statusReason: "not_returned_by_latest_models_list",
        updatedAt: new Date(),
      })
      .where(eq(models.id, model.id));
    stale++;
  }

  return { discovered, skipped };
}
