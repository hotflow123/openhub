import {
  createMemeFastConnector,
  type AudioSpeechRequest as MemeFastAudioSpeechRequest,
  type AudioTranscriptionRequest as MemeFastAudioTranscriptionRequest,
  type ChatRequest as MemeFastChatRequest,
  type EmbeddingRequest as MemeFastEmbeddingRequest,
  type ImageGenerationRequest as MemeFastImageRequest,
  type VideoSubmitRequest as MemeFastVideoSubmitRequest,
} from "@openhub/memefast";
import type {
  Adapter,
  AudioSpeechRequest,
  AudioTranscriptionRequest,
  ChatRequest,
  EmbeddingRequest,
  ForwardContext,
  ImageGenerationRequest,
  VideoQueryResult,
  VideoSubmitRequest,
  VideoSubmitResult,
} from "../adapter";

type Connector = ReturnType<typeof createMemeFastConnector>;
const connectorCache = new Map<string, { apiKey: string; client: Connector }>();

function connector(ctx: ForwardContext) {
  const videoConfig = ctx.config?.video && typeof ctx.config.video === "object" && !Array.isArray(ctx.config.video)
    ? ctx.config.video as { protocol?: string }
    : undefined;
  const cacheKey = `${ctx.targetUrl}:${videoConfig?.protocol ?? "auto"}`;
  const cached = connectorCache.get(cacheKey);
  if (cached?.apiKey === ctx.apiKey) return cached.client;
  const client = createMemeFastConnector({
    baseUrl: ctx.targetUrl,
    apiKey: ctx.apiKey,
    video: videoConfig as { protocol?: import("@openhub/memefast").MemeFastVideoProtocol } | undefined,
  });
  connectorCache.set(cacheKey, { apiKey: ctx.apiKey, client });
  return client;
}

export const memefastAdapter: Adapter = {
  id: "memefast",
  capabilities: [
    "chat",
    "chat.stream",
    "embedding",
    "models.list",
    "image.generation",
    "audio.speech",
    "audio.transcription",
    "video.submit",
    "video.query",
  ],

  validateConfig(config, modality) {
    if (modality !== "video") return null;
    const protocol = (config?.video as { protocol?: unknown } | undefined)?.protocol;
    if (protocol === undefined) return "A verified MemeFast video protocol is required";
    return ["veo", "openai", "seedance", "kling", "vidu", "pixverse", "minimax", "luma"].includes(String(protocol))
      ? null
      : `Unsupported MemeFast video protocol: ${String(protocol)}`;
  },

  async discoverModels(ctx: ForwardContext) {
    const models = await connector(ctx).discover();
    return models.map((model) => ({
      id: model.id,
      object: model.object,
      ...(model.created === undefined ? {} : { created: model.created }),
      ...(model.ownedBy === undefined ? {} : { owned_by: model.ownedBy }),
      metadata: model.raw && typeof model.raw === "object" && !Array.isArray(model.raw)
        ? model.raw as Record<string, unknown>
        : undefined,
    }));
  },

  async forwardChat(req: ChatRequest, ctx: ForwardContext) {
    return await connector(ctx).chat(req as unknown as MemeFastChatRequest) as unknown as import("../adapter").ChatResponse;
  },

  async forwardChatStream(req: ChatRequest, ctx: ForwardContext) {
    return connector(ctx).chatStream(req as unknown as MemeFastChatRequest);
  },

  async forwardEmbedding(req: EmbeddingRequest, ctx: ForwardContext) {
    return await connector(ctx).embedding(req as unknown as MemeFastEmbeddingRequest) as unknown as import("../adapter").EmbeddingResponse;
  },

  async forwardImageGeneration(req: ImageGenerationRequest, ctx: ForwardContext) {
    return await connector(ctx).imageGeneration(req as unknown as MemeFastImageRequest) as unknown as import("../adapter").ImageResponse;
  },

  async forwardAudioSpeech(req: AudioSpeechRequest, ctx: ForwardContext) {
    return connector(ctx).audioSpeech(req as unknown as MemeFastAudioSpeechRequest);
  },

  async forwardAudioTranscription(req: AudioTranscriptionRequest, ctx: ForwardContext) {
    return connector(ctx).audioTranscription(req as unknown as MemeFastAudioTranscriptionRequest);
  },

  async submitVideoTask(req: VideoSubmitRequest, ctx: ForwardContext): Promise<VideoSubmitResult> {
    return await connector(ctx).videoSubmit(req as unknown as MemeFastVideoSubmitRequest) as unknown as VideoSubmitResult;
  },

  async queryVideoTask(siteTaskId: string, ctx: ForwardContext): Promise<VideoQueryResult> {
    return await connector(ctx).videoQuery(siteTaskId, ctx.model) as unknown as VideoQueryResult;
  },

  async healthCheck(ctx: ForwardContext) {
    return (await connector(ctx).verify()).ok;
  },
};
