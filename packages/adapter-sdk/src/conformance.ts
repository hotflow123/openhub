import type { AdapterCapability, AdapterTemplateBinding, ConfigField, ConfigSchema, EvidenceRef, Modality, TemplateOperation } from "./common";
import type { AdapterHandler, AdapterManifest, ProviderAdapter } from "./manifest";

const modalities = new Set<Modality>(["llm", "embedding", "image", "audio", "video"]);
const capabilities = new Set<AdapterCapability>([
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
]);
const protocols = new Set(["openhub", "openai-compatible"]);
const authModes = new Set(["api_key", "oauth2_jwt", "none"]);
const bindingKinds = new Set(["exact", "normalized", "alias", "prefix"]);
const evidenceKinds = new Set(["official-doc", "fixture", "runtime", "admin-confirmed"]);
const templateOperations = new Set<TemplateOperation>([
  "chat",
  "embedding",
  "image.generation",
  "image.edit",
  "image.variation",
  "audio.speech",
  "audio.transcription",
  "video.submit",
  "video.query",
]);

export type AdapterValidationStatus = "ready" | "invalid" | "extension_required";

export interface AdapterValidationIssue {
  path: string;
  message: string;
}

export interface AdapterValidationResult {
  ok: boolean;
  status: AdapterValidationStatus;
  issues: AdapterValidationIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasFunction(value: unknown, key: string): boolean {
  return isRecord(value) && typeof value[key] === "function";
}

function addIssue(issues: AdapterValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function validateEvidence(value: unknown, path: string, issues: AdapterValidationIssue[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    addIssue(issues, path, "must contain at least one evidence reference");
    return;
  }
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      addIssue(issues, `${path}[${index}]`, "must be an object");
      return;
    }
    if (typeof entry.kind !== "string" || !evidenceKinds.has(entry.kind)) {
      addIssue(issues, `${path}[${index}].kind`, "is not a supported evidence kind");
    }
    if (typeof entry.ref !== "string" || entry.ref.trim().length === 0) {
      addIssue(issues, `${path}[${index}].ref`, "must be a non-empty string");
    }
    if (typeof entry.verifiedAt !== "string" || entry.verifiedAt.trim().length === 0) {
      addIssue(issues, `${path}[${index}].verifiedAt`, "must be a non-empty string");
    }
  });
}

function validateConfigField(value: unknown, path: string, issues: AdapterValidationIssue[]): void {
  if (!isRecord(value)) {
    addIssue(issues, path, "must be an object");
    return;
  }
  const field = value as Partial<ConfigField>;
  if (!field.type || !new Set(["string", "number", "integer", "boolean", "enum"]).has(field.type)) {
    addIssue(issues, `${path}.type`, "is not a supported config field type");
  }
  if (field.path !== undefined && (typeof field.path !== "string" || field.path.trim().length === 0)) {
    addIssue(issues, `${path}.path`, "must be a non-empty string when provided");
  }
  if (field.type === "enum" && (!Array.isArray(field.enum) || field.enum.length === 0)) {
    addIssue(issues, `${path}.enum`, "must contain enum values for enum fields");
  }
}

function validateConfigSchema(value: unknown, issues: AdapterValidationIssue[]): void {
  if (!isRecord(value) || value.type !== "object" || !isRecord(value.properties)) {
    addIssue(issues, "manifest.configSchema", "must be an object schema with properties");
    return;
  }
  for (const [key, field] of Object.entries(value.properties)) {
    validateConfigField(field, `manifest.configSchema.properties.${key}`, issues);
  }
}

function validateTemplateBinding(value: unknown, path: string, issues: AdapterValidationIssue[]): void {
  if (!isRecord(value)) {
    addIssue(issues, path, "must be an object");
    return;
  }
  const binding = value as Partial<AdapterTemplateBinding>;
  if (typeof binding.id !== "string" || binding.id.trim().length === 0) addIssue(issues, `${path}.id`, "must be a non-empty string");
  if (typeof binding.modality !== "string" || !modalities.has(binding.modality as Modality)) addIssue(issues, `${path}.modality`, "is not supported");
  if (typeof binding.mapperId !== "string" || binding.mapperId.trim().length === 0) addIssue(issues, `${path}.mapperId`, "must be a non-empty string");
  if (!Array.isArray(binding.operations) || binding.operations.length === 0) {
    addIssue(issues, `${path}.operations`, "must contain at least one operation");
  } else {
    const seen = new Set<string>();
    binding.operations.forEach((operation, index) => {
      if (typeof operation !== "string" || !templateOperations.has(operation as TemplateOperation)) addIssue(issues, `${path}.operations[${index}]`, "is not supported");
      if (typeof operation === "string" && seen.has(operation)) addIssue(issues, `${path}.operations[${index}]`, "is duplicated");
      if (typeof operation === "string") seen.add(operation);
    });
    if (binding.modality === "video" && (!seen.has("video.submit") || !seen.has("video.query"))) {
      addIssue(issues, `${path}.operations`, "video templates require video.submit and video.query");
    }
  }
  if (!isRecord(binding.fields)) {
    addIssue(issues, `${path}.fields`, "must be an object");
  } else {
    for (const [field, mapping] of Object.entries(binding.fields)) {
      if (!isRecord(mapping) || typeof mapping.target !== "string" || mapping.target.trim().length === 0) {
        addIssue(issues, `${path}.fields.${field}`, "must declare a non-empty target");
      }
      if (isRecord(mapping) && ("url" in mapping || "method" in mapping || "headers" in mapping || "script" in mapping || "selector" in mapping)) {
        addIssue(issues, `${path}.fields.${field}`, "cannot declare remote execution instructions");
      }
    }
  }
  validateEvidence(binding.evidence, `${path}.evidence`, issues);
}

function validateManifest(value: unknown, issues: AdapterValidationIssue[]): value is AdapterManifest {
  if (!isRecord(value)) {
    addIssue(issues, "manifest", "must be an object");
    return false;
  }
  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    addIssue(issues, "manifest.id", "must be a non-empty string");
  }
  if (typeof value.version !== "string" || !/^\d+\.\d+\.\d+$/.test(value.version)) {
    addIssue(issues, "manifest.version", "must use semantic version format");
  }
  if (typeof value.displayName !== "string" || value.displayName.trim().length === 0) {
    addIssue(issues, "manifest.displayName", "must be a non-empty string");
  }
  if (!Array.isArray(value.modalities) || value.modalities.length === 0) {
    addIssue(issues, "manifest.modalities", "must contain at least one modality");
  } else {
    value.modalities.forEach((entry, index) => {
      if (typeof entry !== "string" || !modalities.has(entry as Modality)) {
        addIssue(issues, `manifest.modalities[${index}]`, "is not supported");
      }
    });
  }
  if (!Array.isArray(value.capabilities) || value.capabilities.length === 0) {
    addIssue(issues, "manifest.capabilities", "must contain at least one capability");
  } else {
    value.capabilities.forEach((entry, index) => {
      if (typeof entry !== "string" || !capabilities.has(entry as AdapterCapability)) {
        addIssue(issues, `manifest.capabilities[${index}]`, "is not supported");
      }
    });
  }
  if (!Array.isArray(value.protocolBindings) || value.protocolBindings.length === 0) {
    addIssue(issues, "manifest.protocolBindings", "must contain at least one supported protocol");
  } else {
    value.protocolBindings.forEach((entry, index) => {
      if (typeof entry !== "string" || !protocols.has(entry)) {
        addIssue(issues, `manifest.protocolBindings[${index}]`, "is not supported");
      }
    });
  }
  if (typeof value.auth !== "string" || !authModes.has(value.auth)) {
    addIssue(issues, "manifest.auth", "is not supported");
  }
  if (!Array.isArray(value.modelBindings) || value.modelBindings.length === 0) {
    addIssue(issues, "manifest.modelBindings", "must contain at least one binding");
  } else {
    value.modelBindings.forEach((entry, index) => {
      if (!isRecord(entry)) {
        addIssue(issues, `manifest.modelBindings[${index}]`, "must be an object");
        return;
      }
      if (typeof entry.match !== "string" || !bindingKinds.has(entry.match)) {
        addIssue(issues, `manifest.modelBindings[${index}].match`, "is not supported");
      }
      if (!Array.isArray(entry.values) || entry.values.length === 0 || entry.values.some((item) => typeof item !== "string" || item.trim().length === 0)) {
        addIssue(issues, `manifest.modelBindings[${index}].values`, "must contain non-empty strings");
      }
      validateEvidence(entry.evidence, `manifest.modelBindings[${index}].evidence`, issues);
    });
  }
  validateConfigSchema(value.configSchema, issues);
  if (value.templateBindings !== undefined) {
    if (!Array.isArray(value.templateBindings)) {
      addIssue(issues, "manifest.templateBindings", "must be an array");
    } else {
      const seen = new Set<string>();
      value.templateBindings.forEach((binding, index) => {
        validateTemplateBinding(binding, `manifest.templateBindings[${index}]`, issues);
        if (isRecord(binding) && typeof binding.id === "string") {
          if (seen.has(binding.id)) addIssue(issues, `manifest.templateBindings[${index}].id`, "is duplicated");
          seen.add(binding.id);
        }
      });
    }
  }
  validateEvidence(value.evidence, "manifest.evidence", issues);
  if (value.taskStrategy && (!isRecord(value.taskStrategy) || !new Set(["per_task", "batch", "dynamic"]).has(value.taskStrategy.queryMode as string))) {
    addIssue(issues, "manifest.taskStrategy.queryMode", "is not supported");
  }
  return true;
}

function handlerFor(handlers: readonly AdapterHandler[], modality: string): AdapterHandler | undefined {
  return handlers.find((entry) => entry.modality === modality);
}

function validateCapabilityImplementation(
  capability: AdapterCapability,
  handlers: readonly AdapterHandler[],
  issues: AdapterValidationIssue[],
): void {
  const modality = capability.split(".")[0];
  const handler = handlerFor(handlers, modality === "chat" ? "llm" : modality);
  if (!handler) {
    addIssue(issues, `capabilities.${capability}`, "has no matching handler");
    return;
  }
  const implementation = handler.handler;
  const method = capability === "chat"
    ? "complete"
    : capability === "chat.stream"
      ? "stream"
      : capability === "embedding"
        ? "create"
        : capability === "image.generation"
          ? "generate"
          : capability === "image.edit"
            ? "edit"
            : capability === "image.variation"
              ? "variation"
              : capability === "audio.speech"
                ? "speech"
                : capability === "audio.transcription"
                  ? "transcribe"
                  : capability === "video.submit"
                    ? "submit"
                    : capability === "video.query"
                      ? "query"
                      : "cancel";
  if (!hasFunction(implementation, method)) {
    addIssue(issues, `capabilities.${capability}`, `requires handler method ${method}`);
  }
}

function validateHandlers(value: unknown, issues: AdapterValidationIssue[]): value is readonly AdapterHandler[] {
  if (!Array.isArray(value) || value.length === 0) {
    addIssue(issues, "handlers", "must contain at least one handler");
    return false;
  }
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.modality !== "string" || (!modalities.has(entry.modality as Modality) && entry.modality !== "async-task")) {
      addIssue(issues, `handlers[${index}].modality`, "is not supported");
      return;
    }
    if (seen.has(entry.modality)) {
      addIssue(issues, `handlers[${index}].modality`, "is duplicated");
    }
    seen.add(entry.modality);
    if (!isRecord(entry.handler)) {
      addIssue(issues, `handlers[${index}].handler`, "must be an object");
    }
  });
  return true;
}

function validateTaskStrategy(
  manifest: AdapterManifest,
  handlers: readonly AdapterHandler[],
  issues: AdapterValidationIssue[],
): boolean {
  const mode = manifest.taskStrategy?.queryMode;
  if (!mode) return false;
  const asyncHandler = handlerFor(handlers, "async-task");
  const videoHandler = handlerFor(handlers, "video");
  if (mode === "per_task") {
    const valid = Boolean(
      (asyncHandler && hasFunction(asyncHandler.handler, "submit") && hasFunction(asyncHandler.handler, "query")) ||
      (videoHandler && hasFunction(videoHandler.handler, "submit") && hasFunction(videoHandler.handler, "query")),
    );
    if (!valid) addIssue(issues, "manifest.taskStrategy", "per_task requires submit and query");
    return false;
  }
  if (!asyncHandler) {
    addIssue(issues, "manifest.taskStrategy", `${mode} requires an async-task handler`);
    return true;
  }
  const method = mode === "batch" ? "queryMany" : "dynamicQuery";
  if (!hasFunction(asyncHandler.handler, "submit") || !hasFunction(asyncHandler.handler, method)) {
    addIssue(issues, "manifest.taskStrategy", `${mode} requires submit and ${method}`);
  }
  return true;
}

export function validateProviderAdapter(adapter: unknown): AdapterValidationResult {
  const issues: AdapterValidationIssue[] = [];
  if (!isRecord(adapter)) {
    return { ok: false, status: "invalid", issues: [{ path: "adapter", message: "must be an object" }] };
  }
  const manifest = adapter.manifest;
  validateManifest(manifest, issues);
  const handlers = validateHandlers(adapter.handlers, issues) ? adapter.handlers as readonly AdapterHandler[] : [];
  if (isRecord(manifest) && Array.isArray(manifest.capabilities)) {
    for (const capability of manifest.capabilities) {
      if (typeof capability === "string" && capabilities.has(capability as AdapterCapability)) {
        validateCapabilityImplementation(capability as AdapterCapability, handlers, issues);
      }
    }
  }
  let extensionRequired = false;
  if (isRecord(manifest) && Array.isArray(manifest.modalities)) {
    const declared = new Set(manifest.modalities.filter((entry): entry is string => typeof entry === "string"));
    for (const modality of declared) {
      if (!handlerFor(handlers, modality)) addIssue(issues, `manifest.modalities.${modality}`, "has no handler");
    }
  }
  if (isRecord(manifest) && validateManifest(manifest, []) && handlers.length > 0) {
    extensionRequired = validateTaskStrategy(manifest, handlers, issues);
  }
  const status: AdapterValidationStatus = issues.length === 0
    ? "ready"
    : extensionRequired
      ? "extension_required"
      : "invalid";
  return { ok: status === "ready", status, issues };
}

export function assertValidProviderAdapter(adapter: unknown): asserts adapter is ProviderAdapter {
  const result = validateProviderAdapter(adapter);
  if (!result.ok) {
    throw new Error(`${result.status}: ${result.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
  }
}

export function isEvidenceRef(value: unknown): value is EvidenceRef {
  return isRecord(value)
    && typeof value.kind === "string"
    && evidenceKinds.has(value.kind)
    && typeof value.ref === "string"
    && value.ref.length > 0
    && typeof value.verifiedAt === "string"
    && value.verifiedAt.length > 0;
}

export function isConfigSchema(value: unknown): value is ConfigSchema {
  return isRecord(value)
    && value.type === "object"
    && isRecord(value.properties)
    && Object.values(value.properties).every((field) => isRecord(field) && typeof field.type === "string");
}
