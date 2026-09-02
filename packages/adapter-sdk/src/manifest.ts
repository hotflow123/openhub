import type {
  AdapterAuth,
  AdapterCapability,
  AdapterContext,
  AdapterTemplateBinding,
  ConfigSchema,
  DiscoveredModel,
  EvidenceRef,
  Modality,
} from "./common";
import type { AudioAdapter } from "./audio";
import type { EmbeddingAdapter } from "./embedding";
import type { ImageAdapter } from "./image";
import type { LlmAdapter } from "./llm";
import type { AsyncTaskAdapter, BatchTaskAdapter, DynamicTaskAdapter } from "./lifecycle";
import type { ModelBindingRule } from "./model-binding";
import type { VideoAdapter } from "./video";

export interface AdapterManifest {
  id: string;
  version: string;
  displayName: string;
  description?: { zh?: string; en?: string };
  modalities: Modality[];
  capabilities: AdapterCapability[];
  templateBindings?: AdapterTemplateBinding[];
  modelBindings: ModelBindingRule[];
  protocolBindings: Array<"openhub" | "openai-compatible">;
  taskStrategy?: { queryMode: "per_task" | "batch" | "dynamic" };
  usageSchema?: Record<string, { type: "number" | "string" | "boolean"; unit?: string }>;
  artifactTypes?: Array<"image" | "audio" | "video" | "file">;
  configSchema: ConfigSchema;
  auth: AdapterAuth;
  allowedHosts?: string[];
  evidence: EvidenceRef[];
}

export type AdapterHandler =
  | { modality: "llm"; handler: LlmAdapter }
  | { modality: "embedding"; handler: EmbeddingAdapter }
  | { modality: "image"; handler: ImageAdapter }
  | { modality: "audio"; handler: AudioAdapter }
  | { modality: "video"; handler: VideoAdapter }
  | { modality: "async-task"; handler: AsyncTaskAdapter | BatchTaskAdapter | DynamicTaskAdapter };

export interface AdapterBase {
  manifest: AdapterManifest;
  healthCheck(context: AdapterContext): Promise<boolean>;
  discoverModels?(context: AdapterContext): Promise<DiscoveredModel[]>;
  validateConfig?(config: Record<string, unknown> | undefined, modality: Modality): string | null;
}

export interface ProviderAdapter extends AdapterBase {
  handlers: readonly AdapterHandler[];
}
