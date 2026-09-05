import {
  type Adapter,
  type AudioSpeechRequest,
  type AudioTranscriptionRequest,
  type AudioTranscriptionResponse,
  type ChatRequest,
  type ChatResponse,
  type EmbeddingRequest,
  type EmbeddingResponse,
  type ForwardContext,
  type ImageEditRequest,
  type ImageGenerationRequest,
  type ImageResponse,
  type ImageVariationRequest,
  type VideoQueryResult,
  type VideoResult,
  type VideoSubmitRequest,
  type VideoSubmitResult,
  type VideoTaskStatus,
} from "../adapter";
import { mapGenericVideoStatus } from "./openai";
import { openaiAdapter } from "./openai";

function baseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function findExplicitOperation(
  ctx: ForwardContext,
  role: string,
  method: string,
  relatedPath?: string,
): Record<string, unknown> {
  const operations = ctx.protocol?.operations ?? [];
  const candidates = operations
    .filter((operation) => String(operation.method ?? "").toUpperCase() === method)
    .filter((operation) => typeof operation.path === "string")
    .filter((operation) => operation.operationRole === role || operation.operationId === role);
  const selected = [...candidates].sort((left, right) => {
    if (role !== "video.query") return 0;
    const leftSameFamily = relatedPath && sameEndpointFamily(String(left.path), relatedPath);
    const rightSameFamily = relatedPath && sameEndpointFamily(String(right.path), relatedPath);
    const leftHasTaskId = /\{(?:id|task_id|taskId)\}/.test(String(left.path));
    const rightHasTaskId = /\{(?:id|task_id|taskId)\}/.test(String(right.path));
    return (
      Number(Boolean(rightSameFamily)) * 100 +
      Number(rightHasTaskId) * 10 -
      Number(Boolean(leftSameFamily)) * 100 -
      Number(leftHasTaskId) * 10
    );
  })[0];
  if (!selected || typeof selected.path !== "string") {
    throw new Error(
      `MemeFast protocol ${ctx.protocol?.protocolId ?? "unknown"} has no explicit ${role} operation`,
    );
  }
  return selected;
}

function sameEndpointFamily(left: string, right: string): boolean {
  const normalize = (path: string) => path
    .replace(/\{(?:id|task_id|taskId)\}/g, "")
    .replace(/\/+$/, "");
  return normalize(left) === normalize(right).replace(/\/+$/, "");
}

function operationUrl(ctx: ForwardContext, operation: Record<string, unknown>, taskId?: string): string {
  let path = String(operation.path);
  if (/^https?:\/\//i.test(path)) {
    throw new Error("MemeFast protocol operation must use a relative path");
  }
  if (taskId) {
    path = path.replace(/\{(?:id|task_id|taskId)\}/g, encodeURIComponent(taskId));
    if (path.includes("{")) path = `${path.replace(/\/+$/, "")}/${encodeURIComponent(taskId)}`;
  }
  const target = new URL(ctx.targetUrl);
  if (target.pathname.endsWith("/v1") && path.startsWith("/v1/")) path = path.slice(3);
  return `${baseUrl(ctx.targetUrl)}/${path.replace(/^\/+/, "")}`;
}

async function readError(response: Response, capability: string): Promise<Error> {
  const detail = await response.text().catch(() => response.statusText);
  const error = new Error(`MemeFast adapter [${capability}] ${response.status}: ${detail}`);
  const metadata = error as Error & { status?: number; adapter?: string; capability?: string };
  metadata.status = response.status;
  metadata.adapter = "memefast";
  metadata.capability = capability;
  return error;
}

async function postJson<T>(
  ctx: ForwardContext,
  operation: Record<string, unknown>,
  body: Record<string, unknown>,
  capability: string,
): Promise<T> {
  const response = await fetch(operationUrl(ctx, operation), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.apiKey}`,
    },
    body: JSON.stringify(prepareRequestBody(body, operation)),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw await readError(response, capability);
  return await response.json() as T;
}

async function getJson<T>(
  ctx: ForwardContext,
  operation: Record<string, unknown>,
  taskId: string | undefined,
  capability: string,
): Promise<T> {
  const response = await fetch(operationUrl(ctx, operation, taskId), {
    headers: { Authorization: `Bearer ${ctx.apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw await readError(response, capability);
  return await response.json() as T;
}

function requestProperties(operation: Record<string, unknown>): Record<string, unknown> {
  const requestBody = operation.requestBody;
  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) return {};
  const body = requestBody as Record<string, unknown>;
  const schema = body.schema && typeof body.schema === "object" && !Array.isArray(body.schema)
    ? body.schema as Record<string, unknown>
    : body.content && typeof body.content === "object" && !Array.isArray(body.content)
      ? Object.values(body.content as Record<string, unknown>)[0] as Record<string, unknown>
      : body;
  return schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, unknown>
    : {};
}

function prepareRequestBody(
  body: Record<string, unknown>,
  operation: Record<string, unknown>,
): Record<string, unknown> {
  const prepared = { ...body };
  const properties = requestProperties(operation);
  if (
    "content" in properties &&
    !("prompt" in properties) &&
    !("content" in prepared) &&
    typeof prepared.prompt === "string" &&
    prepared.prompt.trim()
  ) {
    prepared.content = [{ type: "text", text: prepared.prompt }];
    delete prepared.prompt;
  }
  if (
    "aspect_ratio" in properties &&
    !("ratio" in properties) &&
    !("aspect_ratio" in prepared) &&
    typeof prepared.ratio === "string"
  ) {
    prepared.aspect_ratio = prepared.ratio;
    delete prepared.ratio;
  }
  return prepared;
}

function requireProtocol(ctx: ForwardContext): void {
  if (!ctx.protocol) throw new Error("MemeFast protocol binding is required");
}

function pickId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  for (const key of ["id", "task_id", "taskId"]) {
    if (typeof object[key] === "string" && object[key]) return object[key];
  }
  for (const key of ["data", "task", "result"]) {
    const id = pickId(object[key]);
    if (id) return id;
  }
  return undefined;
}

function pickVideoResult(value: unknown): VideoResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  for (const key of ["video_url", "videoUrl", "url", "download_url", "downloadUrl"]) {
    if (typeof object[key] === "string" && object[key]) return { video_url: object[key] };
  }
  for (const key of ["data", "task", "result", "content", "output"]) {
    const result = pickVideoResult(object[key]);
    if (result) return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = pickVideoResult(item);
      if (result) return result;
    }
  }
  return undefined;
}

function pickStatus(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  for (const key of ["status", "state"]) {
    if (typeof object[key] === "string") return object[key];
  }
  for (const key of ["data", "task", "result"]) {
    const status = pickStatus(object[key]);
    if (status) return status;
  }
  return undefined;
}

export const memefastAdapter: Adapter = {
  id: "memefast",
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

  async forwardChat(req: ChatRequest, ctx: ForwardContext): Promise<ChatResponse> {
    return openaiAdapter.forwardChat(req, ctx);
  },

  async forwardChatStream(req: ChatRequest, ctx: ForwardContext): Promise<Response> {
    return openaiAdapter.forwardChatStream(req, ctx);
  },

  async forwardEmbedding(req: EmbeddingRequest, ctx: ForwardContext): Promise<EmbeddingResponse> {
    return openaiAdapter.forwardEmbedding!(req, ctx);
  },

  async forwardImageGeneration(req: ImageGenerationRequest, ctx: ForwardContext): Promise<ImageResponse> {
    return openaiAdapter.forwardImageGeneration!(req, ctx);
  },

  async forwardImageEdit(req: ImageEditRequest, ctx: ForwardContext): Promise<ImageResponse> {
    return openaiAdapter.forwardImageEdit!(req, ctx);
  },

  async forwardImageVariation(req: ImageVariationRequest, ctx: ForwardContext): Promise<ImageResponse> {
    return openaiAdapter.forwardImageVariation!(req, ctx);
  },

  async forwardAudioSpeech(req: AudioSpeechRequest, ctx: ForwardContext): Promise<ArrayBuffer> {
    return openaiAdapter.forwardAudioSpeech!(req, ctx);
  },

  async forwardAudioTranscription(
    req: AudioTranscriptionRequest,
    ctx: ForwardContext,
  ): Promise<AudioTranscriptionResponse> {
    return openaiAdapter.forwardAudioTranscription!(req, ctx);
  },

  async healthCheck(ctx: ForwardContext): Promise<boolean> {
    try {
      const response = await fetch(`${baseUrl(ctx.targetUrl)}/v1/models`, {
        headers: { Authorization: `Bearer ${ctx.apiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  async submitVideoTask(req: VideoSubmitRequest, ctx: ForwardContext): Promise<VideoSubmitResult> {
    requireProtocol(ctx);
    const operation = findExplicitOperation(ctx, "video.submit", "POST");
    const data = await postJson<unknown>(ctx, operation, req, "video.submit");
    const siteTaskId = pickId(data);
    if (!siteTaskId) throw new Error("MemeFast video.submit response missing task id");
    return {
      siteTaskId,
      initialStatus: mapGenericVideoStatus(pickStatus(data) ?? "queued"),
      rawResult: data,
    };
  },

  async queryVideoTask(siteTaskId: string, ctx: ForwardContext): Promise<VideoQueryResult> {
    requireProtocol(ctx);
    const submitOperation = ctx.protocol?.operations.find((candidate) =>
      String(candidate.method ?? "").toUpperCase() === "POST" &&
      (candidate.operationRole === "video.submit" || candidate.operationId === "video.submit"),
    );
    const operation = findExplicitOperation(
      ctx,
      "video.query",
      "GET",
      typeof submitOperation?.path === "string" ? submitOperation.path : undefined,
    );
    const data = await getJson<unknown>(ctx, operation, siteTaskId, "video.query");
    return {
      status: mapGenericVideoStatus(pickStatus(data) ?? "processing"),
      result: pickVideoResult(data),
      raw: data,
    };
  },

  mapVideoStatus(status: unknown): VideoTaskStatus {
    return mapGenericVideoStatus(status);
  },

  transformVideoResult(raw: unknown): VideoResult {
    return pickVideoResult(raw) ?? { video_url: "" };
  },
};
