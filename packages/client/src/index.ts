import type {
  AudioSpeechRequest,
  AudioTranscriptionRequest,
  AudioTranscriptionResponse,
  ChatRequest,
  ChatResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ImageGenerationRequest,
  ImageResponse,
  VideoSubmitRequest,
} from "@openhub/adapter-sdk";

export type VideoTaskStatus = "pending" | "processing" | "completed" | "failed" | "timeout";

export interface VideoTask {
  id: string;
  status: VideoTaskStatus;
  result?: unknown;
  error?: string | null;
  [key: string]: unknown;
}

export interface WaitOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface OpenHubClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

export class OpenHubError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "OpenHubError";
  }
}

function ensureUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("OpenHub baseUrl must use http:// or https://");
  }
  return parsed.toString().replace(/\/$/, "");
}

function ensureKey(value: string): string {
  if (!value.trim()) throw new Error("OpenHub API key is required");
  return value;
}

function isTerminal(status: VideoTaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "timeout";
}

function appendFormValue(form: FormData, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (value instanceof Blob) form.append(key, value);
  else form.append(key, String(value));
}

export class OpenHubClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly requestFetch: typeof fetch;

  constructor(options: OpenHubClientOptions) {
    this.baseUrl = ensureUrl(options.baseUrl);
    this.apiKey = ensureKey(options.apiKey);
    this.requestFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async chat(input: ChatRequest): Promise<ChatResponse> {
    return await this.json<ChatResponse>("/v1/chat/completions", input);
  }

  async chatStream(input: ChatRequest): Promise<Response> {
    return await this.raw("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ ...input, stream: true }),
      headers: { "Content-Type": "application/json" },
    });
  }

  async embeddings(input: EmbeddingRequest): Promise<EmbeddingResponse> {
    return await this.json<EmbeddingResponse>("/v1/embeddings", input);
  }

  async generateImage(input: ImageGenerationRequest): Promise<ImageResponse> {
    return await this.json<ImageResponse>("/v1/images/generations", input);
  }

  async synthesizeSpeech(input: AudioSpeechRequest): Promise<ArrayBuffer> {
    const response = await this.raw("/v1/audio/speech", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
    });
    return await response.arrayBuffer();
  }

  async transcribeAudio(input: AudioTranscriptionRequest): Promise<AudioTranscriptionResponse> {
    const form = new FormData();
    appendFormValue(form, "model", input.model);
    appendFormValue(form, "file", input.file);
    appendFormValue(form, "language", input.language);
    appendFormValue(form, "prompt", input.prompt);
    appendFormValue(form, "response_format", input.response_format);
    appendFormValue(form, "temperature", input.temperature);
    return await this.json<AudioTranscriptionResponse>("/v1/audio/transcriptions", form);
  }

  async createVideo(input: VideoSubmitRequest): Promise<VideoTask> {
    return await this.json<VideoTask>("/v1/video/generations", input);
  }

  async getVideoTask(id: string): Promise<VideoTask> {
    if (!id.trim()) throw new Error("Video task ID is required");
    return await this.json<VideoTask>(`/v1/video/tasks/${encodeURIComponent(id)}`);
  }

  async waitForVideoTask(id: string, options: WaitOptions = {}): Promise<VideoTask> {
    const intervalMs = options.intervalMs ?? 1_000;
    const timeoutMs = options.timeoutMs ?? 300_000;
    if (!Number.isFinite(intervalMs) || intervalMs < 0) throw new Error("intervalMs must be non-negative");
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be positive");

    const startedAt = Date.now();
    while (true) {
      if (options.signal?.aborted) throw new OpenHubError("Request aborted", 499, "aborted");
      const task = await this.getVideoTask(id);
      if (isTerminal(task.status)) return task;
      const remaining = timeoutMs - (Date.now() - startedAt);
      if (remaining <= 0) throw new OpenHubError("Video task polling timed out", 408, "client_timeout");
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => options.signal?.removeEventListener("abort", abort);
        const timer = setTimeout(() => {
          cleanup();
          resolve();
        }, Math.min(intervalMs, remaining));
        const abort = () => {
          clearTimeout(timer);
          cleanup();
          reject(new OpenHubError("Request aborted", 499, "aborted"));
        };
        options.signal?.addEventListener("abort", abort, { once: true });
      });
    }
  }

  private async json<T>(path: string, body?: BodyInit | unknown): Promise<T> {
    const response = await this.raw(path, {
      method: body === undefined ? "GET" : "POST",
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
      headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    });
    return await response.json() as T;
  }

  private async raw(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.requestFetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      throw new OpenHubError(
        error instanceof Error ? error.message : String(error),
        0,
        "network_error",
      );
    }
    if (response.ok) return response;

    let payload: unknown;
    try {
      payload = await response.clone().json();
    } catch {
      payload = await response.text().catch(() => undefined);
    }
    const errorBody = payload && typeof payload === "object" && "error" in payload
      ? (payload as { error?: { message?: string; code?: string } }).error
      : undefined;
    throw new OpenHubError(
      errorBody?.message ?? `OpenHub request failed with HTTP ${response.status}`,
      response.status,
      errorBody?.code,
      payload,
    );
  }
}

export type {
  AudioSpeechRequest,
  AudioTranscriptionRequest,
  AudioTranscriptionResponse,
  ChatRequest,
  ChatResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ImageGenerationRequest,
  ImageResponse,
  VideoSubmitRequest,
};
