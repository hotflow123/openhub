import {
  createMemeFastConnector,
  type AudioSpeechRequest as MemeFastAudioSpeechRequest,
  type AudioTranscriptionRequest as MemeFastAudioTranscriptionRequest,
  type ChatRequest as MemeFastChatRequest,
  type EmbeddingRequest as MemeFastEmbeddingRequest,
  type ImageGenerationRequest as MemeFastImageRequest,
} from "@openhub/memefast";
import type {
  Adapter,
  AudioSpeechRequest,
  AudioTranscriptionRequest,
  ChatRequest,
  EmbeddingRequest,
  ForwardContext,
  ImageGenerationRequest,
} from "../adapter";

type Connector = ReturnType<typeof createMemeFastConnector>;
const connectorCache = new Map<string, { apiKey: string; client: Connector }>();

function connector(ctx: ForwardContext) {
  const cached = connectorCache.get(ctx.targetUrl);
  if (cached?.apiKey === ctx.apiKey) return cached.client;
  const client = createMemeFastConnector({
    baseUrl: ctx.targetUrl,
    apiKey: ctx.apiKey,
  });
  connectorCache.set(ctx.targetUrl, { apiKey: ctx.apiKey, client });
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
  ],

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

  async healthCheck(ctx: ForwardContext) {
    return (await connector(ctx).verify()).ok;
  },
};
