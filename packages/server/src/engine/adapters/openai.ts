import {
  type Adapter,
  type ChatRequest,
  type ChatResponse,
  type EmbeddingRequest,
  type EmbeddingResponse,
  type ForwardContext,
  type ImageGenerationRequest,
  type ImageEditRequest,
  type ImageVariationRequest,
  type ImageResponse,
  type AudioSpeechRequest,
  type AudioTranscriptionRequest,
  type AudioTranscriptionResponse,
  type VideoSubmitRequest,
  type VideoSubmitResult,
  type VideoQueryResult,
  type VideoTaskStatus,
  type VideoResult,
} from "../adapter";

function baseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

/**
 * OpenAI 兼容适配器
 *
 * 适用于 OpenAI 官方，以及所有遵循 OpenAI Chat Completions API 规范的
 * New API 站点（绝大多数 New API 实现都是 OpenAI 兼容的）。
 *
 * 多模态能力（image/audio）也走 OpenAI 的同源端点。视频通过异步任务走。
 */
export const openaiAdapter: Adapter = {
  id: "openai",
  capabilities: [
    "chat",
    "chat.stream",
    "embedding",
    "models.list",
    "image.generation",
    "image.edit",
    "image.variation",
    "audio.speech",
    "audio.transcription",
    "video.submit",
    "video.query",
  ],

  validateConfig(config, modality) {
    if (modality !== "video") return null;
    const endpoint = (config?.video as { endpoint?: unknown } | undefined)?.endpoint;
    return typeof endpoint === "string" && endpoint.trim().length > 0
      ? null
      : "openai adapter requires adapterConfig.video.endpoint for video models";
  },

  async forwardChat(req: ChatRequest, ctx: ForwardContext): Promise<ChatResponse> {
    const url = `${baseUrl(ctx.targetUrl)}/v1/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.apiKey}`,
      },
      body: JSON.stringify({ ...req, stream: false }),
    });
    if (!response.ok) {
      throw await toAdapterError(response, "chat");
    }
    return (await response.json()) as ChatResponse;
  },

  async forwardChatStream(req: ChatRequest, ctx: ForwardContext): Promise<Response> {
    const url = `${baseUrl(ctx.targetUrl)}/v1/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.apiKey}`,
      },
      body: JSON.stringify({ ...req, stream: true }),
    });
    if (!response.ok) {
      throw await toAdapterError(response, "chat.stream");
    }
    return response;
  },

  async forwardEmbedding(
    req: EmbeddingRequest,
    ctx: ForwardContext,
  ): Promise<EmbeddingResponse> {
    const url = `${baseUrl(ctx.targetUrl)}/v1/embeddings`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.apiKey}`,
      },
      body: JSON.stringify(req),
    });
    if (!response.ok) {
      throw await toAdapterError(response, "embedding");
    }
    return (await response.json()) as EmbeddingResponse;
  },

  async healthCheck(ctx: ForwardContext): Promise<boolean> {
    try {
      const url = `${baseUrl(ctx.targetUrl)}/v1/models`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${ctx.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  // ───────── Image ─────────

  async forwardImageGeneration(
    req: ImageGenerationRequest,
    ctx: ForwardContext,
  ): Promise<ImageResponse> {
    const url = `${baseUrl(ctx.targetUrl)}/v1/images/generations`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.apiKey}`,
      },
      body: JSON.stringify(req),
    });
    if (!response.ok) {
      throw await toAdapterError(response, "image.generation");
    }
    return (await response.json()) as ImageResponse;
  },

  async forwardImageEdit(
    req: ImageEditRequest,
    ctx: ForwardContext,
  ): Promise<ImageResponse> {
    const form = new FormData();
    appendMultipartFields(form, req as unknown as Record<string, unknown>);

    const url = `${baseUrl(ctx.targetUrl)}/v1/images/edits`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: form,
    });
    if (!response.ok) {
      throw await toAdapterError(response, "image.edit");
    }
    return (await response.json()) as ImageResponse;
  },

  async forwardImageVariation(
    req: ImageVariationRequest,
    ctx: ForwardContext,
  ): Promise<ImageResponse> {
    const form = new FormData();
    appendMultipartFields(form, req as unknown as Record<string, unknown>);

    const url = `${baseUrl(ctx.targetUrl)}/v1/images/variations`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: form,
    });
    if (!response.ok) {
      throw await toAdapterError(response, "image.variation");
    }
    return (await response.json()) as ImageResponse;
  },

  // ───────── Audio ─────────

  async forwardAudioSpeech(
    req: AudioSpeechRequest,
    ctx: ForwardContext,
  ): Promise<ArrayBuffer> {
    const url = `${baseUrl(ctx.targetUrl)}/v1/audio/speech`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.apiKey}`,
      },
      body: JSON.stringify(req),
    });
    if (!response.ok) {
      throw await toAdapterError(response, "audio.speech");
    }
    return await response.arrayBuffer();
  },

  async forwardAudioTranscription(
    req: AudioTranscriptionRequest,
    ctx: ForwardContext,
  ): Promise<AudioTranscriptionResponse> {
    const form = new FormData();
    appendMultipartFields(form, req as unknown as Record<string, unknown>);

    const url = `${baseUrl(ctx.targetUrl)}/v1/audio/transcriptions`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: form,
    });
    if (!response.ok) {
      throw await toAdapterError(response, "audio.transcription");
    }
    return (await response.json()) as AudioTranscriptionResponse;
  },

  // ───────── Video（异步） ─────────
  // 走 OpenAI 兼容风格的额外端点 /v1/videos。
  // 真实 OpenAI 没有这个端点，但 mock 站点和某些 New API 站点
  // 已经实现了这个异步协议；通过 adapterConfig 启用。
  //
  // 启用方式：variant.adapterConfig = { "video": { "endpoint": "videos" } }
  // 不启用时维持"能力未实现"语义，前端可以基于此推断站点是否支持视频。

  async submitVideoTask(
    req: VideoSubmitRequest,
    ctx: ForwardContext,
  ): Promise<VideoSubmitResult> {
    const endpoint = (ctx.config?.video as { endpoint?: string } | undefined)?.endpoint;
    if (!endpoint) {
      throw new Error(
        "openaiAdapter: submitVideoTask requires adapterConfig.video.endpoint (e.g. 'videos')",
      );
    }
    const url = `${baseUrl(ctx.targetUrl)}/v1/${endpoint}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.apiKey}`,
      },
      body: JSON.stringify(req),
    });
    if (!response.ok) {
      throw await toAdapterError(response, "video.submit");
    }
    const data = (await response.json()) as { id?: string; status?: VideoTaskStatus };
    if (!data.id) {
      throw new Error("openaiAdapter: video.submit response missing id");
    }
    return {
      siteTaskId: data.id,
      initialStatus: (data.status as VideoTaskStatus) ?? "pending",
      rawResult: data,
    };
  },

  async queryVideoTask(
    siteTaskId: string,
    ctx: ForwardContext,
  ): Promise<VideoQueryResult> {
    const endpoint = (ctx.config?.video as { endpoint?: string } | undefined)?.endpoint;
    if (!endpoint) {
      throw new Error(
        "openaiAdapter: queryVideoTask requires adapterConfig.video.endpoint",
      );
    }
    const url = `${baseUrl(ctx.targetUrl)}/v1/${endpoint}/${encodeURIComponent(siteTaskId)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
    });
    if (!response.ok) {
      throw await toAdapterError(response, "video.query");
    }
    const data = (await response.json()) as Record<string, unknown>;
    const status = (data.status as string) ?? "processing";
    const result = data.result as Record<string, unknown> | undefined;
    return {
      status: mapGenericVideoStatus(status),
      result: result as VideoResult | undefined,
      raw: data,
    };
  },

  mapVideoStatus(siteStatus: unknown): VideoTaskStatus {
    return mapGenericVideoStatus(siteStatus);
  },

  transformVideoResult(raw: unknown) {
    return raw as { video_url: string; [k: string]: unknown };
  },
};

async function toAdapterError(response: Response, capability: string): Promise<Error> {
  const text = await response.text().catch(() => response.statusText);
  const err = new Error(`OpenAI adapter [${capability}] ${response.status}: ${text}`);
  (err as Error & { status?: number; adapter?: string; capability?: string }).status =
    response.status;
  (err as Error & { status?: number; adapter?: string; capability?: string }).adapter = "openai";
  (err as Error & { status?: number; adapter?: string; capability?: string }).capability =
    capability;
  return err;
}

function appendImageField(form: FormData, key: string, value: Blob | string): void {
  if (typeof value === "string") {
    if (value.startsWith("data:")) {
      const [meta, b64] = value.split(",", 2);
      const mime = meta.match(/data:([^;]+)/)?.[1] ?? "application/octet-stream";
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      form.append(key, new Blob([bytes], { type: mime }), "image");
    } else if (/^https?:\/\//.test(value)) {
      // URL 不直接被 OpenAI 接受；调用方应在外部下载后转 Blob
      form.append(key, value);
    } else {
      form.append(key, value);
    }
  } else {
    form.append(key, value, "image");
  }
}

function appendAudioField(form: FormData, key: string, value: Blob | string): void {
  if (typeof value === "string") {
    if (value.startsWith("data:")) {
      const [meta, b64] = value.split(",", 2);
      const mime = meta.match(/data:([^;]+)/)?.[1] ?? "application/octet-stream";
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      form.append(key, new Blob([bytes], { type: mime }), "audio");
    } else if (/^https?:\/\//.test(value)) {
      form.append(key, value);
    } else {
      form.append(key, value);
    }
  } else {
    form.append(key, value, "audio");
  }
}

function appendMultipartFields(form: FormData, body: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(body)) {
    if (value == null) continue;
    if (key === "image" || key === "mask") {
      appendImageField(form, key, value as Blob | string);
      continue;
    }
    if (key === "file") {
      appendAudioField(form, key, value as Blob | string);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item != null) form.append(key, String(item));
      }
      continue;
    }
    if (value instanceof Blob) {
      form.append(key, value, key);
      continue;
    }
    form.append(key, String(value));
  }
}

export function mapGenericVideoStatus(siteStatus: unknown): VideoTaskStatus {
  if (typeof siteStatus !== "string") return "processing";
  const s = siteStatus.toLowerCase();
  if (
    s === "pending" ||
    s === "queued" ||
    s === "submitted" ||
    s === "waiting" ||
    s === "not_started"
  ) {
    return "pending";
  }
  if (
    s === "processing" ||
    s === "in_progress" ||
    s === "running" ||
    s === "started" ||
    s === "active"
  ) {
    return "processing";
  }
  if (s === "completed" || s === "success" || s === "succeeded" || s === "finished") {
    return "completed";
  }
  if (s === "failed" || s === "failure" || s === "error" || s === "canceled") {
    return "failed";
  }
  if (s === "timeout" || s === "expired") return "timeout";
  return "processing";
}
