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
  seed?: number;
  [key: string]: unknown;
}

export interface VideoSubmitRequest {
  /** 调用方提供的原始参数（含 prompt/duration/aspect_ratio 等） */
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
  /** 适配器特定覆盖配置 */
  config?: Record<string, unknown>;
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

/**
 * 以 model.adapterId 为优先级解析适配器，site.adapterId 仅作为历史数据兜底。
 * 这样同一站点可以承载不同协议的模型，同时不立即破坏旧记录。
 */
export function resolveAdapterForModel(
  modelAdapterId: string | null | undefined,
  siteAdapterId: string | null | undefined,
): { adapter: Adapter; adapterId: string } | null {
  const candidates = [normalizeAdapterId(modelAdapterId), normalizeAdapterId(siteAdapterId)]
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
  const required = requiredCapabilityForModality(modality);
  if (!required) return null;
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
