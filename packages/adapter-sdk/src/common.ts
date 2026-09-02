export type Modality = "llm" | "embedding" | "image" | "audio" | "video";

export type AdapterCapability =
  | "chat"
  | "chat.stream"
  | "embedding"
  | "image.generation"
  | "image.edit"
  | "image.variation"
  | "audio.speech"
  | "audio.transcription"
  | "video.submit"
  | "video.query"
  | "video.cancel";

export type TemplateOperation = Exclude<AdapterCapability, "video.cancel">;

export interface AdapterTemplateBinding {
  id: string;
  modality: Modality;
  operations: TemplateOperation[];
  mapperId: string;
  fields: Record<string, {
    target: string;
    required?: boolean;
    overridable?: boolean;
  }>;
  evidence: EvidenceRef[];
}

export type AdapterAuth = "api_key" | "oauth2_jwt" | "none";

export type ConfigFieldType = "string" | "number" | "integer" | "boolean" | "enum";

export interface ConfigField {
  type: ConfigFieldType;
  path?: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
  secret?: boolean;
}

export interface ConfigSchema {
  type: "object";
  properties: Record<string, ConfigField>;
}

export type EvidenceKind = "official-doc" | "fixture" | "runtime" | "admin-confirmed";

export interface EvidenceRef {
  kind: EvidenceKind;
  ref: string;
  verifiedAt: string;
}

export interface DiscoveredModel {
  id: string;
  name?: string;
  ownedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface AdapterContext {
  targetUrl: string;
  apiKey: string;
  config?: Record<string, unknown>;
  signal?: AbortSignal;
}

export type AdapterErrorCode =
  | "adapter_not_found"
  | "adapter_config_invalid"
  | "capability_unsupported"
  | "contract_unconfirmed"
  | "extension_required"
  | "model_parameter_invalid"
  | "upstream_error"
  | "upstream_timeout";

export interface AdapterErrorShape {
  code: AdapterErrorCode;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export type ArtifactType = "image" | "audio" | "video" | "file";

export interface ArtifactRef {
  key: string;
  type: ArtifactType;
  url?: string;
  expiresAt?: string;
}

export interface UsageFacts {
  [key: string]: string | number | boolean | null;
}
