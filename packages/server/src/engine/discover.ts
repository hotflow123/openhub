import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { models } from "../db/schema/index";
import { inferModelCapability } from "./infer";
import { matchSchema } from "./catalog/schema-matcher";
import { extractInputSchemaCapabilities } from "../lib/fal-input-schema";
import type {
  ClassificationSource,
  InferredCapability,
  ModelModality,
  ParameterSnapshot,
} from "./infer";
import { getAdapter, type DiscoveredRemoteModel } from "./adapter";
import { buildDerivedModelProfile } from "./model-profile";

interface DiscoveredModel extends DiscoveredRemoteModel {
  id: string;
}

/**
 * 站点内全局唯一 model id（同一站点的同一个远程模型只有一条记录）
 */
export function deriveModelId(siteId: string, remoteId: string): string {
  return `${siteId}__${remoteId}`;
}

/**
 * 调用站点 /v1/models，发现模型并写入 models 表（增量）
 *
 * DESIGN 第 7 章：
 * - raw_name 存站点返回的原始 id（如 "gpt-4o-mini"）
 * - display_name 暂用 m.name ?? m.id
 * - modality 优先使用运行时、Schema 和名称家族规则，确无证据时才为 "unknown"
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
): Promise<{ discovered: number; updated: number; offline: number; skipped: number }> {
  const adapter = getAdapter(adapterId);
  if (!adapter) throw new Error(`Adapter not found: ${adapterId}`);

  let discoveredModels: DiscoveredModel[];
  if (adapter.discoverModels) {
    discoveredModels = await adapter.discoverModels({ targetUrl: baseUrl, apiKey });
  } else {
    const url = `${baseUrl.replace(/\/$/, "")}/v1/models`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Discover models failed: HTTP ${response.status}`);
    const data = (await response.json()) as { data?: DiscoveredModel[] };
    if (!Array.isArray(data.data)) throw new Error("Discover models failed: invalid response");
    discoveredModels = data.data;
  }

  let discovered = 0;
  let updated = 0;
  let offline = 0;
  let skipped = 0;
  const seenRemoteIds = new Set<string>();

  for (const m of discoveredModels) {
    if (!m.id || typeof m.id !== "string") continue;
    seenRemoteIds.add(m.id);
    const modelId = deriveModelId(siteId, m.id);
    const runtimeHasVideoSchema = Boolean(
      m.metadata && typeof m.metadata === "object" &&
      ("parameters" in m.metadata || "input_schema" in m.metadata || "inputSchema" in m.metadata),
    );
    const [existing] = await db
      .select()
      .from(models)
      .where(eq(models.id, modelId))
      .limit(1);

    if (existing) {
      if (existing.adapterSource === "site") {
        const update: Partial<typeof existing> = {
          adapterId,
          adapterSource: "site",
          status: "active",
          statusReason: null,
          syncedAt: new Date(),
          updatedAt: new Date(),
        };
        if (existing.capsOverridden === 0) {
          const inferred = await inferModelCapability(m.id, {
            runtimeMetadata: m.metadata,
          });
          Object.assign(update, buildDerivedModelProfile(inferred));
          if (inferred.modality === "video" && !existing.videoContractStatus) {
            Object.assign(update, {
              videoContractSource: "runtime",
              videoContractStatus: runtimeHasVideoSchema ? "candidate" : "unverified",
              videoContractReason: runtimeHasVideoSchema
                ? "runtime_schema_candidate_requires_confirmation"
                : "runtime_model_list_has_no_video_input_schema",
            });
          }
        }
        await db
          .update(models)
          .set(update)
          .where(eq(models.id, modelId));
        updated++;
      } else {
        skipped++;
      }
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
    let modality: ModelModality = "unknown";
    let modalitySource: ClassificationSource = "unknown";
    let modalityConfidence: "high" | "medium" | "low" = "low";
    let modalityReason: string | null = "no classification evidence";
    let endpointCaps = "[]";
    let paramCaps = "[]";
    let contextWindow: number | null = null;
    let maxOutputTokens: number | null = null;
    let maxDurationSec: number | null = null;
    let requiresAsync = 0;
    let supportedSizes: string | null = null;
    let supportsStream = 0;

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
    let inferredVendor: string | null = null;
    let inferredFamily: string | null = null;
    let inferredVersion: string | null = null;
    let videoContractSource: string | null = null;
    let videoContractStatus: string | null = null;
    let videoContractReason: string | null = null;

    try {
      // A candidate only suggests an endpoint to an administrator. It must not
      // populate real parameter limits until the association is confirmed.
      const inferred = await inferModelCapability(m.id, {
        schemaEndpointId: schemaMatchStatus === "confirmed" ? schemaEndpointId : null,
        runtimeMetadata: m.metadata,
      });
      inferredVendor = inferred.inferredVendor && inferred.inferredVendor !== "Unknown"
        ? inferred.inferredVendor
        : null;
      inferredFamily = inferred.inferredFamily || null;
      inferredVersion = inferred.inferredVersion || null;
      modality = inferred.modality;
      modalitySource = inferred.classificationSource ?? "unknown";
      modalityConfidence = inferred.classificationConfidence ?? "low";
      modalityReason = inferred.classificationReason ?? null;
      if (modality === "video") {
        videoContractSource = "runtime";
        videoContractStatus = runtimeHasVideoSchema ? "candidate" : "unverified";
        videoContractReason = runtimeHasVideoSchema
          ? "runtime_schema_candidate_requires_confirmation"
          : "runtime_model_list_has_no_video_input_schema";
      }
      endpointCaps = JSON.stringify(inferred.endpointCaps ?? []);
      paramCaps = JSON.stringify(inferred.paramCaps ?? []);
      if (inferred.classificationSource === "runtime") {
        supportsStream = inferred.endpointCaps?.includes("stream") ? 1 : 0;
      }

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
      if (inferred.modality === "video" && !(inferred.endpointCaps?.length)) {
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
      } else if (inferred.modality === "image" && !(inferred.endpointCaps?.length)) {
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
      } else if (inferred.modality === "llm" && !(inferred.endpointCaps?.length)) {
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
      console.warn(`[discover] Failed to infer ${m.id}; keeping modality unknown:`, err);
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
      adapterSource: "site",
      modality,
      modalitySource,
      modalityConfidence,
      modalityReason,
      endpointCaps,
      paramCaps,
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
      videoContractSource,
      videoContractStatus,
      videoContractReason,
      videoContractSyncedAt: null,
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

  const siteModels = await db.select().from(models).where(eq(models.siteId, siteId));
  for (const model of siteModels) {
    if (model.adapterSource !== "site" || seenRemoteIds.has(model.rawName)) continue;
    await db
      .update(models)
      .set({ status: "offline", statusReason: "not_returned_by_upstream", updatedAt: new Date() })
      .where(eq(models.id, model.id));
    offline++;
  }

  return { discovered, updated, offline, skipped };
}
