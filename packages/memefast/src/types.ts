export type MemeFastModality = "llm" | "image" | "audio" | "video" | "embedding" | "unknown";

export type MemeFastErrorCode =
  | "invalid_config"
  | "network_error"
  | "upstream_error"
  | "invalid_response"
  | "model_not_found"
  | "ambiguous_model"
  | "missing_parameter"
  | "invalid_parameter"
  | "unknown_parameter";

export interface MemeFastErrorInfo {
  code: MemeFastErrorCode;
  operation: string;
  message: string;
  status?: number;
  requestId?: string;
  details?: unknown;
}

export class MemeFastError extends Error {
  readonly info: MemeFastErrorInfo;

  constructor(info: MemeFastErrorInfo) {
    super(info.message);
    this.name = "MemeFastError";
    this.info = info;
  }
}

export interface MemeFastConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  mode?: "strict" | "assist";
  catalog?: MemeFastCatalog | readonly MemeFastCatalogEntry[];
}

export interface DiscoveredModel {
  id: string;
  object: "model" | string;
  created?: number;
  ownedBy?: string;
  raw: unknown;
}

export interface InputContract {
  fields: string[];
  requiredFields: string[];
  enums: Record<string, string[]>;
  defaults?: Record<string, unknown>;
}

export interface ContractEvidence {
  source: "runtime" | "catalog" | "default";
  confidence: "high" | "medium" | "low";
  detail: string;
}

export interface ModelProfile {
  id: string;
  modality: MemeFastModality;
  capabilities: string[];
  contract: InputContract;
  evidence: ContractEvidence[];
  catalogId?: string;
  suggestedContract?: InputContract;
  readiness: "ready" | "needs_review";
}

export interface MemeFastCatalogEntry {
  id: string;
  aliases?: string[];
  modality?: MemeFastModality;
  capabilities?: string[];
  contract?: Partial<InputContract>;
}

export interface MemeFastCatalog {
  find(modelId: string): Promise<MemeFastCatalogEntry | undefined> | MemeFastCatalogEntry | undefined;
}

export interface ChatMessage {
  role: string;
  content: unknown;
  name?: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  [key: string]: unknown;
}

export interface ChatResponse {
  choices: unknown[];
  [key: string]: unknown;
}

export interface EmbeddingRequest {
  model: string;
  input: string | string[];
  [key: string]: unknown;
}

export interface EmbeddingResponse {
  data: unknown[];
  [key: string]: unknown;
}

export interface ImageGenerationRequest {
  model: string;
  prompt: string;
  [key: string]: unknown;
}

export interface ImageResponse {
  data: unknown[];
  [key: string]: unknown;
}

export interface AudioSpeechRequest {
  model: string;
  input: string;
  voice: string;
  [key: string]: unknown;
}

export interface AudioTranscriptionRequest {
  model: string;
  file: Blob | string;
  [key: string]: unknown;
}

export interface AudioTranscriptionResponse {
  text: string;
  [key: string]: unknown;
}

export interface MemeFastConnector {
  verify(): Promise<{ ok: true; modelCount: number } | { ok: false; error: MemeFastErrorInfo }>;
  discover(): Promise<DiscoveredModel[]>;
  profile(modelId: string): Promise<ModelProfile>;
  chat(request: ChatRequest): Promise<ChatResponse>;
  chatStream(request: ChatRequest): Promise<Response>;
  embedding(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  imageGeneration(request: ImageGenerationRequest): Promise<ImageResponse>;
  audioSpeech(request: AudioSpeechRequest): Promise<ArrayBuffer>;
  audioTranscription(request: AudioTranscriptionRequest): Promise<AudioTranscriptionResponse>;
}
