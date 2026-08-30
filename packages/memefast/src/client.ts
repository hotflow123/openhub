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
  type ModelProfile,
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
  if (options.memefast !== undefined && !asObject(options.memefast)) {
    throw new MemeFastError({ ...errorInfo("invalid_parameter", operation, "provider_options.memefast must be an object") });
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
  };
}

export type { MemeFastCatalogEntry };
