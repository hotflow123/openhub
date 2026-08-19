import { eq, like } from "drizzle-orm";
import { db } from "../db/index";
import { models, modelSchemaAlias } from "../db/schema/index";
import { inferModelCapability } from "./infer";
import { extractInputSchemaCapabilities } from "../lib/fal-input-schema";
import type { InferredCapability, ParameterSnapshot } from "./infer";

interface DiscoveredModel {
  id: string;
  object?: string;
  created?: number;
  name?: string;
  owned_by?: string;
}

/**
 * 站点内全局唯一 model id（同一站点的同一个远程模型只有一条记录）
 */
export function deriveModelId(siteId: string, remoteId: string): string {
  return `${siteId}__${remoteId}`;
}

/**
 * 从模型名称查找 fal.ai schema endpoint_id
 * 使用 model_schema_alias 表进行匹配
 * 
 * 注意：只做简单的别名表查询，不做硬编码的变体匹配
 * 变体匹配由用户在界面上手动完成
 */
async function findFalSchemaEndpointId(modelName: string): Promise<string | null> {
  const normalized = modelName.toLowerCase().replace(/[_\-\/]/g, " ").trim();
  
  // 在 alias 表中查找匹配
  const [aliasMatch] = await db
    .select({ endpointId: modelSchemaAlias.endpointId })
    .from(modelSchemaAlias)
    .where(like(modelSchemaAlias.normalized, `%${normalized}%`))
    .limit(1);
  
  if (aliasMatch) {
    return aliasMatch.endpointId;
  }
  
  return null;
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
): Promise<{ discovered: number; skipped: number }> {
  const url = `${baseUrl.replace(/\/$/, "")}/v1/models`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Discover models failed: HTTP ${response.status}`);
  }
  const data = (await response.json()) as { data: DiscoveredModel[] };

  let discovered = 0;
  let skipped = 0;

  for (const m of data.data) {
    const modelId = deriveModelId(siteId, m.id);
    const [existing] = await db
      .select()
      .from(models)
      .where(eq(models.id, modelId))
      .limit(1);

    if (existing) {
      skipped++;
      continue;
    }

    // 1. 尝试从 fal.ai schema 关联参数
    let schemaEndpointId: string | null = null;
    let schemaMatchSource: string | null = null;
    try {
      schemaEndpointId = await findFalSchemaEndpointId(m.id);
      if (schemaEndpointId) {
        schemaMatchSource = "auto";
        console.log(`[discover] Schema linked ${m.id} -> ${schemaEndpointId}`);
      }
    } catch (err) {
      console.warn(`[discover] Schema lookup failed for ${m.id}:`, err);
    }

    // 2. 自动推理模型能力（如果 schema 没有提供足够信息）
    let modality: "llm" | "image" | "audio" | "video" | "embedding" = "llm";
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

    try {
      const inferred = await inferModelCapability(m.id, { schemaEndpointId });
      modality = inferred.modality;

      // === 持久化 fal.ai 完整元数据（之前完全丢失）===
      if (inferred.falEndpointId) {
        schemaEndpointId = schemaEndpointId ?? inferred.falEndpointId;
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
      if (inferred.modality === "video") {
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
      } else if (inferred.modality === "image") {
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
      } else if (inferred.modality === "llm") {
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
      console.warn(`[discover] Failed to infer ${m.id}, defaulting to llm:`, err);
    }

    await db.insert(models).values({
      id: modelId,
      siteId,
      rawName: m.id,
      displayName: m.name ?? m.id,
      vendor: undefined,
      family: undefined,
      modelVersion: undefined,
      modality,
      endpointCaps,
      paramCaps: "[]",
      capsOverridden: 0,
      // fal.ai 完整快照
      schemaEndpointId,
      schemaMatchSource,
      schemaSyncedAt: schemaEndpointId ? new Date() : undefined,
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

  return { discovered, skipped };
}
