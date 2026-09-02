import { z } from "zod";
import {
  validateProviderAdapter,
  type AdapterCapability,
  type AdapterManifest,
  type AdapterValidationIssue,
  type ProviderAdapter,
  type AdapterTemplateBinding,
} from "@openhub/adapter-sdk";

const evidenceSchema = z.object({
  kind: z.enum(["official-doc", "fixture", "runtime", "admin-confirmed"]),
  ref: z.string().trim().min(1),
  verifiedAt: z.string().trim().min(1),
}).strict();

const configFieldSchema = z.object({
  type: z.enum(["string", "number", "integer", "boolean", "enum"]),
  path: z.string().trim().min(1).optional(),
  required: z.boolean().optional(),
  enum: z.array(z.string()).min(1).optional(),
  default: z.unknown().optional(),
  secret: z.boolean().optional(),
}).strict();

const configSchema = z.object({
  type: z.literal("object"),
  properties: z.record(configFieldSchema),
}).strict();

const modelBindingSchema = z.object({
  match: z.enum(["exact", "normalized", "alias", "prefix"]),
  values: z.array(z.string().trim().min(1)).min(1),
  vendor: z.string().trim().min(1).optional(),
  evidence: z.array(evidenceSchema).min(1),
}).strict();

const templateFieldSchema = z.object({
  target: z.string().trim().min(1),
  required: z.boolean().optional(),
  overridable: z.boolean().optional(),
}).strict();

const templateBindingSchema = z.object({
  id: z.string().trim().min(1),
  modality: z.enum(["llm", "embedding", "image", "audio", "video"]),
  operations: z.array(z.enum([
    "chat",
    "embedding",
    "image.generation",
    "image.edit",
    "image.variation",
    "audio.speech",
    "audio.transcription",
    "video.submit",
    "video.query",
  ])).min(1),
  mapperId: z.string().trim().min(1),
  fields: z.record(templateFieldSchema),
  evidence: z.array(evidenceSchema).min(1),
}).strict();

export const adapterManifestSchema = z.object({
  id: z.string().trim().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  displayName: z.string().trim().min(1),
  description: z.object({ zh: z.string().optional(), en: z.string().optional() }).strict().optional(),
  modalities: z.array(z.enum(["llm", "embedding", "image", "audio", "video"])).min(1),
  capabilities: z.array(z.enum([
    "chat",
    "chat.stream",
    "embedding",
    "image.generation",
    "image.edit",
    "image.variation",
    "audio.speech",
    "audio.transcription",
    "video.submit",
    "video.query",
    "video.cancel",
  ])).min(1),
  templateBindings: z.array(templateBindingSchema).optional(),
  modelBindings: z.array(modelBindingSchema).min(1),
  protocolBindings: z.array(z.enum(["openhub", "openai-compatible"])).min(1),
  taskStrategy: z.object({ queryMode: z.enum(["per_task", "batch", "dynamic"]) }).strict().optional(),
  usageSchema: z.record(z.object({
    type: z.enum(["number", "string", "boolean"]),
    unit: z.string().optional(),
  }).strict()).optional(),
  artifactTypes: z.array(z.enum(["image", "audio", "video", "file"])).optional(),
  configSchema,
  auth: z.enum(["api_key", "oauth2_jwt", "none"]),
  allowedHosts: z.array(z.string().trim().min(1)).optional(),
  evidence: z.array(evidenceSchema).min(1),
}).strict().superRefine((manifest, context) => {
  if (new Set(manifest.modalities).size !== manifest.modalities.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["modalities"], message: "contains duplicates" });
  }
  if (new Set(manifest.capabilities).size !== manifest.capabilities.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["capabilities"], message: "contains duplicates" });
  }
  if (manifest.templateBindings) {
    if (new Set(manifest.templateBindings.map((binding) => binding.id)).size !== manifest.templateBindings.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["templateBindings"], message: "contains duplicate ids" });
    }
    for (const [index, binding] of manifest.templateBindings.entries()) {
      if (binding.modality === "video" && (!binding.operations.includes("video.submit") || !binding.operations.includes("video.query"))) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["templateBindings", index, "operations"], message: "video templates require submit and query" });
      }
      for (const operation of binding.operations) {
        if (!manifest.capabilities.includes(operation as AdapterCapability)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["templateBindings", index, "operations"], message: `operation ${operation} is not declared as an adapter capability` });
        }
      }
    }
  }
  if (new Set(manifest.protocolBindings).size !== manifest.protocolBindings.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["protocolBindings"], message: "contains duplicates" });
  }
  if (manifest.taskStrategy?.queryMode === "per_task" && !manifest.capabilities.includes("video.submit") && !manifest.capabilities.includes("video.query")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["taskStrategy"], message: "per_task requires an asynchronous capability" });
  }
});

export interface ManifestValidationResult {
  ok: boolean;
  manifest?: AdapterManifest;
  issues: AdapterValidationIssue[];
}

export function validateAdapterManifest(value: unknown): ManifestValidationResult {
  const result = adapterManifestSchema.safeParse(value);
  if (result.success) return { ok: true, manifest: result.data as AdapterManifest, issues: [] };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

export interface AdapterRegistrationOptions {
  sourcePath?: string;
}

export type AdapterRegistrationStatus = "ready" | "invalid" | "extension_required" | "quarantined";

export interface AdapterRegistration {
  adapter: ProviderAdapter;
  manifest: AdapterManifest;
  status: AdapterRegistrationStatus;
  issues: AdapterValidationIssue[];
  sourcePath?: string;
}

export interface AdapterModelBindingMatch {
  vendor?: string;
  reason: string;
}

const executableRegistry = new Map<string, AdapterRegistration>();
const registrationDiagnostics: AdapterRegistration[] = [];

export function clearProviderAdapterRegistry(): void {
  executableRegistry.clear();
  registrationDiagnostics.length = 0;
}

export function registerProviderAdapter(
  adapter: ProviderAdapter,
  options: AdapterRegistrationOptions = {},
): AdapterRegistration {
  const manifestResult = validateAdapterManifest(adapter.manifest);
  const conformance = validateProviderAdapter(adapter);
  const issues = [...manifestResult.issues, ...conformance.issues];
  let status: AdapterRegistrationStatus = conformance.status;

  if (executableRegistry.has(adapter.manifest.id)) {
    issues.push({ path: "manifest.id", message: "duplicates an already registered adapter" });
    status = "quarantined";
  } else if (issues.length > 0 && status === "ready") {
    status = "invalid";
  }

  const registration: AdapterRegistration = {
    adapter,
    manifest: adapter.manifest,
    status,
    issues,
    sourcePath: options.sourcePath,
  };
  registrationDiagnostics.push(registration);
  if (status === "ready" && manifestResult.ok) executableRegistry.set(adapter.manifest.id, registration);
  return registration;
}

export function getProviderAdapter(id: string): ProviderAdapter | undefined {
  return executableRegistry.get(id)?.adapter;
}

export function getProviderAdapterRegistration(id: string): AdapterRegistration | undefined {
  return executableRegistry.get(id);
}

export function listProviderAdapterRegistrations(): AdapterRegistration[] {
  return [...registrationDiagnostics];
}

export function listAdapterManifests(): AdapterManifest[] {
  return listProviderAdapterRegistrations().map((registration) => registration.manifest);
}

function normalizeBindingValue(value: string): string {
  return value.toLowerCase().trim().replace(/[\s_\-/]+/g, " ");
}

export function matchAdapterModelBinding(
  manifest: AdapterManifest,
  rawModelId: string,
): AdapterModelBindingMatch | null {
  const raw = rawModelId.trim();
  const normalized = normalizeBindingValue(raw);
  for (const binding of manifest.modelBindings) {
    const matched = binding.values.some((value) => {
      if (binding.match === "exact") return value.toLowerCase().trim() === raw.toLowerCase();
      if (binding.match === "prefix") return raw.toLowerCase().startsWith(value.toLowerCase().trim());
      return normalizeBindingValue(value) === normalized;
    });
    if (matched) {
      return {
        vendor: binding.vendor,
        reason: `adapter_manifest_${binding.match}_binding`,
      };
    }
  }
  return null;
}

export function publicAdapterRegistration(registration: AdapterRegistration) {
  return {
    id: registration.manifest.id,
    version: registration.manifest.version,
    displayName: registration.manifest.displayName,
    description: registration.manifest.description ?? null,
    modalities: registration.manifest.modalities,
    capabilities: registration.manifest.capabilities,
    templateBindings: registration.manifest.templateBindings ?? [],
    modelBindings: registration.manifest.modelBindings,
    protocolBindings: registration.manifest.protocolBindings,
    taskStrategy: registration.manifest.taskStrategy ?? null,
    usageSchema: registration.manifest.usageSchema ?? null,
    artifactTypes: registration.manifest.artifactTypes ?? [],
    configSchema: registration.manifest.configSchema,
    auth: registration.manifest.auth,
    allowedHosts: registration.manifest.allowedHosts ?? [],
    evidence: registration.manifest.evidence,
    status: registration.status,
    issues: registration.issues,
    sourcePath: registration.sourcePath ?? null,
  };
}

function evidence(ref: string) {
  return [{ kind: "runtime" as const, ref, verifiedAt: "2026-08-30" }];
}

function binding(match: "exact" | "prefix", values: string[], ref: string) {
  return { match, values, evidence: evidence(ref) };
}

function template(
  id: string,
  modality: AdapterTemplateBinding["modality"],
  operations: AdapterTemplateBinding["operations"],
  ref: string,
): AdapterTemplateBinding {
  const allFields: AdapterTemplateBinding["fields"] = {
    prompt: { target: "prompt", overridable: true },
    content: { target: "content", overridable: true },
    duration: { target: "duration", overridable: true },
    aspect_ratio: { target: "aspect_ratio", overridable: true },
    resolution: { target: "resolution", overridable: true },
    size: { target: "size", overridable: true },
    quality: { target: "quality", overridable: true },
    image_url: { target: "image_url", overridable: true },
    image_urls: { target: "image_urls", overridable: true },
    video_url: { target: "video_url", overridable: true },
    video_urls: { target: "video_urls", overridable: true },
    audio_url: { target: "audio_url", overridable: true },
    audio_urls: { target: "audio_urls", overridable: true },
    reference_image_url: { target: "reference_image_url", overridable: true },
    reference_image_urls: { target: "reference_image_urls", overridable: true },
    reference_video_url: { target: "reference_video_url", overridable: true },
    reference_video_urls: { target: "reference_video_urls", overridable: true },
    reference_audio_url: { target: "reference_audio_url", overridable: true },
    reference_audio_urls: { target: "reference_audio_urls", overridable: true },
    generate_audio: { target: "generate_audio", overridable: true },
    input: { target: "input", overridable: true },
    voice: { target: "voice", overridable: true },
    file: { target: "file", overridable: true },
    seed: { target: "seed", overridable: true },
  };
  const allowed = modality === "video"
    ? ["prompt", "content", "duration", "aspect_ratio", "resolution", "image_url", "image_urls", "video_url", "video_urls", "audio_url", "audio_urls", "reference_image_url", "reference_image_urls", "reference_video_url", "reference_video_urls", "reference_audio_url", "reference_audio_urls", "generate_audio", "seed"]
    : modality === "image"
      ? ["prompt", "aspect_ratio", "resolution", "size", "quality", "image", "mask", "image_url", "image_urls", "seed", "width", "height"]
      : modality === "audio"
        ? ["input", "voice", "file", "response_format", "speed", "language", "prompt", "temperature", "audio_url"]
        : modality === "embedding"
          ? ["input"]
          : ["prompt", "content", "input", "temperature", "seed", "response_format"];
  const fields = Object.fromEntries(allowed.filter((name) => allFields[name]).map((name) => [name, allFields[name]]));
  return {
    id,
    modality,
    operations,
    mapperId: `${id}.standard-fields`,
    fields,
    evidence: evidence(ref),
  };
}

const emptyConfig = { type: "object" as const, properties: {} };
const openaiConfig = {
  type: "object" as const,
  properties: {
    videoEndpoint: {
      type: "string" as const,
      path: "video.endpoint",
      required: true,
      default: "videos",
    },
  },
};

/**
 * Built-in manifests describe only capabilities implemented by the current source adapters.
 * Generic adapters use a self-alias as a registration hint, not as a claim about every remote model.
 */
export function builtinAdapterManifest(id: string): AdapterManifest {
  switch (id) {
    case "openai":
      return {
        id,
        version: "1.0.0",
        displayName: "OpenAI-compatible",
        description: { zh: "受控的 OpenAI 风格协议适配器", en: "Controlled OpenAI-compatible protocol adapter" },
        modalities: ["llm", "embedding", "image", "audio", "video"],
        capabilities: [
          "chat", "chat.stream", "embedding", "image.generation", "image.edit", "image.variation",
          "audio.speech", "audio.transcription", "video.submit", "video.query",
        ],
        templateBindings: [
          template("chat", "llm", ["chat"], "legacy-adapter:openai"),
          template("embedding", "embedding", ["embedding"], "legacy-adapter:openai"),
          template("image", "image", ["image.generation", "image.edit", "image.variation"], "legacy-adapter:openai"),
          template("audio", "audio", ["audio.speech", "audio.transcription"], "legacy-adapter:openai"),
          template("video", "video", ["video.submit", "video.query"], "legacy-adapter:openai"),
        ],
        modelBindings: [binding("exact", ["openai-compatible"], "legacy-adapter:openai")],
        protocolBindings: ["openai-compatible", "openhub"],
        taskStrategy: { queryMode: "per_task" },
        artifactTypes: ["image", "audio", "video"],
         configSchema: openaiConfig,
        auth: "api_key",
        evidence: evidence("legacy-adapter:openai"),
      };
    case "memefast":
      return {
        id,
        version: "1.0.0",
        displayName: "MemeFast",
        description: { zh: "MemeFast 多模态中转适配器", en: "MemeFast multimodal relay adapter" },
        modalities: ["llm", "embedding", "image", "audio", "video"],
        capabilities: ["chat", "chat.stream", "embedding", "image.generation", "audio.speech", "audio.transcription", "video.submit", "video.query"],
        templateBindings: [
          template("chat", "llm", ["chat"], "legacy-adapter:memefast"),
          template("embedding", "embedding", ["embedding"], "legacy-adapter:memefast"),
          template("image", "image", ["image.generation"], "legacy-adapter:memefast"),
          template("audio", "audio", ["audio.speech", "audio.transcription"], "legacy-adapter:memefast"),
          ...["veo", "openai", "seedance", "kling", "vidu", "pixverse", "minimax", "luma"]
            .map((protocol) => template(protocol, "video", ["video.submit", "video.query"], `legacy-adapter:memefast:${protocol}`)),
        ],
        modelBindings: [binding("exact", ["memefast"], "legacy-adapter:memefast")],
        protocolBindings: ["openai-compatible", "openhub"],
        taskStrategy: { queryMode: "per_task" },
        artifactTypes: ["image", "audio", "video"],
        configSchema: {
          type: "object" as const,
          properties: {
            videoProtocol: {
              type: "enum" as const,
              path: "video.protocol",
              enum: ["veo", "openai", "seedance", "kling", "vidu", "pixverse", "minimax", "luma"],
            },
          },
        },
        auth: "api_key",
        evidence: evidence("legacy-adapter:memefast"),
      };
    case "grok":
      return {
        id,
        version: "1.0.0",
        displayName: "Grok video",
        modalities: ["video"],
        capabilities: ["video.submit", "video.query"],
        templateBindings: [template("grok-video", "video", ["video.submit", "video.query"], "legacy-adapter:grok")],
        modelBindings: [binding("prefix", ["grok-imagine-"], "legacy-adapter:grok")],
        protocolBindings: ["openhub"],
        taskStrategy: { queryMode: "per_task" },
        artifactTypes: ["video"],
        configSchema: emptyConfig,
        auth: "api_key",
        evidence: evidence("legacy-adapter:grok"),
      };
    case "kling":
      return {
        id,
        version: "1.0.0",
        displayName: "Kling video",
        modalities: ["video"],
        capabilities: ["video.submit", "video.query"],
        templateBindings: [template("kling-video", "video", ["video.submit", "video.query"], "legacy-adapter:kling")],
        modelBindings: [binding("prefix", ["kling"], "legacy-adapter:kling")],
        protocolBindings: ["openhub"],
        taskStrategy: { queryMode: "per_task" },
        artifactTypes: ["video"],
        configSchema: emptyConfig,
        auth: "api_key",
        evidence: evidence("legacy-adapter:kling"),
      };
    case "wan":
      return {
        id,
        version: "1.0.0",
        displayName: "Wan video",
        modalities: ["video"],
        capabilities: ["video.submit", "video.query"],
        templateBindings: [template("wan-video", "video", ["video.submit", "video.query"], "legacy-adapter:wan")],
        modelBindings: [binding("prefix", ["wan-", "Wan-"], "legacy-adapter:wan")],
        protocolBindings: ["openhub"],
        taskStrategy: { queryMode: "per_task" },
        artifactTypes: ["video"],
        configSchema: emptyConfig,
        auth: "api_key",
        evidence: evidence("legacy-adapter:wan"),
      };
    case "seedance":
      return {
        id,
        version: "1.0.0",
        displayName: "Seedance video",
        modalities: ["video"],
        capabilities: ["video.submit", "video.query"],
        templateBindings: [template("seedance-video", "video", ["video.submit", "video.query"], "legacy-adapter:seedance")],
        modelBindings: [binding("prefix", ["seedance", "doubao-seedance"], "legacy-adapter:seedance")],
        protocolBindings: ["openhub"],
        taskStrategy: { queryMode: "per_task" },
        artifactTypes: ["video"],
        configSchema: emptyConfig,
        auth: "api_key",
        evidence: evidence("legacy-adapter:seedance"),
      };
    default:
      throw new Error(`No built-in manifest for adapter ${id}`);
  }
}

export function supportedManifestCapabilities(): Set<AdapterCapability> {
  return new Set<AdapterCapability>([
    "chat", "chat.stream", "embedding", "image.generation", "image.edit", "image.variation",
    "audio.speech", "audio.transcription", "video.submit", "video.query", "video.cancel",
  ]);
}
