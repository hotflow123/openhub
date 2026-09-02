import type { AdapterContext } from "./common";

export interface AudioSpeechRequest {
  model: string;
  input: string;
  voice: string;
  response_format?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
  speed?: number;
  provider_options?: Record<string, unknown>;
}

export interface AudioTranscriptionRequest {
  model: string;
  file: Blob | string;
  language?: string;
  prompt?: string;
  response_format?: "json" | "text" | "srt" | "verbose_json" | "vtt";
  temperature?: number;
  provider_options?: Record<string, unknown>;
}

export interface AudioTranscriptionResponse {
  text: string;
  [key: string]: unknown;
}

export interface AudioAdapter {
  speech?(input: AudioSpeechRequest, context: AdapterContext): Promise<ArrayBuffer>;
  transcribe?(input: AudioTranscriptionRequest, context: AdapterContext): Promise<AudioTranscriptionResponse>;
}
