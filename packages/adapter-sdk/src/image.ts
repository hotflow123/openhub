import type { AdapterContext } from "./common";

export type ImageInput = Blob | string;

export interface ImageGenerationRequest {
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  quality?: "standard" | "hd" | string;
  style?: "vivid" | "natural" | string;
  response_format?: "url" | "b64_json";
  user?: string;
  provider_options?: Record<string, unknown>;
}

export interface ImageEditRequest {
  model: string;
  prompt: string;
  image: ImageInput;
  mask?: ImageInput;
  n?: number;
  size?: string;
  response_format?: "url" | "b64_json";
  user?: string;
  provider_options?: Record<string, unknown>;
}

export interface ImageVariationRequest {
  model: string;
  image: ImageInput;
  n?: number;
  size?: string;
  response_format?: "url" | "b64_json";
  user?: string;
  provider_options?: Record<string, unknown>;
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

export interface ImageAdapter {
  generate?(input: ImageGenerationRequest, context: AdapterContext): Promise<ImageResponse>;
  edit?(input: ImageEditRequest, context: AdapterContext): Promise<ImageResponse>;
  variation?(input: ImageVariationRequest, context: AdapterContext): Promise<ImageResponse>;
}
