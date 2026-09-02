import { desc, eq } from "drizzle-orm";
import { db } from "../db/index";
import { modelCapabilityProbes, sites, models, variants, modelParameterTemplates } from "../db/schema/index";
import {
  resolveAdapterForModel,
  validateAdapterConfig,
  type Adapter,
} from "../engine/adapter";
import { getProviderAdapterRegistration } from "../engine/adapter-manifest";
import { decrypt, getMasterKey } from "../lib/crypto";
import type {
  ChatRequest,
  ChatResponse,
  ImageGenerationRequest,
  ImageEditRequest,
  ImageVariationRequest,
  ImageResponse,
  AudioSpeechRequest,
  AudioTranscriptionRequest,
  AudioTranscriptionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  VideoSubmitRequest,
  VideoQueryResult,
} from "../engine/adapter";
import { CHAT_KNOWN_FIELDS, mapStoredVariantParams } from "../engine/param-mapper";
import {
  modelEvidenceState,
  readModelInputContract,
  validateModelRequest,
} from "../lib/model-contract";
import { isProbeForCurrentConfig } from "../engine/capability/status";

export class RouterError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

function safeErrorText(value: string): string {
  return value
    .replace(/Bearer\s+[^\s,]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function normalizeRouterError(err: unknown): RouterError {
  if (err instanceof RouterError) return err;

  const direct = err && typeof err === "object" ? err as Record<string, unknown> : {};
  const directStatus = typeof direct.status === "number" ? direct.status : undefined;
  const directCode = typeof direct.code === "string" ? direct.code : undefined;
  const directDetails = {
    ...(typeof direct.adapter === "string" ? { adapter: direct.adapter } : {}),
    ...(typeof direct.capability === "string" ? { capability: direct.capability } : {}),
    ...(typeof direct.requestId === "string" ? { requestId: direct.requestId } : {}),
    ...(typeof direct.retryAfter === "string" ? { retryAfter: direct.retryAfter } : {}),
  };

  const info = err && typeof err === "object" && "info" in err
    ? (err as { info?: unknown }).info
    : undefined;
  if (info && typeof info === "object") {
    const details = info as Record<string, unknown>;
    const status = typeof details.status === "number" && details.status >= 400 && details.status <= 599
      ? details.status
      : directStatus && directStatus >= 400 && directStatus <= 599 ? directStatus : 502;
    const message = typeof details.message === "string"
      ? details.message
      : err instanceof Error ? err.message : String(err);
    const code = typeof details.code === "string" ? details.code : directCode ?? "upstream_error";
    return new RouterError(safeErrorText(message), status, code, {
      ...directDetails,
      ...(typeof details.requestId === "string" ? { requestId: details.requestId } : {}),
      ...(typeof details.retryAfter === "string" ? { retryAfter: details.retryAfter } : {}),
      ...(typeof details.upstreamCode === "string" ? { upstreamCode: details.upstreamCode } : {}),
    });
  }

  return new RouterError(
    safeErrorText(err instanceof Error ? err.message : String(err)),
    directStatus && directStatus >= 400 && directStatus <= 599 ? directStatus : 502,
    directCode ?? "upstream_error",
    directDetails,
  );
}

export interface ResolvedRoute {
  variant: typeof variants.$inferSelect;
  model: typeof models.$inferSelect;
  site: typeof sites.$inferSelect;
  adapter: Adapter;
  apiKey: string;
}

function parseAdapterConfig(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RouterError("Invalid variant adapter_config", 500, "invalid_adapter_config");
  }
  return parsed as Record<string, unknown>;
}

async function resolveRouteFromVariant(
  variant: typeof variants.$inferSelect,
  requiredCapability?: string,
): Promise<ResolvedRoute> {
  const [modelRow] = await db
    .select()
    .from(models)
    .where(eq(models.id, variant.modelId))
    .limit(1);
  if (!modelRow) {
    throw new RouterError(`Model not found: ${variant.modelId}`, 500, "model_not_found");
  }

  const [site] = await db
    .select()
    .from(sites)
    .where(eq(sites.id, modelRow.siteId))
    .limit(1);
  if (!site) {
    throw new RouterError(`Site not found: ${modelRow.siteId}`, 500, "site_not_found");
  }

  if (site.status !== "active") {
    throw new RouterError(`Site ${site.name} is ${site.status}`, 503, "site_unavailable");
  }

  const resolved = resolveAdapterForModel(modelRow.adapterId, modelRow.adapterSource, site.adapterId);
  if (!resolved) {
    throw new RouterError(
      `Adapter not found for model ${modelRow.rawName}: ${modelRow.adapterId} / ${site.adapterId}`,
      500,
      "adapter_not_found",
    );
  }

  const registration = getProviderAdapterRegistration(resolved.adapterId);
  if (!registration) {
    throw new RouterError(
      `Adapter is not registered: ${resolved.adapterId}`,
      503,
      "adapter_not_found",
    );
  }
  if (registration.status === "extension_required") {
    throw new RouterError(
      `Adapter ${resolved.adapterId} requires an unsupported task extension`,
      503,
      "extension_required",
    );
  }
  if (registration.status !== "ready") {
    throw new RouterError(
      `Adapter ${resolved.adapterId} failed validation`,
      503,
      "adapter_config_invalid",
    );
  }

  const runtimeProbe = requiredCapability
    ? (await db
      .select({
        capability: modelCapabilityProbes.capability,
        status: modelCapabilityProbes.status,
        configRevision: modelCapabilityProbes.configRevision,
      })
      .from(modelCapabilityProbes)
      .where(eq(modelCapabilityProbes.modelId, modelRow.id))
      .orderBy(desc(modelCapabilityProbes.checkedAt))
      .limit(50))
      .find((probe) => probe.capability === requiredCapability && isProbeForCurrentConfig(probe.configRevision, site.configRevision))
    : undefined;
  const evidence = modelEvidenceState(modelRow, runtimeProbe ?? null);
  if (evidence.executionStatus !== "ready") {
    throw new RouterError(
      `Model capability is not executable: capability=${requiredCapability ?? "unknown"}, identity=${evidence.identityStatus}, contract=${evidence.contractStatus}, execution=${evidence.executionStatus}`,
      409,
      requiredCapability ? "capability_unavailable" : "contract_unconfirmed",
    );
  }

  if (variant.adapterConfigStatus !== "valid") {
    throw new RouterError(
      "Variant adapter configuration has not been validated",
      409,
      "adapter_config_invalid",
    );
  }

  let config: Record<string, unknown> | undefined;
  try {
    config = parseAdapterConfig(variant.adapterConfig);
  } catch (error) {
    if (error instanceof RouterError) throw error;
    throw new RouterError("Invalid variant adapter_config", 500, "invalid_adapter_config");
  }
  const configError = validateAdapterConfig(resolved.adapter, config, modelRow.modality);
  if (configError) {
    throw new RouterError(configError, 500, "adapter_config_invalid");
  }

  const apiKey = await decrypt(site.apiKeyEnc, site.apiKeyIv, getMasterKey());
  if (variant.parameterTemplateId) {
    const [template] = await db.select({ modelId: modelParameterTemplates.modelId, matchStatus: modelParameterTemplates.matchStatus, snapshot: modelParameterTemplates.templateSnapshot }).from(modelParameterTemplates).where(eq(modelParameterTemplates.id, variant.parameterTemplateId)).limit(1);
    if (!template || template.modelId !== modelRow.id || template.matchStatus !== "applied") {
      throw new RouterError("Parameter template is not applied to this Variant", 409, "parameter_template_not_applied");
    }
    (variant as typeof variant & { parameterTemplateSnapshot?: string | null }).parameterTemplateSnapshot = template?.snapshot ?? null;
  }
  return { variant, model: modelRow, site, adapter: resolved.adapter, apiKey };
}

/**
 * 根据 variant id 解析出转发所需的上下文
 */
export async function resolveRoute(variantId: string, requiredCapability?: string): Promise<ResolvedRoute> {
  const [variant] = await db
    .select()
    .from(variants)
    .where(eq(variants.name, variantId))
    .limit(1);
  if (!variant) {
    throw new RouterError(`Variant not found: ${variantId}`, 404, "variant_not_found");
  }
  return resolveRouteFromVariant(variant, requiredCapability);
}


/** 按数据库主键解析，供异步 worker 复用同一套路由逻辑。 */
export async function resolveRouteById(variantId: string, requiredCapability?: string): Promise<ResolvedRoute> {
  const [variant] = await db
    .select()
    .from(variants)
    .where(eq(variants.id, variantId))
    .limit(1);
  if (!variant) {
    throw new RouterError(`Variant not found: ${variantId}`, 404, "variant_not_found");
  }
  return resolveRouteFromVariant(variant, requiredCapability);
}

export function buildForwardContext(
  variant: typeof variants.$inferSelect,
  site: typeof sites.$inferSelect,
  apiKey: string,
) {
  return {
    targetUrl: site.baseUrl,
    apiKey,
    config: parseAdapterConfig(variant.adapterConfig),
  };
}

type RequestKind = "chat" | "embedding" | "image" | "audio" | "video";

const REQUEST_FIELDS: Record<RequestKind, string[]> = {
  chat: Array.from(CHAT_KNOWN_FIELDS),
  embedding: ["model", "input", "encoding_format", "user"],
  image: [
    "model", "prompt", "n", "size", "quality", "style", "response_format", "user",
    "image", "mask",
  ],
  audio: [
    "model", "input", "voice", "response_format", "speed", "file", "language", "prompt", "temperature",
  ],
  video: [
    "model", "prompt", "content", "duration", "aspect_ratio", "resolution", "callback_url", "idempotency_key",
    "reference_image_url", "reference_image_urls", "reference_video_url", "reference_video_urls",
    "reference_audio_url", "reference_audio_urls", "image_url", "image_urls", "video_url", "video_urls",
    "audio_url", "audio_urls", "provider_options",
  ],
};

export function applyVariantParams<T extends Record<string, unknown>>(
  route: ResolvedRoute,
  body: T,
  kind: RequestKind,
): T {
  const contract = readModelInputContract(route.model);
  let fieldMapping: Record<string, string> = {};
  let paramLimits: Record<string, string[]> = {};
  try {
    if (route.variant.fieldMapping) {
      const parsed = JSON.parse(route.variant.fieldMapping) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("field_mapping must be an object");
      fieldMapping = parsed as Record<string, string>;
    }
    if (route.variant.paramLimits) {
      const parsed = JSON.parse(route.variant.paramLimits) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("param_limits must be an object");
      for (const [field, values] of Object.entries(parsed as Record<string, unknown>)) {
        if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
          throw new Error(`param_limits.${field} must be a string array`);
        }
        paramLimits[field] = values;
      }
    }
  } catch (error) {
    throw new RouterError(
      error instanceof Error ? error.message : "Invalid variant parameter policy",
      500,
      "model_parameter_invalid",
    );
  }
  const mapped = mapStoredVariantParams(
    body,
    route.variant,
    [...REQUEST_FIELDS[kind], ...contract.fields],
    {
      keepProviderOptions: route.adapter.id === "memefast",
      paramDefaults: {
        ...contract.defaults,
        ...(route.variant.paramDefaults ? (() => {
          try {
            const parsed = JSON.parse(route.variant.paramDefaults) as unknown;
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
              ? parsed as Record<string, unknown>
              : {};
          } catch {
            throw new RouterError("Invalid variant param_defaults", 500, "model_parameter_invalid");
          }
        })() : {}),
      },
    },
  );
  if (mapped.dropped.length > 0) {
    throw new RouterError(
      `Unknown parameter: ${mapped.dropped.join(", ")}`,
      400,
      "unknown_parameter",
    );
  }
  const validationBody = { ...mapped.body };
  for (const [callerField, providerField] of Object.entries(fieldMapping)) {
    if (validationBody[callerField] === undefined && validationBody[providerField] !== undefined) {
      validationBody[callerField] = validationBody[providerField];
    }
  }
  const contractError = validateModelRequest(
    validationBody,
    route.model,
    {
      maxReferenceImages: route.variant.maxReferenceImages,
      maxReferenceVideos: route.variant.maxReferenceVideos,
      maxReferenceAudios: route.variant.maxReferenceAudios,
    },
    fieldMapping,
    paramLimits,
  );
  if (contractError) {
    throw new RouterError(contractError, 400, "model_parameter_invalid");
  }
  return mapped.body as T;
}

export async function forwardChat(
  variantId: string,
  req: ChatRequest,
): Promise<ChatResponse> {
  const route = await resolveRoute(variantId, "chat");
  const ctx = buildForwardContext(route.variant, route.site, route.apiKey);
  req = applyVariantParams(route, req as unknown as Record<string, unknown>, "chat") as ChatRequest;
  // 把"v1/chat 请求里的 model (= variant name)"替换成上游站点的真实模型 id
  req.model = route.model.rawName;
  try {
    return await route.adapter.forwardChat(req, ctx);
  } catch (err) {
    await markSiteError(route.site.id, err);
    throw err;
  }
}

export async function forwardChatStream(
  variantId: string,
  req: ChatRequest,
): Promise<Response> {
  const route = await resolveRoute(variantId, "chat");
  const ctx = buildForwardContext(route.variant, route.site, route.apiKey);
  req = applyVariantParams(route, req as unknown as Record<string, unknown>, "chat") as ChatRequest;
  req.model = route.model.rawName;
  try {
    return await route.adapter.forwardChatStream(req, ctx);
  } catch (err) {
    await markSiteError(route.site.id, err);
    throw err;
  }
}

export async function forwardImageGeneration(
  variantId: string,
  req: ImageGenerationRequest,
): Promise<ImageResponse> {
  const route = await resolveRoute(variantId, "image.generation");
  if (!route.adapter.forwardImageGeneration) {
    throw new RouterError("Adapter does not support image.generation", 400, "capability_unsupported");
  }
  const ctx = buildForwardContext(route.variant, route.site, route.apiKey);
  req = applyVariantParams(route, req as unknown as Record<string, unknown>, "image") as unknown as ImageGenerationRequest;
  req.model = route.model.rawName;
  try {
    return await route.adapter.forwardImageGeneration(req, ctx);
  } catch (err) {
    await markSiteError(route.site.id, err);
    throw err;
  }
}

export async function forwardImageEdit(
  variantId: string,
  req: ImageEditRequest,
): Promise<ImageResponse> {
  const route = await resolveRoute(variantId, "image.edit");
  if (!route.adapter.forwardImageEdit) {
    throw new RouterError("Adapter does not support image.edit", 400, "capability_unsupported");
  }
  const ctx = buildForwardContext(route.variant, route.site, route.apiKey);
  req = applyVariantParams(route, req as unknown as Record<string, unknown>, "image") as unknown as ImageEditRequest;
  req.model = route.model.rawName;
  try {
    return await route.adapter.forwardImageEdit(req, ctx);
  } catch (err) {
    await markSiteError(route.site.id, err);
    throw err;
  }
}

export async function forwardImageVariation(
  variantId: string,
  req: ImageVariationRequest,
): Promise<ImageResponse> {
  const route = await resolveRoute(variantId, "image.variation");
  if (!route.adapter.forwardImageVariation) {
    throw new RouterError(
      "Adapter does not support image.variation",
      400,
      "capability_unsupported",
    );
  }
  const ctx = buildForwardContext(route.variant, route.site, route.apiKey);
  req = applyVariantParams(route, req as unknown as Record<string, unknown>, "image") as unknown as ImageVariationRequest;
  req.model = route.model.rawName;
  try {
    return await route.adapter.forwardImageVariation(req, ctx);
  } catch (err) {
    await markSiteError(route.site.id, err);
    throw err;
  }
}

export async function forwardAudioSpeech(
  variantId: string,
  req: AudioSpeechRequest,
): Promise<ArrayBuffer> {
  const route = await resolveRoute(variantId, "audio.speech");
  if (!route.adapter.forwardAudioSpeech) {
    throw new RouterError(
      "Adapter does not support audio.speech",
      400,
      "capability_unsupported",
    );
  }
  const ctx = buildForwardContext(route.variant, route.site, route.apiKey);
  req = applyVariantParams(route, req as unknown as Record<string, unknown>, "audio") as unknown as AudioSpeechRequest;
  req.model = route.model.rawName;
  try {
    return await route.adapter.forwardAudioSpeech(req, ctx);
  } catch (err) {
    await markSiteError(route.site.id, err);
    throw err;
  }
}

export async function forwardAudioTranscription(
  variantId: string,
  req: AudioTranscriptionRequest,
): Promise<AudioTranscriptionResponse> {
  const route = await resolveRoute(variantId, "audio.transcription");
  if (!route.adapter.forwardAudioTranscription) {
    throw new RouterError(
      "Adapter does not support audio.transcription",
      400,
      "capability_unsupported",
    );
  }
  const ctx = buildForwardContext(route.variant, route.site, route.apiKey);
  req = applyVariantParams(route, req as unknown as Record<string, unknown>, "audio") as unknown as AudioTranscriptionRequest;
  req.model = route.model.rawName;
  try {
    return await route.adapter.forwardAudioTranscription(req, ctx);
  } catch (err) {
    await markSiteError(route.site.id, err);
    throw err;
  }
}

export async function forwardEmbedding(
  variantId: string,
  req: EmbeddingRequest,
): Promise<EmbeddingResponse> {
  const route = await resolveRoute(variantId, "embedding");
  if (!route.adapter.forwardEmbedding) {
    throw new RouterError("Adapter does not support embeddings", 400, "capability_unsupported");
  }
  const ctx = buildForwardContext(route.variant, route.site, route.apiKey);
  req = applyVariantParams(route, req as unknown as Record<string, unknown>, "embedding") as unknown as EmbeddingRequest;
  req.model = route.model.rawName;
  try {
    return await route.adapter.forwardEmbedding(req, ctx);
  } catch (err) {
    await markSiteError(route.site.id, err);
    throw err;
  }
}

export async function submitVideoTask(
  variantId: string,
  req: VideoSubmitRequest,
) {
  const route = await resolveRoute(variantId, "video.submit");
  if (!route.adapter.submitVideoTask) {
    throw new RouterError(
      "Adapter does not support video.submit",
      400,
      "capability_unsupported",
    );
  }
  const ctx = buildForwardContext(route.variant, route.site, route.apiKey);
  req = applyVariantParams(route, req as unknown as Record<string, unknown>, "video") as VideoSubmitRequest;
  req.model = route.model.rawName;
  try {
    return await route.adapter.submitVideoTask(req, ctx);
  } catch (err) {
    await markSiteError(route.site.id, err);
    throw err;
  }
}

export async function queryVideoTask(
  variantId: string,
  siteTaskId: string,
): Promise<VideoQueryResult> {
  const route = await resolveRoute(variantId, "video.query");
  if (!route.adapter.queryVideoTask) {
    throw new RouterError(
      "Adapter does not support video.query",
      400,
      "capability_unsupported",
    );
  }
  const ctx = buildForwardContext(route.variant, route.site, route.apiKey);
  try {
    return await route.adapter.queryVideoTask(siteTaskId, ctx);
  } catch (err) {
    await markSiteError(route.site.id, err);
    throw err;
  }
}

async function markSiteError(siteId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1);
  if (!site) return;

  const info = err && typeof err === "object" && "info" in err
    ? (err as { info?: unknown }).info
    : undefined;
  const upstreamStatus = info && typeof info === "object" && typeof (info as Record<string, unknown>).status === "number"
    ? (info as Record<string, unknown>).status as number
    : undefined;
  if (upstreamStatus === 429) {
    await db
      .update(sites)
      .set({ lastError: message, updatedAt: new Date() })
      .where(eq(sites.id, siteId));
    return;
  }

  const errorCount = site.errorCount + 1;
  const siteStatus = errorCount >= 5 ? "error" : site.status;

  await db
    .update(sites)
    .set({ errorCount, lastError: message, status: siteStatus, updatedAt: new Date() })
    .where(eq(sites.id, siteId));
}
