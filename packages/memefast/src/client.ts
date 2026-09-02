import { catalogFromEntries, mergeContract, normalizeModelId } from "./catalog.js";
import { endpointUrl, errorInfo, normalizeBaseUrl, readResponseBody, request, requestIdFrom } from "./transport.js";
import {
  MemeFastError,
  type AudioSpeechRequest,
  type AudioTranscriptionRequest,
  type AudioTranscriptionResponse,
  type ChatRequest,
  type ChatResponse,
  type DiscoveredModel,
  type EmbeddingRequest,
  type EmbeddingResponse,
  type ImageGenerationRequest,
  type ImageResponse,
  type InputContract,
  type MemeFastCatalog,
  type MemeFastCatalogEntry,
  type MemeFastConfig,
  type MemeFastConnector,
  type MemeFastVideoProtocol,
  type ModelProfile,
  type VideoQueryResult,
  type VideoResult,
  type VideoSubmitRequest,
  type VideoSubmitResult,
} from "./types.js";

const OPERATION_FIELDS: Record<string, string[]> = {
  chat: ["model", "messages", "stream", "temperature", "top_p", "max_tokens", "max_completion_tokens", "stop", "presence_penalty", "frequency_penalty", "tools", "tool_choice", "response_format", "user", "seed", "reasoning_effort", "provider_options"],
  embedding: ["model", "input", "encoding_format", "dimensions", "user", "provider_options"],
  image: ["model", "prompt", "n", "size", "quality", "style", "response_format", "user", "provider_options"],
  speech: ["model", "input", "voice", "response_format", "speed", "provider_options"],
  transcription: ["model", "file", "language", "prompt", "response_format", "temperature", "provider_options"],
};

const DEFAULT_CONTRACT: InputContract = {
  fields: [],
  requiredFields: [],
  enums: {},
  defaults: {},
};

const VIDEO_PROTOCOLS: Record<MemeFastVideoProtocol, {
  submitPath: string;
  queryPath: string;
  queryMethod: "GET" | "POST";
}> = {
  veo: { submitPath: "/v1/video/create", queryPath: "/v1/video/query", queryMethod: "POST" },
  openai: { submitPath: "/v1/videos", queryPath: "/v1/videos/{id}", queryMethod: "GET" },
  seedance: { submitPath: "/api/v3/contents/generations/tasks", queryPath: "/api/v3/contents/generations/tasks/{id}", queryMethod: "GET" },
  kling: { submitPath: "/kling/v1/videos/text2video", queryPath: "/kling/v1/videos/text2video/{id}", queryMethod: "GET" },
  vidu: { submitPath: "/ent/v2/text2video", queryPath: "/ent/v2/tasks/{id}", queryMethod: "GET" },
  pixverse: { submitPath: "/openapi/v2/video/generate", queryPath: "/openapi/v2/video/{id}", queryMethod: "GET" },
  minimax: { submitPath: "/minimax/v1/video_generation", queryPath: "/minimax/v1/query/video_generation", queryMethod: "GET" },
  luma: { submitPath: "/luma/generations", queryPath: "/luma/generations/{id}", queryMethod: "GET" },
};

function videoRoot(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

function videoProtocol(config: MemeFastConfig["video"]): MemeFastVideoProtocol {
  const explicit = config?.protocol;
  if (explicit !== undefined) {
    if (typeof explicit === "string" && explicit in VIDEO_PROTOCOLS) return explicit as MemeFastVideoProtocol;
    throw new MemeFastError({ ...errorInfo("video_protocol_unverified", "video.protocol", `Unsupported MemeFast video protocol: ${String(explicit)}`) });
  }
  throw new MemeFastError({
    ...errorInfo("video_protocol_unverified", "video.protocol", "An explicit verified video protocol is required"),
  });
}

function videoRequestBody(requestBody: VideoSubmitRequest, protocol: MemeFastVideoProtocol): Record<string, unknown> {
  const providerOptions = asObject(requestBody.provider_options);
  const memefastOptions = asObject(providerOptions?.memefast);
  const providerParameters = asObject(memefastOptions?.parameters) ?? {};
  const { provider_options: _providerOptions, callback_url: _callbackUrl, idempotency_key: _idempotencyKey, ...body } = requestBody;
  const withProviderParameters = { ...body, ...providerParameters };
  if (protocol === "seedance") {
    const { prompt, content, aspect_ratio, resolution, duration, ...rest } = withProviderParameters;
    return {
      ...rest,
      content: content ?? (prompt ? [{ type: "text", text: prompt }] : undefined),
      parameters: {
        ...(typeof duration === "undefined" ? {} : { duration }),
        ...(typeof aspect_ratio === "undefined" ? {} : { aspect_ratio }),
        ...(typeof resolution === "undefined" ? {} : { resolution }),
      },
    };
  }
  if (protocol === "kling") {
    const { model, ...rest } = withProviderParameters;
    return { ...rest, model_name: model };
  }
  if (protocol === "vidu" && Array.isArray(withProviderParameters.content) && withProviderParameters.content.some((part) => part?.type === "image")) {
    const { content, ...rest } = withProviderParameters;
    return {
      ...rest,
      images: content.filter((part) => part.type === "image").map((part) => part.url).filter((url): url is string => typeof url === "string"),
    };
  }
  return withProviderParameters;
}

function nestedValue(value: unknown, keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function firstString(value: unknown, paths: string[][]): string | undefined {
  for (const path of paths) {
    const candidate = nestedValue(value, path);
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
}

function nestedString(value: unknown, keys: Set<string>, depth = 0): string | undefined {
  if (depth > 6 || !value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = nestedString(item, keys, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const object = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(object)) {
    if (keys.has(key) && typeof item === "string" && item.trim()) return item;
  }
  for (const item of Object.values(object)) {
    const found = nestedString(item, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function firstTaskId(value: unknown): string | undefined {
  return firstString(value, [
    ["id"], ["task_id"], ["request_id"], ["data", "id"], ["data", "task_id"],
    ["data", "task", "id"], ["output", "task_id"], ["task", "id"],
  ]);
}

function mapVideoStatus(value: unknown): VideoQueryResult["status"] {
  const status = typeof value === "string" ? value.toLowerCase() : "processing";
  if (["queued", "pending", "submitted", "waiting"].includes(status)) return "pending";
  if (["running", "processing", "in_progress", "started", "active"].includes(status)) return "processing";
  if (["succeeded", "success", "completed", "done", "finished"].includes(status)) return "completed";
  if (["failed", "failure", "error", "cancelled", "canceled"].includes(status)) return "failed";
  if (["timeout", "expired"].includes(status)) return "timeout";
  return "processing";
}

function videoResult(value: unknown): VideoResult | undefined {
  const videoUrl = firstString(value, [
    ["video_url"], ["videoUrl"], ["url"], ["video", "url"], ["result", "video_url"],
    ["result", "url"], ["data", "video_url"], ["data", "url"], ["data", "result", "url"],
    ["output", "video_url"], ["output", "url"], ["content", "url"], ["task", "content", "url"],
  ]) ?? nestedString(value, new Set(["video_url", "videoUrl", "url"]));
  if (!videoUrl) return undefined;
  return {
    video_url: videoUrl,
    ...(typeof nestedValue(value, ["duration"]) === "number" ? { duration: nestedValue(value, ["duration"]) as number } : {}),
    ...(typeof nestedValue(value, ["resolution"]) === "string" ? { resolution: nestedValue(value, ["resolution"]) as string } : {}),
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function mergeCatalog(catalog: MemeFastConfig["catalog"]): MemeFastCatalog | undefined {
  if (!catalog) return undefined;
  if (Array.isArray(catalog)) return catalogFromEntries(catalog as readonly MemeFastCatalogEntry[]);
  return catalog as MemeFastCatalog;
}

function runtimeProfile(model: DiscoveredModel): ModelProfile {
  const raw = asObject(model.raw);
  const parameters = Array.isArray(raw?.parameters)
    ? raw.parameters.map(asObject).filter((value): value is Record<string, unknown> => value !== null)
    : [];
  const enums: Record<string, string[]> = {};
  for (const parameter of parameters) {
    if (typeof parameter.name !== "string" || !Array.isArray(parameter.enum)) continue;
    const values = parameter.enum.filter((value): value is string => typeof value === "string");
    if (values.length > 0) enums[parameter.name] = values;
  }
  const modality = raw?.modality;
  const capabilities = Array.isArray(raw?.capabilities)
    ? raw.capabilities.filter((value): value is string => typeof value === "string")
    : [];
  return {
    id: model.id,
    modality: modality === "llm" || modality === "image" || modality === "audio" || modality === "video" || modality === "embedding"
      ? modality
      : "unknown",
    capabilities,
    contract: {
      fields: parameters.flatMap((parameter) => typeof parameter.name === "string" ? [parameter.name] : []),
      requiredFields: parameters.flatMap((parameter) => parameter.required === true && typeof parameter.name === "string" ? [parameter.name] : []),
      enums,
    },
    evidence: [{ source: "runtime", confidence: "high", detail: "MemeFast /v1/models" }],
    readiness: "ready",
  };
}

function responseObject(value: unknown, operation: string, response: Response): Record<string, unknown> {
  const object = asObject(value);
  if (!object) {
    throw new MemeFastError({
      ...errorInfo("invalid_response", operation, "MemeFast returned a non-object response", {
        status: response.status,
        requestId: requestIdFrom(response),
      }),
    });
  }
  return object;
}

function validateProviderOptions(value: unknown, operation: string): void {
  const options = asObject(value);
  if (!options) {
    throw new MemeFastError({ ...errorInfo("invalid_parameter", operation, "provider_options must be an object") });
  }
  for (const key of Object.keys(options)) {
    if (key !== "memefast") {
      throw new MemeFastError({ ...errorInfo("unknown_parameter", operation, `Unsupported provider_options namespace: ${key}`) });
    }
  }
  if (options.memefast !== undefined && !asObject(options.memefast)) {
    throw new MemeFastError({ ...errorInfo("invalid_parameter", operation, "provider_options.memefast must be an object") });
  }
  const memefast = asObject(options.memefast);
  if (memefast?.parameters !== undefined && !asObject(memefast.parameters)) {
    throw new MemeFastError({ ...errorInfo("invalid_parameter", operation, "provider_options.memefast.parameters must be an object") });
  }
  if (JSON.stringify(value).length > 32_000) {
    throw new MemeFastError({ ...errorInfo("invalid_parameter", operation, "provider_options is too large") });
  }
}

export function createMemeFastConnector(config: MemeFastConfig): MemeFastConnector {
  if (!config.apiKey?.trim()) {
    throw new MemeFastError({ ...errorInfo("invalid_config", "config", "apiKey is required") });
  }
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const timeoutMs = config.timeoutMs ?? 15000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) {
    throw new MemeFastError({ ...errorInfo("invalid_config", "config", "timeoutMs must be at least 1000 milliseconds") });
  }
  const mode = config.mode ?? "strict";
  const catalog = mergeCatalog(config.catalog);
  let discovered: DiscoveredModel[] = [];

  async function discover(): Promise<DiscoveredModel[]> {
    const response = await request(endpointUrl(baseUrl, "/models"), config.apiKey, "models.list", {
      headers: { Accept: "application/json" },
    }, timeoutMs);
    const value = await readResponseBody(response);
    const object = asObject(value);
    if (!object || !Array.isArray(object.data)) {
      throw new MemeFastError({ ...errorInfo("invalid_response", "models.list", "MemeFast /v1/models response must contain data[]", { requestId: requestIdFrom(response) }) });
    }
    const rows = object.data.map((item): DiscoveredModel | null => {
      const row = asObject(item);
      if (!row || typeof row.id !== "string" || !row.id.trim()) return null;
      return {
        id: row.id,
        object: typeof row.object === "string" ? row.object : "model",
        raw: item,
        ...(typeof row.created === "number" ? { created: row.created } : {}),
        ...(typeof row.owned_by === "string" ? { ownedBy: row.owned_by } : {}),
      };
    }).filter((item): item is DiscoveredModel => item !== null);
    if (rows.length !== object.data.length) {
      throw new MemeFastError({ ...errorInfo("invalid_response", "models.list", "MemeFast /v1/models contains an invalid model entry", { requestId: requestIdFrom(response) }) });
    }
    discovered = rows;
    return rows;
  }

  async function findModel(modelId: string): Promise<DiscoveredModel> {
    let model = discovered.find((item) => item.id === modelId);
    if (!model) {
      await discover();
      model = discovered.find((item) => item.id === modelId);
    }
    if (model) return model;
    const normalized = normalizeModelId(modelId);
    const matches = discovered.filter((item) => normalizeModelId(item.id) === normalized);
    if (matches.length > 1) {
      throw new MemeFastError({ ...errorInfo("ambiguous_model", "model.lookup", `Model name is ambiguous: ${modelId}`) });
    }
    if (matches[0]) return matches[0];
    throw new MemeFastError({ ...errorInfo("model_not_found", "model.lookup", `Model not found: ${modelId}`) });
  }

  async function profile(modelId: string): Promise<ModelProfile> {
    const model = await findModel(modelId);
    const base = runtimeProfile(model);
    const catalogEntry = await catalog?.find(model.id);
    if (!catalogEntry) return base;
    return {
      ...base,
      catalogId: catalogEntry.id,
      suggestedContract: catalogEntry.contract
        ? mergeContract(DEFAULT_CONTRACT, catalogEntry.contract)
        : undefined,
      evidence: [...base.evidence, { source: "catalog", confidence: "medium", detail: catalogEntry.id }],
      readiness: base.modality === "unknown" ? "needs_review" : base.readiness,
    };
  }

  async function validate(requestBody: Record<string, unknown>, operation: string): Promise<Record<string, unknown>> {
    const modelId = requestBody.model;
    if (typeof modelId !== "string" || !modelId.trim()) {
      throw new MemeFastError({ ...errorInfo("missing_parameter", operation, "model is required") });
    }
    const resolved = await profile(modelId);
    const operationName = operation === "chat.stream"
      ? "chat"
      : operation === "image.generation"
        ? "image"
        : operation === "audio.speech"
          ? "speech"
          : operation === "audio.transcription"
            ? "transcription"
            : operation;
    const fields = new Set([...OPERATION_FIELDS[operation] ?? OPERATION_FIELDS[operationName] ?? [], ...resolved.contract.fields]);
    for (const [key, value] of Object.entries(requestBody)) {
      if (value === undefined) continue;
      if (!fields.has(key)) {
        throw new MemeFastError({ ...errorInfo("unknown_parameter", operation, `Unknown parameter: ${key}`, { details: { field: key, model: resolved.id } }) });
      }
    }
    for (const required of resolved.contract.requiredFields) {
      if (requestBody[required] == null || requestBody[required] === "") {
        throw new MemeFastError({ ...errorInfo("missing_parameter", operation, `Missing required model parameter: ${required}`, { details: { field: required, evidence: resolved.evidence } }) });
      }
    }
    for (const [field, allowed] of Object.entries(resolved.contract.enums)) {
      const value = requestBody[field];
      if (value !== undefined && !Array.isArray(value) && !allowed.includes(String(value))) {
        throw new MemeFastError({ ...errorInfo("invalid_parameter", operation, `Invalid ${field}: expected one of ${allowed.join(", ")}`, { details: { field, allowed, evidence: resolved.evidence } }) });
      }
    }
    const body: Record<string, unknown> = { ...requestBody, model: resolved.id };
    if (mode === "assist") {
      for (const [field, value] of Object.entries(resolved.contract.defaults ?? {})) {
        if (body[field] === undefined) body[field] = value;
      }
    }
    if (body.provider_options !== undefined) validateProviderOptions(body.provider_options, operation);
    return body;
  }

  async function jsonOperation<T extends Record<string, unknown>>(
    operation: string,
    path: string,
    body: Record<string, unknown>,
    validateData: (value: Record<string, unknown>) => boolean,
  ): Promise<T> {
    const checked = await validate(body, operation);
    const response = await request(endpointUrl(baseUrl, path), config.apiKey, operation, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(checked),
    }, timeoutMs);
    const object = responseObject(await readResponseBody(response), operation, response);
    if (!validateData(object)) {
      throw new MemeFastError({ ...errorInfo("invalid_response", operation, `MemeFast ${operation} response is missing required data`, { requestId: requestIdFrom(response) }) });
    }
    return object as T;
  }

  return {
    async verify() {
      try {
        const rows = await discover();
        return { ok: true, modelCount: rows.length };
      } catch (error) {
        const info = error instanceof MemeFastError
          ? error.info
          : errorInfo("network_error", "verify", error instanceof Error ? error.message : "Verification failed");
        return { ok: false, error: info };
      }
    },
    discover,
    profile,
    async chat(requestBody) {
      const result = await jsonOperation<ChatResponse>("chat", "/chat/completions", { ...requestBody, stream: false }, (value) => Array.isArray(value.choices));
      return result;
    },
    async chatStream(requestBody) {
      const checked = await validate({ ...requestBody, stream: true }, "chat.stream");
      return request(endpointUrl(baseUrl, "/chat/completions"), config.apiKey, "chat.stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(checked),
      }, timeoutMs);
    },
    async embedding(requestBody) {
      return jsonOperation<EmbeddingResponse>("embedding", "/embeddings", requestBody, (value) => Array.isArray(value.data));
    },
    async imageGeneration(requestBody) {
      return jsonOperation<ImageResponse>("image.generation", "/images/generations", requestBody, (value) => Array.isArray(value.data));
    },
    async audioSpeech(requestBody) {
      const checked = await validate(requestBody, "audio.speech");
      const response = await request(endpointUrl(baseUrl, "/audio/speech"), config.apiKey, "audio.speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checked),
      }, timeoutMs);
      return response.arrayBuffer();
    },
    async audioTranscription(requestBody) {
      const checked = await validate(requestBody as Record<string, unknown>, "audio.transcription");
      const form = new FormData();
      for (const [key, value] of Object.entries(checked)) {
        if (value == null) continue;
        if (value instanceof Blob) form.append(key, value, key);
        else if (Array.isArray(value)) for (const item of value) form.append(key, String(item));
        else form.append(key, String(value));
      }
      const response = await request(endpointUrl(baseUrl, "/audio/transcriptions"), config.apiKey, "audio.transcription", {
        method: "POST",
        headers: { Accept: "application/json" },
        body: form,
      }, timeoutMs);
      const object = responseObject(await readResponseBody(response), "audio.transcription", response);
      if (typeof object.text !== "string") {
        throw new MemeFastError({ ...errorInfo("invalid_response", "audio.transcription", "MemeFast transcription response is missing text", { requestId: requestIdFrom(response) }) });
      }
      return object as AudioTranscriptionResponse;
    },
    async videoSubmit(requestBody) {
      const modelId = typeof requestBody.model === "string" ? requestBody.model : "";
      if (!modelId.trim()) {
        throw new MemeFastError({ ...errorInfo("missing_parameter", "video.submit", "model is required") });
      }
      const providerOptions = asObject(requestBody.provider_options);
      const memefastOptions = asObject(providerOptions?.memefast);
      if (memefastOptions?.video_protocol !== undefined) {
        throw new MemeFastError({ ...errorInfo("video_protocol_unverified", "video.protocol", "Video protocol must be configured on the verified variant") });
      }
      const protocol = videoProtocol(config.video);
      const definition = VIDEO_PROTOCOLS[protocol];
      const response = await request(`${videoRoot(baseUrl)}${definition.submitPath}`, config.apiKey, "video.submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(videoRequestBody(requestBody, protocol)),
      }, timeoutMs);
      const object = responseObject(await readResponseBody(response), "video.submit", response);
      const taskId = firstTaskId(object);
      if (!taskId) {
        throw new MemeFastError({ ...errorInfo("invalid_response", "video.submit", "MemeFast video response is missing a task id", { requestId: requestIdFrom(response) }) });
      }
      const initialStatus = mapVideoStatus(firstString(object, [["status"], ["data", "status"], ["output", "task_status"]]));
      return {
        siteTaskId: taskId,
        initialStatus: initialStatus === "completed" || initialStatus === "failed" || initialStatus === "timeout" ? "processing" : initialStatus,
        rawResult: object,
      } satisfies VideoSubmitResult;
    },
    async videoQuery(siteTaskId, modelId) {
      if (!modelId?.trim()) {
        throw new MemeFastError({ ...errorInfo("missing_parameter", "video.query", "model is required to resolve the MemeFast video protocol") });
      }
      const protocol = videoProtocol(config.video);
      const definition = VIDEO_PROTOCOLS[protocol];
      const path = definition.queryPath.replace("{id}", encodeURIComponent(siteTaskId));
      const url = `${videoRoot(baseUrl)}${path}${protocol === "minimax" ? `${path.includes("?") ? "&" : "?"}task_id=${encodeURIComponent(siteTaskId)}` : ""}`;
      const response = await request(url, config.apiKey, "video.query", {
        method: definition.queryMethod,
        headers: { Accept: "application/json", ...(definition.queryMethod === "POST" ? { "Content-Type": "application/json" } : {}) },
        ...(definition.queryMethod === "POST" ? { body: JSON.stringify({ task_id: siteTaskId, id: siteTaskId }) } : {}),
      }, timeoutMs);
      const object = responseObject(await readResponseBody(response), "video.query", response);
      const status = mapVideoStatus(firstString(object, [["status"], ["task_status"], ["data", "status"], ["data", "task_status"], ["output", "task_status"], ["task", "status"]]) ?? nestedString(object, new Set(["status", "task_status"])));
      const result = videoResult(object);
      const error = firstString(object, [["error", "message"], ["message"], ["data", "message"], ["output", "message"]]);
      return { status, ...(result ? { result } : {}), ...(error && status === "failed" ? { error } : {}), raw: object };
    },
  };
}

export type { MemeFastCatalogEntry };
