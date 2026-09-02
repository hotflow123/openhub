import type { AdapterContext } from "./common";

export interface EmbeddingRequest {
  model: string;
  input: string | string[];
  encoding_format?: "float" | "base64";
  user?: string;
  provider_options?: Record<string, unknown>;
}

export interface EmbeddingData {
  object: string;
  embedding: number[] | string;
  index: number;
}

export interface EmbeddingResponse {
  object: string;
  data: EmbeddingData[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

export interface EmbeddingAdapter {
  create(input: EmbeddingRequest, context: AdapterContext): Promise<EmbeddingResponse>;
}
