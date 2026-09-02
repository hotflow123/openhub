import type { AdapterContext, ArtifactRef, UsageFacts } from "./common";

export type VideoTaskStatus = "pending" | "processing" | "completed" | "failed" | "timeout";

export interface VideoContentPart {
  type: "text" | "image" | "video" | "audio";
  text?: string;
  url?: string;
  role?: string;
}

export interface VideoResult {
  video_url: string;
  cover_url?: string;
  duration?: number;
  width?: number;
  height?: number;
  ratio?: string;
  resolution?: string;
  usage?: Record<string, number>;
  task_type?: string;
  modality?: string;
  provider_metadata?: Record<string, unknown>;
  seed?: number;
  [key: string]: unknown;
}

export interface VideoSubmitRequest {
  model?: string;
  prompt?: string;
  content?: VideoContentPart[];
  duration?: number | string;
  aspect_ratio?: string;
  resolution?: string;
  callback_url?: string;
  idempotency_key?: string;
  provider_options?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface VideoSubmitResult {
  siteTaskId: string;
  initialStatus: VideoTaskStatus;
  rawResult?: unknown;
}

export interface VideoQueryResult {
  status: VideoTaskStatus;
  result?: VideoResult;
  error?: string;
  raw?: unknown;
}

export interface VideoAdapter {
  submit(input: VideoSubmitRequest, context: AdapterContext): Promise<VideoSubmitResult>;
  query(siteTaskId: string, context: AdapterContext): Promise<VideoQueryResult>;
  cancel?(siteTaskId: string, context: AdapterContext): Promise<void>;
  listArtifacts?(task: VideoQueryResult): ArtifactRef[];
  getArtifact?(artifact: ArtifactRef, context: AdapterContext): Promise<Response | ArrayBuffer>;
  extractUsage?(task: VideoQueryResult): UsageFacts | null;
}
