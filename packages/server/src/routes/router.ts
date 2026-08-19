import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { sites, models, variants } from "../db/schema/index";
import {
  resolveAdapterForModel,
  validateAdapterConfig,
  type Adapter,
} from "../engine/adapter";
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
  VideoSubmitRequest,
  VideoQueryResult,
} from "../engine/adapter";

export class RouterError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
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

async function resolveRouteFromVariant(variant: typeof variants.$inferSelect): Promise<ResolvedRoute> {
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

  const resolved = resolveAdapterForModel(modelRow.adapterId, site.adapterId);
  if (!resolved) {
    throw new RouterError(
      `Adapter not found for model ${modelRow.rawName}: ${modelRow.adapterId} / ${site.adapterId}`,
      500,
      "adapter_not_found",
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
  return { variant, model: modelRow, site, adapter: resolved.adapter, apiKey };
}

/**
 * 根据 variant id 解析出转发所需的上下文
 */
export async function resolveRoute(variantId: string): Promise<ResolvedRoute> {
  const [variant] = await db
    .select()
    .from(variants)
    .where(eq(variants.name, variantId))
    .limit(1);
  if (!variant) {
    throw new RouterError(`Variant not found: ${variantId}`, 404, "variant_not_found");
  }
  return resolveRouteFromVariant(variant);
}

/** 按数据库主键解析，供异步 worker 复用同一套路由逻辑。 */
export async function resolveRouteById(variantId: string): Promise<ResolvedRoute> {
  const [variant] = await db
    .select()
    .from(variants)
    .where(eq(variants.id, variantId))
    .limit(1);
  if (!variant) {
    throw new RouterError(`Variant not found: ${variantId}`, 404, "variant_not_found");
  }
  return resolveRouteFromVariant(variant);
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

export async function forwardChat(
  variantId: string,
  req: ChatRequest,
): Promise<ChatResponse> {
  const route = await resolveRoute(variantId);
  const ctx = buildForwardContext(route.variant, route.site, route.apiKey);
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
  const route = await resolveRoute(variantId);
  const ctx = buildForwardContext(route.variant, route.site, route.apiKey);
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
  const route = await resolveRoute(variantId);
  if (!route.adapter.forwardImageGeneration) {
    throw new RouterError("Adapter does not support image.generation", 400, "capability_unsupported");
  }
  const ctx = buildForwardContext(route.variant, route.site, route.apiKey);
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
  const route = await resolveRoute(variantId);
  if (!route.adapter.forwardImageEdit) {
    throw new RouterError("Adapter does not support image.edit", 400, "capability_unsupported");
  }
  const ctx = buildForwardContext(route.variant, route.site, route.apiKey);
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
  const route = await resolveRoute(variantId);
  if (!route.adapter.forwardImageVariation) {
    throw new RouterError(
      "Adapter does not support image.variation",
      400,
      "capability_unsupported",
    );
  }
  const ctx = buildForwardContext(route.variant, route.site, route.apiKey);
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
  const route = await resolveRoute(variantId);
  if (!route.adapter.forwardAudioSpeech) {
    throw new RouterError(
      "Adapter does not support audio.speech",
      400,
      "capability_unsupported",
    );
  }
  const ctx = buildForwardContext(route.variant, route.site, route.apiKey);
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
  const route = await resolveRoute(variantId);
  if (!route.adapter.forwardAudioTranscription) {
    throw new RouterError(
      "Adapter does not support audio.transcription",
      400,
      "capability_unsupported",
    );
  }
  const ctx = buildForwardContext(route.variant, route.site, route.apiKey);
  req.model = route.model.rawName;
  try {
    return await route.adapter.forwardAudioTranscription(req, ctx);
  } catch (err) {
    await markSiteError(route.site.id, err);
    throw err;
  }
}

export async function submitVideoTask(
  variantId: string,
  req: VideoSubmitRequest,
) {
  const route = await resolveRoute(variantId);
  if (!route.adapter.submitVideoTask) {
    throw new RouterError(
      "Adapter does not support video.submit",
      400,
      "capability_unsupported",
    );
  }
  const ctx = buildForwardContext(route.variant, route.site, route.apiKey);
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
  const route = await resolveRoute(variantId);
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

  const errorCount = site.errorCount + 1;
  const status = errorCount >= 5 ? "error" : site.status;

  await db
    .update(sites)
    .set({ errorCount, lastError: message, status, updatedAt: new Date() })
    .where(eq(sites.id, siteId));
}
