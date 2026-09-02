import type {
  AdapterCapability as SdkAdapterCapability,
  AdapterContext as SdkAdapterContext,
  AdapterHandler as SdkAdapterHandler,
  AdapterManifest,
  AudioAdapter as SdkAudioAdapter,
  AudioSpeechRequest as SdkAudioSpeechRequest,
  AudioTranscriptionRequest as SdkAudioTranscriptionRequest,
  AudioTranscriptionResponse as SdkAudioTranscriptionResponse,
  ChatRequest as SdkChatRequest,
  ChatResponse as SdkChatResponse,
  EmbeddingAdapter as SdkEmbeddingAdapter,
  EmbeddingRequest as SdkEmbeddingRequest,
  EmbeddingResponse as SdkEmbeddingResponse,
  ImageAdapter as SdkImageAdapter,
  ImageEditRequest as SdkImageEditRequest,
  ImageGenerationRequest as SdkImageGenerationRequest,
  ImageResponse as SdkImageResponse,
  ImageVariationRequest as SdkImageVariationRequest,
  LlmAdapter as SdkLlmAdapter,
  ProviderAdapter,
  VideoAdapter as SdkVideoAdapter,
  VideoQueryResult as SdkVideoQueryResult,
  VideoSubmitRequest as SdkVideoSubmitRequest,
  VideoSubmitResult as SdkVideoSubmitResult,
} from "@openhub/adapter-sdk";

/**
 * 适配器接口
 *
 * 每个适配器负责把 OpenHub 标准请求格式转换为某个上游 API 的格式，
 * 并把响应转换回 OpenHub 标准格式。
 *
 * 兼容性：
 *  - Phase 1：chat / chat.stream / embedding / healthCheck
 *  - Phase 3A：image（generations / edits / variations）/ audio（speech / transcriptions）
 *  - Phase 3B：video（submitTask / queryTask / mapStatus / transformResult）
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  user?: string;
  [key: string]: unknown;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatChoice[];
  usage: ChatUsage;
}

export interface EmbeddingRequest {
  model: string;
  input: string | string[];
  encoding_format?: "float" | "base64";
  user?: string;
}

export interface EmbeddingData {
  object: string;
  embedding: number[];
  index: number;
}

export interface EmbeddingResponse {
  object: string;
  data: EmbeddingData[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

// ────────────────────────────────────────────────────────────────
// Image
// ────────────────────────────────────────────────────────────────

export interface ImageGenerationRequest {
  model: string;
  prompt: string;
  n?: number;
  size?: string; // "1024x1024" | "1024x1792" | "1792x1024" | ...
  quality?: "standard" | "hd" | string;
  style?: "vivid" | "natural" | string;
  response_format?: "url" | "b64_json";
  user?: string;
}

export interface ImageEditRequest {
  model: string;
  prompt: string;
  image: Blob | string; // Blob (multipart) 或 URL/dataURI
  mask?: Blob | string;
  n?: number;
  size?: string;
  response_format?: "url" | "b64_json";
  user?: string;
}

export interface ImageVariationRequest {
  model: string;
  image: Blob | string;
  n?: number;
  size?: string;
  response_format?: "url" | "b64_json";
  user?: string;
}

export interface ImageData {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

export interface ImageResponse {
  created: number;
  data: ImageData[];
}

// ────────────────────────────────────────────────────────────────
// Audio
// ────────────────────────────────────────────────────────────────

export interface AudioSpeechRequest {
  model: string;
  input: string;
  voice: string;
  response_format?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
  speed?: number;
}

export interface AudioTranscriptionRequest {
  model: string;
  file: Blob | string; // multipart 或 base64
  language?: string;
  prompt?: string;
  response_format?: "json" | "text" | "srt" | "verbose_json" | "vtt";
  temperature?: number;
}

export interface AudioTranscriptionResponse {
  text: string;
}

// ────────────────────────────────────────────────────────────────
// Video（异步提交 / 轮询 / 标准化）
// ────────────────────────────────────────────────────────────────

export type VideoTaskStatus = "pending" | "processing" | "completed" | "failed" | "timeout";

export interface VideoResult {
  video_url: string;
  cover_url?: string;
  duration?: number;
  width?: number;
  height?: number;
  ratio?: string;
  resolution?: string;
  usage?: Record<string, number>;
  task_type?: string;
  modality?: string;
  provider_metadata?: Record<string, unknown>;
  seed?: number;
  [key: string]: unknown;
}

export interface VideoSubmitRequest {
  model?: string;
  prompt?: string;
  content?: Array<{ type: "text" | "image" | "video" | "audio"; text?: string; url?: string; role?: string }>;
  duration?: number | string;
  aspect_ratio?: string;
  resolution?: string;
  callback_url?: string;
  idempotency_key?: string;
  provider_options?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface VideoSubmitResult {
  siteTaskId: string;
  /** 站点返回的初始状态（一般是 pending / processing），用于首轮记录 */
  initialStatus: VideoTaskStatus;
  /** 站点返回的原始结果，透传到 transformResult */
  rawResult?: unknown;
}

export interface VideoQueryResult {
  status: VideoTaskStatus;
  result?: VideoResult;
  error?: string;
  raw?: unknown;
}

// ────────────────────────────────────────────────────────────────
// Forward Context
// ────────────────────────────────────────────────────────────────

export interface ForwardContext {
  targetUrl: string;
  apiKey: string;
  model?: string;
  /** 适配器特定覆盖配置 */
  config?: Record<string, unknown>;
}

export interface DiscoveredRemoteModel {
  id: string;
  object?: string;
  created?: number;
  name?: string;
  owned_by?: string;
  metadata?: Record<string, unknown>;
}

export interface Adapter {
  id: string;
  /** 该适配器支持的 endpoint_caps 列表 */
  capabilities: string[];

  /**
   * 校验适配器私有配置。返回 null 表示配置可用。
   * 该校验在向导确认和运行时路由前都会执行，避免生成必失败变体。
   */
  validateConfig?(config: Record<string, unknown> | undefined, modality: string): string | null;

  // Phase 1
  forwardChat(req: ChatRequest, ctx: ForwardContext): Promise<ChatResponse>;
  forwardChatStream(req: ChatRequest, ctx: ForwardContext): Promise<Response>;
  forwardEmbedding?(req: EmbeddingRequest, ctx: ForwardContext): Promise<EmbeddingResponse>;
  /** 检查站点是否在线（轻量级 GET /v1/models） */
  healthCheck(ctx: ForwardContext): Promise<boolean>;
  /** 适配器自定义模型发现；未提供时由兼容协议兜底。 */
  discoverModels?(ctx: ForwardContext): Promise<DiscoveredRemoteModel[]>;

  // Phase 3A — Image
  forwardImageGeneration?(
    req: ImageGenerationRequest,
    ctx: ForwardContext,
  ): Promise<ImageResponse>;
  forwardImageEdit?(req: ImageEditRequest, ctx: ForwardContext): Promise<ImageResponse>;
  forwardImageVariation?(
    req: ImageVariationRequest,
    ctx: ForwardContext,
  ): Promise<ImageResponse>;

  // Phase 3A — Audio
  /** 返回音频二进制（ArrayBuffer），上层负责序列化 Content-Type */
  forwardAudioSpeech?(req: AudioSpeechRequest, ctx: ForwardContext): Promise<ArrayBuffer>;
  forwardAudioTranscription?(
    req: AudioTranscriptionRequest,
    ctx: ForwardContext,
  ): Promise<AudioTranscriptionResponse>;

  // Phase 3B — Video（异步）
  submitVideoTask?(req: VideoSubmitRequest, ctx: ForwardContext): Promise<VideoSubmitResult>;
  queryVideoTask?(siteTaskId: string, ctx: ForwardContext): Promise<VideoQueryResult>;
  /** 把站点返回的 status 字段标准化到 OpenHub 状态 */
  mapVideoStatus?(siteStatus: unknown): VideoTaskStatus;
  /** 把站点返回的 result 字段标准化到 OpenHub VideoResult */
  transformVideoResult?(raw: unknown): VideoResult;
}

function toLegacyContext(context: SdkAdapterContext): ForwardContext {
  const legacyContext: ForwardContext = {
    targetUrl: context.targetUrl,
    apiKey: context.apiKey,
  };
  if (context.config !== undefined) legacyContext.config = context.config;
  return legacyContext;
}

function hasCapability(adapter: Adapter, capability: SdkAdapterCapability): boolean {
  return adapter.capabilities.includes(capability);
}

function wrapLlmAdapter(adapter: Adapter): SdkLlmAdapter {
  return {
    complete: async (input: SdkChatRequest, context: SdkAdapterContext): Promise<SdkChatResponse> =>
      await adapter.forwardChat(
        input as unknown as ChatRequest,
        toLegacyContext(context),
      ) as unknown as SdkChatResponse,
    stream: async (input: SdkChatRequest, context: SdkAdapterContext): Promise<Response> =>
      await adapter.forwardChatStream(
        input as unknown as ChatRequest,
        toLegacyContext(context),
      ),
  };
}

function wrapEmbeddingAdapter(adapter: Adapter): SdkEmbeddingAdapter {
  return {
    create: async (input: SdkEmbeddingRequest, context: SdkAdapterContext): Promise<SdkEmbeddingResponse> =>
      await adapter.forwardEmbedding!(
        input as unknown as EmbeddingRequest,
        toLegacyContext(context),
      ) as unknown as SdkEmbeddingResponse,
  };
}

function wrapImageAdapter(adapter: Adapter): SdkImageAdapter {
  return {
    generate: adapter.forwardImageGeneration
      ? async (input: SdkImageGenerationRequest, context: SdkAdapterContext): Promise<SdkImageResponse> =>
        await adapter.forwardImageGeneration!(
          input as unknown as ImageGenerationRequest,
          toLegacyContext(context),
        ) as unknown as SdkImageResponse
      : undefined,
    edit: adapter.forwardImageEdit
      ? async (input: SdkImageEditRequest, context: SdkAdapterContext): Promise<SdkImageResponse> =>
        await adapter.forwardImageEdit!(
          input as unknown as ImageEditRequest,
          toLegacyContext(context),
        ) as unknown as SdkImageResponse
      : undefined,
    variation: adapter.forwardImageVariation
      ? async (input: SdkImageVariationRequest, context: SdkAdapterContext): Promise<SdkImageResponse> =>
        await adapter.forwardImageVariation!(
          input as unknown as ImageVariationRequest,
          toLegacyContext(context),
        ) as unknown as SdkImageResponse
      : undefined,
  };
}

function wrapAudioAdapter(adapter: Adapter): SdkAudioAdapter {
  return {
    speech: adapter.forwardAudioSpeech
      ? async (input: SdkAudioSpeechRequest, context: SdkAdapterContext): Promise<ArrayBuffer> =>
        await adapter.forwardAudioSpeech!(
          input as unknown as AudioSpeechRequest,
          toLegacyContext(context),
        )
      : undefined,
    transcribe: adapter.forwardAudioTranscription
      ? async (input: SdkAudioTranscriptionRequest, context: SdkAdapterContext): Promise<SdkAudioTranscriptionResponse> =>
        await adapter.forwardAudioTranscription!(
          input as unknown as AudioTranscriptionRequest,
          toLegacyContext(context),
        ) as unknown as SdkAudioTranscriptionResponse
      : undefined,
  };
}

function wrapVideoAdapter(adapter: Adapter): SdkVideoAdapter {
  return {
    submit: async (input: SdkVideoSubmitRequest, context: SdkAdapterContext): Promise<SdkVideoSubmitResult> =>
      await adapter.submitVideoTask!(
        input as unknown as VideoSubmitRequest,
        toLegacyContext(context),
      ) as unknown as SdkVideoSubmitResult,
    query: async (siteTaskId: string, context: SdkAdapterContext): Promise<SdkVideoQueryResult> =>
      await adapter.queryVideoTask!(siteTaskId, toLegacyContext(context)) as unknown as SdkVideoQueryResult,
  };
}

/**
 * 将旧版适配器包装为来源中立 SDK 适配器。
 * manifest 必须由调用方提供，避免桥接层凭适配器 ID 猜测模型身份或供应商能力。
 */
export function wrapLegacyAdapter(adapter: Adapter, manifest: AdapterManifest): ProviderAdapter {
  const handlers: SdkAdapterHandler[] = [];
  if (hasCapability(adapter, "chat") || hasCapability(adapter, "chat.stream")) {
    handlers.push({ modality: "llm", handler: wrapLlmAdapter(adapter) });
  }
  if (hasCapability(adapter, "embedding") && adapter.forwardEmbedding) {
    handlers.push({ modality: "embedding", handler: wrapEmbeddingAdapter(adapter) });
  }
  if (
    hasCapability(adapter, "image.generation") ||
    hasCapability(adapter, "image.edit") ||
    hasCapability(adapter, "image.variation")
  ) {
    handlers.push({ modality: "image", handler: wrapImageAdapter(adapter) });
  }
  if (hasCapability(adapter, "audio.speech") || hasCapability(adapter, "audio.transcription")) {
    handlers.push({ modality: "audio", handler: wrapAudioAdapter(adapter) });
  }
  if (hasCapability(adapter, "video.submit") || hasCapability(adapter, "video.query")) {
    handlers.push({ modality: "video", handler: wrapVideoAdapter(adapter) });
  }
  return {
    manifest,
    handlers,
    healthCheck: async (context: SdkAdapterContext) => await adapter.healthCheck(toLegacyContext(context)),
    discoverModels: adapter.discoverModels
      ? async (context: SdkAdapterContext) => (await adapter.discoverModels!(toLegacyContext(context))).map((model) => ({
        id: model.id,
        name: model.name,
        ownedBy: model.owned_by,
        metadata: {
          object: model.object,
          created: model.created,
          ...model.metadata,
        },
      }))
      : undefined,
    validateConfig: adapter.validateConfig
      ? (config, modality) => adapter.validateConfig!(config, modality)
      : undefined,
  };
}

const registry = new Map<string, Adapter>();

export function registerAdapter(adapter: Adapter): void {
  registry.set(adapter.id, adapter);
}

export function getAdapter(id: string): Adapter | undefined {
  return registry.get(id);
}

/** 兼容历史数据中的旧 ID；新写入数据必须使用注册表中的 canonical ID。 */
export function normalizeAdapterId(id: string | null | undefined): string | null {
  if (!id) return null;
  if (id === "openai-compatible") return "openai";
  return id;
}

export function providerV1Url(targetUrl: string, path: string): string {
  const base = targetUrl.replace(/\/+$/, "");
  const suffix = `/${path.replace(/^\/+/, "")}`;
  if (base.endsWith("/v1") && suffix === "/v1") return base;
  if (base.endsWith("/v1") && suffix.startsWith("/v1/")) {
    return `${base}${suffix.slice(3)}`;
  }
  return `${base}${suffix}`;
}

/**
 * 以 model.adapterId 为优先级解析适配器，site.adapterId 仅作为历史数据兜底。
 * 这样同一站点可以承载不同协议的模型，同时不立即破坏旧记录。
 */
export function resolveAdapterForModel(
  modelAdapterId: string | null | undefined,
  modelAdapterSource: "site" | "manual" | null | undefined,
  siteAdapterId: string | null | undefined,
): { adapter: Adapter; adapterId: string } | null {
  const candidates = (modelAdapterSource === "manual"
    ? [normalizeAdapterId(modelAdapterId), normalizeAdapterId(siteAdapterId)]
    : [normalizeAdapterId(siteAdapterId), normalizeAdapterId(modelAdapterId)])
    .filter((id): id is string => Boolean(id));
  for (const id of candidates) {
    const adapter = getAdapter(id);
    if (adapter) return { adapter, adapterId: id };
  }
  return null;
}

export function validateAdapterConfig(
  adapter: Adapter,
  config: Record<string, unknown> | undefined,
  modality: string,
): string | null {
  return adapter.validateConfig?.(config, modality) ?? null;
}

/** 返回某个模态至少需要的运行时能力，避免创建表面可用的变体。 */
export function requiredCapabilityForModality(modality: string): string | null {
  switch (modality) {
    case "llm":
      return "chat";
    case "embedding":
      return "embedding";
    case "image":
      return "image.generation";
    case "audio":
      return "audio.speech";
    case "video":
      return "video.submit";
    default:
      return null;
  }
}

export function validateAdapterCapability(adapter: Adapter, modality: string): string | null {
  if (modality === "unknown") {
    return "Model modality is unknown; confirm the model capability before creating a callable variant";
  }
  const required = requiredCapabilityForModality(modality);
  if (!required) return null;
  if (modality === "video") {
    const missing = ["video.submit", "video.query"].filter((capability) => !adapter.capabilities.includes(capability));
    return missing.length > 0 ? `Adapter ${adapter.id} does not support ${missing.join(" and ")}` : null;
  }
  const alternatives = modality === "audio"
    ? ["audio.speech", "audio.transcription"]
    : modality === "image"
      ? ["image.generation", "image.edit", "image.variation"]
      : [required];
  return alternatives.some((capability) => adapter.capabilities.includes(capability))
    ? null
    : `Adapter ${adapter.id} does not support ${alternatives.join(" or ")}`;
}

export function listAdapters(): Adapter[] {
  return Array.from(registry.values());
}
