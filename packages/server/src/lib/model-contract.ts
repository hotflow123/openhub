import { extractInputSchemaCapabilities } from "./fal-input-schema";
import { parseStoredVideoContract, validateVideoContractRequest, type StoredVideoContract } from "../engine/video/contract";
import type { InferredCapability, ParameterSnapshot } from "../engine/infer";
import type { Modality } from "@openhub/adapter-sdk";
import {
  countReferenceMedia,
  validateReferenceLimitsAgainstModel,
  validateReferenceMediaLimits,
  type ReferenceMediaLimits,
} from "./reference-media";

type JsonObject = Record<string, unknown>;

export type ContractLifecycle = "sync" | "stream" | "async" | "binary";
export type ContractSource = "provider" | "adapter" | "runtime" | "catalog" | "admin";
export type ContractStatus = "confirmed" | "candidate" | "partial" | "unverified";
export type IdentityStatus = "recognized" | "ambiguous" | "unmatched";
export type IdentitySource = "adapter-manifest" | "runtime" | "catalog" | "name" | "admin";
export type ParameterCoverage = "complete" | "partial" | "unknown";
export type ExecutionStatus = "ready" | "needs_review" | "unavailable";
export type RuntimeStatus = "verified" | "unverified" | "failed";

export type ContractNode = {
  type: "string" | "number" | "integer" | "boolean" | "object" | "array" | "media";
  required?: boolean;
  default?: unknown;
  enum?: Array<string | number | boolean>;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  properties?: Record<string, ContractNode>;
  items?: ContractNode;
  dependsOn?: Array<{ field: string; equals: string | number | boolean }>;
};

export interface CapabilityContract {
  modality: Modality;
  version: string;
  input: ContractNode;
  output: ContractNode;
  lifecycle: ContractLifecycle;
  source: ContractSource;
  status: ContractStatus;
  identityStatus: IdentityStatus;
  identitySource: IdentitySource;
  parameterCoverage: ParameterCoverage;
  executionStatus: ExecutionStatus;
  reason: string;
  templateId?: string | null;
  templateDecision?: "confirmed" | "candidate" | "incompatible" | null;
  templateFieldMapping?: Record<string, string>;
  templateOverridableFields?: string[];
}

export interface ModelContractSource {
  modality?: string | null;
  catalogMatchSource?: string | null;
  schemaMatchStatus?: string | null;
  falParametersSnapshot: string | null;
  falInputSchemaSnapshot: string | null;
  videoRequiredParams: string | null;
  videoOptionalParams: string | null;
  maxReferenceImages: number | null;
  maxReferenceVideos: number | null;
  maxReferenceAudios: number | null;
  maxDurationSec: number | null;
  videoContractSnapshot?: string | null;
  videoContractSource?: string | null;
  videoContractStatus?: string | null;
  videoContractReason?: string | null;
  videoContractSyncedAt?: Date | null;
  capabilityContractSnapshot?: string | null;
  capabilityContractSource?: string | null;
  capabilityContractStatus?: string | null;
  capabilityContractReason?: string | null;
  capabilityContractSyncedAt?: Date | null;
  modelIdentityStatus?: string | null;
  modelIdentitySource?: string | null;
  modelIdentityReason?: string | null;
  adapterVersion?: string | null;
  adapterHash?: string | null;
  adapterValidationStatus?: string | null;
  adapterValidationReason?: string | null;
}

export interface ModelInputContract extends ReferenceMediaLimits {
  fields: string[];
  requiredFields: string[];
  enums: Record<string, string[]>;
  defaults: Record<string, unknown>;
  fieldNodes: Record<string, ContractNode>;
  totalReferenceFiles: number | null;
  audioRequiresImageOrVideo: boolean;
  videoContract: StoredVideoContract | null;
  source: ContractSource | "fal" | "none";
  status: ContractStatus;
}

export type ModelParameterLimits = Record<string, string[]>;

export interface ModelIdentityEvidence {
  status: IdentityStatus;
  source: IdentitySource;
  reason: string;
}

export interface ModelIdentityInput {
  runtimeInference?: Pick<InferredCapability, "inferredVendor" | "inferredFamily" | "modality" | "confidence" | "classificationSource" | "classificationConfidence"> | null;
  nameInference?: Pick<InferredCapability, "inferredVendor" | "inferredFamily" | "modality" | "confidence" | "classificationSource" | "classificationConfidence"> | null;
  runtimeMetadata?: Record<string, unknown>;
  manifestMatch?: { vendor?: string; reason: string } | null;
  catalogMatch?: {
    source: "exact" | "normalized" | "admin";
    reason?: string;
  } | null;
}

export interface CapabilityContractInput {
  modality: Modality;
  identity: ModelIdentityEvidence;
  inferred: InferredCapability;
  runtimeMetadata?: Record<string, unknown>;
  adapterCapabilities: string[];
  adapterValidationStatus?: string | null;
  templateEvidence?: TemplateEvidenceInput | null;
}

export interface TemplateEvidenceInput {
  decision: "confirmed" | "candidate" | "incompatible";
  templateId: string | null;
  operations: string[];
  requiredFieldsMapped: boolean;
  lifecycleConfirmed: boolean;
  reason: string;
  fieldMapping?: Record<string, string>;
  overridableFields?: string[];
}

export interface ModelEvidence {
  identity: ModelIdentityEvidence;
  capabilityContract: CapabilityContract | null;
  adapterValidationStatus: "ready" | "invalid" | "extension_required" | "quarantined";
  adapterValidationReason: string | null;
}

function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function collectDescriptions(value: unknown, descriptions: string[], seen = new WeakSet<object>()): void {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectDescriptions(item, descriptions, seen);
    return;
  }
  const object = value as JsonObject;
  if (typeof object.description === "string") descriptions.push(object.description);
  for (const child of Object.values(object)) collectDescriptions(child, descriptions, seen);
}

function collectAudioDescriptions(value: unknown, descriptions: string[], keyHint = "", seen = new WeakSet<object>()): void {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectAudioDescriptions(item, descriptions, keyHint, seen);
    return;
  }
  const object = value as JsonObject;
  const name = typeof object.name === "string" ? object.name : keyHint;
  if (/audio/i.test(name) && typeof object.description === "string") descriptions.push(object.description);
  for (const [key, child] of Object.entries(object)) collectAudioDescriptions(child, descriptions, key, seen);
}

function firstNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asContractNode(value: unknown): ContractNode | null {
  const object = asObject(value);
  if (!object || typeof object.type !== "string") return null;
  const allowed = new Set(["string", "number", "integer", "boolean", "object", "array", "media"]);
  if (!allowed.has(object.type)) return null;
  const node: ContractNode = { type: object.type as ContractNode["type"] };
  if (typeof object.required === "boolean") node.required = object.required;
  if (Object.prototype.hasOwnProperty.call(object, "default")) node.default = object.default;
  if (Array.isArray(object.enum)) {
    const values = object.enum.filter((item): item is string | number | boolean =>
      typeof item === "string" || typeof item === "number" || typeof item === "boolean",
    );
    if (values.length > 0) node.enum = values;
  }
  if (typeof object.minimum === "number") node.minimum = object.minimum;
  if (typeof object.maximum === "number") node.maximum = object.maximum;
  if (typeof object.minItems === "number") node.minItems = object.minItems;
  if (typeof object.maxItems === "number") node.maxItems = object.maxItems;
  if (object.items) {
    const items = asContractNode(object.items);
    if (items) node.items = items;
  }
  if (object.properties && typeof object.properties === "object" && !Array.isArray(object.properties)) {
    const properties: Record<string, ContractNode> = {};
    for (const [key, child] of Object.entries(object.properties)) {
      const childNode = asContractNode(child);
      if (childNode) properties[key] = childNode;
    }
    if (Object.keys(properties).length > 0) node.properties = properties;
  }
  if (Array.isArray(object.required)) {
    const required = new Set(asStringArray(object.required));
    if (node.properties) {
      for (const [key, child] of Object.entries(node.properties)) {
        if (required.has(key)) node.properties[key] = { ...child, required: true };
      }
    }
  }
  return node;
}

function parseCapabilityContract(model: ModelContractSource): CapabilityContract | null {
  if (model.capabilityContractStatus !== "confirmed") return null;
  const raw = asObject(parseJson(model.capabilityContractSnapshot));
  if (!raw) return null;
  const input = asContractNode(raw.input);
  const output = asContractNode(raw.output);
  if (!input || !output) return null;
  if (
    typeof raw.modality !== "string" ||
    typeof raw.version !== "string" ||
    typeof raw.lifecycle !== "string" ||
    typeof raw.source !== "string" ||
    typeof raw.status !== "string" ||
    typeof raw.identityStatus !== "string" ||
    typeof raw.identitySource !== "string" ||
    typeof raw.parameterCoverage !== "string" ||
    typeof raw.executionStatus !== "string" ||
    typeof raw.reason !== "string"
  ) return null;
  return { ...raw, input, output } as unknown as CapabilityContract;
}

function parameterNode(parameter: JsonObject): ContractNode | null {
  const rawType = typeof parameter.type === "string" ? parameter.type.toLowerCase() : "";
  const type = rawType === "integer" ? "integer"
    : rawType === "number" ? "number"
      : rawType === "boolean" ? "boolean"
        : rawType === "object" ? "object"
          : rawType === "array" ? "array"
            : rawType === "media" || /image|audio|video|file/i.test(rawType) ? "media"
              : rawType === "string" ? "string"
                : null;
  if (!type) return null;
  const node: ContractNode = { type };
  if (parameter.required === true) node.required = true;
  if (Object.prototype.hasOwnProperty.call(parameter, "default")) node.default = parameter.default;
  const enumValues = Array.isArray(parameter.enum)
    ? parameter.enum.filter((item): item is string | number | boolean =>
      typeof item === "string" || typeof item === "number" || typeof item === "boolean",
    )
    : [];
  if (enumValues.length > 0) node.enum = enumValues;
  if (typeof parameter.minimum === "number") node.minimum = parameter.minimum;
  if (typeof parameter.maximum === "number") node.maximum = parameter.maximum;
  if (typeof parameter.maxItems === "number") node.maxItems = parameter.maxItems;
  if (typeof parameter.minItems === "number") node.minItems = parameter.minItems;
  return node;
}

function readContractNodeFields(input: ContractNode): {
  fields: string[];
  requiredFields: string[];
  enums: Record<string, string[]>;
  defaults: Record<string, unknown>;
  fieldNodes: Record<string, ContractNode>;
  maxReferenceImages: number | null;
  maxReferenceVideos: number | null;
  maxReferenceAudios: number | null;
} {
  const properties = input.type === "object" ? input.properties ?? {} : {};
  const fields = Object.keys(properties);
  const requiredFields = fields.filter((field) => properties[field]?.required === true);
  const enums: Record<string, string[]> = {};
  const defaults: Record<string, unknown> = {};
  for (const [field, node] of Object.entries(properties)) {
    if (node.enum && node.enum.length > 0) enums[field] = node.enum.map(String);
    if (Object.prototype.hasOwnProperty.call(node, "default")) defaults[field] = node.default;
  }
  const mediaLimit = (pattern: RegExp): number | null => {
    const entry = Object.entries(properties).find(([field, node]) => pattern.test(field) && node.maxItems != null);
    return entry?.[1].maxItems ?? null;
  };
  return {
    fields,
    requiredFields,
    enums,
    defaults,
    fieldNodes: properties,
    maxReferenceImages: mediaLimit(/image/i),
    maxReferenceVideos: mediaLimit(/video/i),
    maxReferenceAudios: mediaLimit(/audio/i),
  };
}

function knownText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && !/^(unknown|n\/a|none)$/i.test(text) ? text : null;
}

function metadataText(metadata: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!metadata) return null;
  for (const key of keys) {
    const value = knownText(metadata[key]);
    if (value) return value;
  }
  return null;
}

function identitySourceFromInference(
  source: InferredCapability["classificationSource"],
): IdentitySource {
  switch (source) {
    case "runtime":
      return "runtime";
    case "catalog":
    case "schema":
      return "catalog";
    case "manual":
      return "admin";
    default:
      return "name";
  }
}

export function deriveModelIdentity(input: ModelIdentityInput): ModelIdentityEvidence {
  if (input.manifestMatch) {
    return {
      status: "recognized",
      source: "adapter-manifest",
      reason: input.manifestMatch.reason,
    };
  }

  if (input.catalogMatch) {
    return {
      status: "recognized",
      source: "catalog",
      reason: input.catalogMatch.reason ?? `confirmed_catalog_${input.catalogMatch.source}_match`,
    };
  }

  const runtimeVendor = metadataText(input.runtimeMetadata, ["vendor", "provider", "provider_name", "lab", "organization"]);
  const runtimeFamily = metadataText(input.runtimeMetadata, ["family", "model_family", "modelFamily"]);
  if (runtimeVendor && runtimeFamily) {
    return {
      status: "recognized",
      source: "runtime",
      reason: "runtime_model_identity",
    };
  }
  if (runtimeVendor || runtimeFamily) {
    return {
      status: "ambiguous",
      source: "runtime",
      reason: "runtime_identity_is_missing_vendor_or_family",
    };
  }

  for (const candidate of [input.nameInference, input.runtimeInference]) {
    const vendor = knownText(candidate?.inferredVendor);
    const family = knownText(candidate?.inferredFamily);
    if (vendor && family) {
      const nameConfirmed = candidate?.classificationSource === "keyword"
        && candidate?.classificationConfidence === "high"
        && (candidate?.confidence ?? 0) >= 0.9;
      return {
        status: nameConfirmed ? "recognized" : "ambiguous",
        source: identitySourceFromInference(candidate?.classificationSource),
        reason: nameConfirmed
          ? "model_name_identity_match"
          : candidate?.classificationSource === "runtime"
          ? "runtime_model_family_candidate"
          : "model_name_family_candidate",
      };
    }
  }

  const modality = input.runtimeInference?.modality ?? input.nameInference?.modality;
  if (modality && modality !== "unknown") {
    return {
      status: "ambiguous",
      source: input.runtimeInference?.modality === modality ? "runtime" : "name",
      reason: "model_modality_known_but_vendor_or_family_unknown",
    };
  }

  return {
    status: "unmatched",
    source: "name",
    reason: "no_model_identity_evidence",
  };
}

function parseRuntimeJson(value: unknown): unknown {
  if (typeof value === "string") return parseJson(value);
  return value ?? null;
}

function runtimeParameterNode(parameter: JsonObject): ContractNode | null {
  const node = parameterNode(parameter);
  if (node) return node;
  const values = Array.isArray(parameter.enum)
    ? parameter.enum.filter((value): value is string | number | boolean =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean",
    )
    : [];
  const inferredType: ContractNode["type"] = values.length > 0
    ? values.every((value) => typeof value === "boolean")
      ? "boolean"
      : values.every((value) => typeof value === "number")
        ? "number"
        : "string"
    : "string";
  return {
    type: inferredType,
    ...(values.length > 0 ? { enum: values } : {}),
    ...(parameter.required === true ? { required: true } : {}),
  };
}

function baseContractProperties(modality: Modality): Record<string, ContractNode> {
  const properties: Record<string, ContractNode> = {
    model: { type: "string", required: true },
    provider_options: { type: "object" },
  };
  if (modality === "llm") {
    properties.messages = { type: "array", required: true, items: { type: "object" } };
    properties.stream = { type: "boolean" };
  } else if (modality === "embedding") {
    properties.input = { type: "array", required: true, items: { type: "string" } };
    properties.encoding_format = { type: "string" };
  } else if (modality === "image") {
    properties.prompt = { type: "string", required: true };
    properties.n = { type: "integer" };
    properties.size = { type: "string" };
    properties.quality = { type: "string" };
    properties.response_format = { type: "string" };
  } else if (modality === "audio") {
    properties.input = { type: "string" };
    properties.voice = { type: "string" };
    properties.file = { type: "media" };
    properties.response_format = { type: "string" };
  } else {
    properties.prompt = { type: "string" };
    properties.content = { type: "array", items: { type: "object" } };
    properties.duration = { type: "number" };
    properties.aspect_ratio = { type: "string" };
    properties.resolution = { type: "string" };
    properties.callback_url = { type: "string" };
    properties.idempotency_key = { type: "string" };
  }
  return properties;
}

function outputContractNode(modality: Modality): ContractNode {
  if (modality === "llm") {
    return { type: "object", properties: { choices: { type: "array" }, usage: { type: "object" } } };
  }
  if (modality === "embedding") {
    return { type: "object", properties: { data: { type: "array" }, usage: { type: "object" } } };
  }
  if (modality === "image") {
    return { type: "object", properties: { data: { type: "array" } } };
  }
  if (modality === "audio") return { type: "media" };
  return {
    type: "object",
    properties: {
      id: { type: "string" },
      status: { type: "string" },
      result: { type: "object" },
    },
  };
}

function runtimeContractProperties(
  metadata: Record<string, unknown> | undefined,
  inferred: InferredCapability,
): { properties: Record<string, ContractNode>; source: ContractSource; complete: boolean } {
  const properties = baseContractProperties(inferred.modality as Modality);
  let source: ContractSource = "adapter";
  let hasRuntimeEvidence = false;
  let complete = false;

  const schemaValue = parseRuntimeJson(metadata?.input_schema ?? metadata?.inputSchema);
  const schema = asContractNode(schemaValue);
  if (schema?.type === "object" && schema.properties) {
    Object.assign(properties, schema.properties);
    source = "runtime";
    hasRuntimeEvidence = true;
  }

  const rawParameters = parseRuntimeJson(metadata?.parameters);
  const parameters = Array.isArray(rawParameters)
    ? rawParameters.map(asObject).filter((value): value is JsonObject => value !== null)
    : [];
  for (const parameter of parameters) {
    const name = typeof parameter.name === "string" ? parameter.name.trim() : "";
    const node = name ? runtimeParameterNode(parameter) : null;
    if (name && node) properties[name] = node;
  }
  if (parameters.length > 0) {
    source = "runtime";
    hasRuntimeEvidence = true;
  }

  const providerParameters = inferred.parameters ?? [];
  for (const parameter of providerParameters) {
    const name = parameter.name.trim();
    const node = runtimeParameterNode(parameter as unknown as JsonObject);
    if (name && node) properties[name] = node;
  }
  if (providerParameters.length > 0) {
    source = "provider";
    hasRuntimeEvidence = true;
  }

  if (metadata?.contract_complete === true || metadata?.parameters_complete === true) complete = true;
  return {
    properties,
    source: hasRuntimeEvidence ? source : "adapter",
    complete,
  };
}

function adapterSupportsModality(modality: Modality, capabilities: string[]): boolean {
  if (modality === "llm") return capabilities.includes("chat");
  if (modality === "embedding") return capabilities.includes("embedding");
  if (modality === "image") return capabilities.some((capability) => capability.startsWith("image."));
  if (modality === "audio") return capabilities.some((capability) => capability.startsWith("audio."));
  return capabilities.includes("video.submit") && capabilities.includes("video.query");
}

export function buildCapabilityContract(input: CapabilityContractInput): CapabilityContract | null {
  if (input.inferred.modality === "unknown") return null;
  const modality = input.modality;
  const supported = adapterSupportsModality(modality, input.adapterCapabilities);
  const runtimeContract = runtimeContractProperties(input.runtimeMetadata, input.inferred);
  const templateEvidence = input.templateEvidence ?? null;
  const templateConfirmed = templateEvidence?.decision === "confirmed"
    && templateEvidence.requiredFieldsMapped
    && templateEvidence.lifecycleConfirmed;
  const status: ContractStatus = !supported
    ? "unverified"
    : modality === "video" && !templateEvidence
      ? "candidate"
      : templateEvidence?.decision === "incompatible"
        ? "unverified"
        : templateEvidence && !templateConfirmed
          ? "candidate"
          : "confirmed";
  const parameterCoverage: ParameterCoverage = runtimeContract.complete
    ? "complete"
    : runtimeContract.source === "adapter"
      ? "partial"
      : "partial";
  const lifecycle: ContractLifecycle = modality === "video"
    ? "async"
    : modality === "audio"
      ? "binary"
      : modality === "llm" && input.inferred.endpointCaps?.includes("stream")
        ? "stream"
        : "sync";
  const reason = !supported
    ? "adapter_does_not_implement_modality"
    : templateEvidence?.decision === "incompatible"
      ? templateEvidence.reason
      : modality === "video" && !templateEvidence
        ? "video_protocol_evidence_missing"
        : templateEvidence && !templateConfirmed
          ? templateEvidence.reason
    : runtimeContract.source === "adapter"
      ? "adapter_protocol_baseline_parameter_coverage_partial"
      : `${runtimeContract.source}_model_contract`;
  return {
    modality,
    version: "1",
    input: { type: "object", properties: runtimeContract.properties },
    output: outputContractNode(modality),
    lifecycle,
    source: runtimeContract.source,
    status,
    identityStatus: input.identity.status,
    identitySource: input.identity.source,
    parameterCoverage,
    executionStatus: deriveExecutionStatus({
      identityStatus: input.identity.status,
      capabilityContractStatus: status,
      adapterValidationStatus: input.adapterValidationStatus,
      capabilitySupported: supported,
    }),
    templateId: templateEvidence?.templateId ?? null,
    templateDecision: templateEvidence?.decision ?? null,
    templateFieldMapping: templateEvidence?.fieldMapping ?? {},
    templateOverridableFields: templateEvidence?.overridableFields ?? [],
    reason,
  };
}

function findTotalReferenceFiles(parameters: unknown[], inputSchema: JsonObject | null): number | null {
  const descriptions: string[] = [];
  for (const parameter of parameters) {
    const description = asObject(parameter)?.description;
    if (typeof description === "string") descriptions.push(description);
  }

  collectDescriptions(inputSchema, descriptions);

  for (const description of descriptions) {
    const match = description.match(/total\s+(?:files|items)[^\d]{0,80}(?:not\s+exceed|must\s+not\s+exceed|up\s+to)\s+(\d+)/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function hasAudioDependency(parameters: unknown[], inputSchema: JsonObject | null): boolean {
  const descriptions: string[] = [];
  for (const parameter of parameters) {
    const row = asObject(parameter);
    if (typeof row?.name === "string" && /audio/i.test(row.name) && typeof row.description === "string") {
      descriptions.push(row.description);
    }
  }

  collectAudioDescriptions(inputSchema, descriptions);

  return descriptions.some((description) => /at least one reference image or video/i.test(description));
}

export function readModelInputContract(model: ModelContractSource): ModelInputContract {
  const capabilityContract = parseCapabilityContract(model);
  if (capabilityContract) {
    const generic = readContractNodeFields(capabilityContract.input);
    const fal = model.schemaMatchStatus === "confirmed"
      ? readFalInputContract(model)
      : null;
    const fieldNodes = { ...generic.fieldNodes, ...(fal?.fieldNodes ?? {}) };
    const fields = Object.keys(fieldNodes);
    const requiredFields = Array.from(new Set([
      ...generic.requiredFields,
      ...(fal?.requiredFields ?? []),
    ]));
    const enums = { ...generic.enums, ...(fal?.enums ?? {}) };
    const defaults = { ...generic.defaults, ...(fal?.defaults ?? {}) };
    return {
      fields,
      requiredFields,
      enums,
      defaults,
      fieldNodes,
      maxReferenceImages: fal?.maxReferenceImages ?? generic.maxReferenceImages,
      maxReferenceVideos: fal?.maxReferenceVideos ?? generic.maxReferenceVideos,
      maxReferenceAudios: fal?.maxReferenceAudios ?? generic.maxReferenceAudios,
      totalReferenceFiles: fal?.totalReferenceFiles ?? null,
      audioRequiresImageOrVideo: fal?.audioRequiresImageOrVideo ?? false,
      videoContract: model.videoContractStatus === "confirmed"
        ? parseStoredVideoContract(model.videoContractSnapshot)
        : null,
      source: capabilityContract.source,
      status: capabilityContract.status,
    };
  }

  // A candidate association is a lookup hint, not a proven endpoint contract.
  // Only a schema explicitly applied through the wizard may validate or limit
  // a caller's request based on Fal fields.
  const schemaConfirmed = model.schemaMatchStatus === "confirmed";
  const falContract = readFalInputContract(model);
  return {
    ...falContract,
    videoContract: model.videoContractStatus === "confirmed"
      ? parseStoredVideoContract(model.videoContractSnapshot)
      : null,
    source: schemaConfirmed ? "fal" : "none",
    status: schemaConfirmed ? "confirmed" : "unverified",
  };
}

function readFalInputContract(model: ModelContractSource): Omit<ModelInputContract, "source" | "status" | "videoContract"> & { videoContract?: never } {
  const schemaConfirmed = model.schemaMatchStatus === "confirmed";
  const falParametersSnapshot = schemaConfirmed ? model.falParametersSnapshot : null;
  const falInputSchemaSnapshot = schemaConfirmed ? model.falInputSchemaSnapshot : null;
  const rawParameters = parseJson(falParametersSnapshot);
  const parameters = Array.isArray(rawParameters) ? rawParameters : [];
  const inputSchema = asObject(parseJson(falInputSchemaSnapshot));
  const capabilities = extractInputSchemaCapabilities(
    falInputSchemaSnapshot,
    falParametersSnapshot,
  );
  const properties = asObject(inputSchema?.properties);

  const fields = Array.from(new Set([
    ...parameters
      .map((parameter) => asObject(parameter)?.name)
      .filter((name): name is string => typeof name === "string"),
    ...Object.keys(properties ?? {}),
  ]));

  const fieldNodes: Record<string, ContractNode> = {};
  for (const parameter of parameters) {
    const row = asObject(parameter);
    const name = row?.name;
    if (typeof name !== "string") continue;
    const node = row ? parameterNode(row) ?? runtimeParameterNode(row) : null;
    if (node) fieldNodes[name] = node;
  }
  for (const [name, property] of Object.entries(properties ?? {})) {
    const node = asContractNode(property);
    if (node) fieldNodes[name] = node;
  }

  const requiredFields = Array.from(new Set([
    ...parameters
      .filter((parameter) => asObject(parameter)?.required === true)
      .map((parameter) => asObject(parameter)?.name)
      .filter((name): name is string => typeof name === "string"),
    ...asStringArray(inputSchema?.required),
    ...(schemaConfirmed ? asStringArray(parseJson(model.videoRequiredParams)) : []),
  ]));

  const enums: Record<string, string[]> = {};
  const defaults: Record<string, unknown> = {};
  for (const parameter of parameters) {
    const row = asObject(parameter);
    const name = row?.name;
    const values = asStringArray(row?.enum);
    if (typeof name === "string" && values.length > 0) enums[name] = values;
    if (typeof name === "string" && Object.prototype.hasOwnProperty.call(row ?? {}, "default")) defaults[name] = row?.default;
  }
  for (const [name, property] of Object.entries(properties ?? {})) {
    const values = asStringArray(asObject(property)?.enum);
    if (values.length > 0 && !enums[name]) enums[name] = values;
    const propertyObject = asObject(property);
    if (!Object.prototype.hasOwnProperty.call(defaults, name) && Object.prototype.hasOwnProperty.call(propertyObject ?? {}, "default")) {
      defaults[name] = propertyObject?.default;
    }
  }

  return {
    fields,
    requiredFields,
    enums,
    defaults,
    fieldNodes,
    maxReferenceImages: schemaConfirmed
      ? capabilities.maxReferenceImages ?? model.maxReferenceImages
      : null,
    maxReferenceVideos: schemaConfirmed
      ? capabilities.maxReferenceVideos ?? model.maxReferenceVideos
      : null,
    maxReferenceAudios: schemaConfirmed
      ? capabilities.maxReferenceAudios ?? model.maxReferenceAudios
      : null,
    totalReferenceFiles: findTotalReferenceFiles(parameters, inputSchema),
    audioRequiresImageOrVideo: hasAudioDependency(parameters, inputSchema),
  };
}

export interface ModelExecutionStateInput {
  identityStatus?: string | null;
  capabilityContractStatus?: string | null;
  adapterValidationStatus?: string | null;
  adapterConfigStatus?: string | null;
  capabilitySupported?: boolean;
  runtimeProbeStatus?: string | null;
  runtimeProbeCapability?: string | null;
  requiredCapability?: string | null;
  requireRuntimeProbe?: boolean;
}

export function deriveExecutionStatus(input: ModelExecutionStateInput): ExecutionStatus {
  if (input.capabilitySupported === false) return "unavailable";
  if (["invalid", "extension_required", "quarantined"].includes(input.adapterValidationStatus ?? "")) {
    return "unavailable";
  }
  if (input.adapterConfigStatus === "invalid") return "unavailable";
  if (input.identityStatus === "unmatched") return "unavailable";
  if (input.requireRuntimeProbe) {
    if (input.runtimeProbeStatus !== "available") {
      return ["unsupported", "request_invalid", "contract_mismatch"].includes(input.runtimeProbeStatus ?? "")
        ? "unavailable"
        : "needs_review";
    }
    if (input.requiredCapability && input.runtimeProbeCapability !== input.requiredCapability) {
      return "needs_review";
    }
  }
  if (
    input.identityStatus === "recognized" &&
    input.capabilityContractStatus === "confirmed" &&
    (input.adapterValidationStatus === "ready" || input.adapterValidationStatus == null) &&
    (input.adapterConfigStatus === "valid" || input.adapterConfigStatus == null)
  ) return "ready";
  return "needs_review";
}

function deriveRuntimeStatus(
  runtimeProbe: ModelRuntimeProbeEvidence | null | undefined,
): RuntimeStatus {
  if (runtimeProbe?.status === "available"
    && (!runtimeProbe.requiredCapability || runtimeProbe.capability === runtimeProbe.requiredCapability)) {
    return "verified";
  }
  if (runtimeProbe?.status && runtimeProbe.status !== "unknown") return "failed";
  return "unverified";
}

export interface ModelRuntimeProbeEvidence {
  status: string | null;
  capability?: string | null;
  requiredCapability?: string | null;
}

export function modelEvidenceState(model: ModelContractSource, runtimeProbe?: ModelRuntimeProbeEvidence | null): {
  identityStatus: IdentityStatus;
  identitySource: IdentitySource | null;
  contractStatus: ContractStatus;
  parameterCoverage: ParameterCoverage;
  executionStatus: ExecutionStatus;
  runtimeStatus: RuntimeStatus;
} {
  const capabilityContract = parseCapabilityContract(model);
  const weakNameIdentity = (
    model.modelIdentitySource === "name"
    && model.modelIdentityStatus !== "recognized"
  ) || (
    model.modelIdentitySource === "name"
    && model.modelIdentityReason === "model_name_family_rule"
  );
  const weakCatalogIdentity = model.modelIdentitySource === "catalog"
    && model.modelIdentityStatus !== "recognized"
    && !["exact", "normalized", "admin"].includes(model.catalogMatchSource ?? "");
  const identityStatus: IdentityStatus = weakNameIdentity || weakCatalogIdentity
    ? "ambiguous"
    : model.modelIdentityStatus === "recognized" || model.modelIdentityStatus === "ambiguous"
      ? model.modelIdentityStatus
    : "unmatched";
  const invalidConfirmedVideoContract = model.modality === "video"
    && model.capabilityContractStatus === "confirmed"
    && !capabilityContract;
  const contractStatus: ContractStatus = invalidConfirmedVideoContract
    ? "candidate"
    : model.capabilityContractStatus === "confirmed" || model.capabilityContractStatus === "candidate" || model.capabilityContractStatus === "partial"
    ? model.capabilityContractStatus
    : model.schemaMatchStatus === "confirmed"
      ? "confirmed"
      : model.schemaMatchStatus === "candidate"
        ? "candidate"
        : model.schemaMatchStatus === "partial"
          ? "partial"
          : "unverified";
  const parameterCoverage: ParameterCoverage = capabilityContract?.parameterCoverage
    ?? (contractStatus === "confirmed"
      ? "complete"
      : contractStatus === "partial"
        ? "partial"
        : "unknown");
  const adapterUnsupported = model.capabilityContractReason === "adapter_does_not_implement_modality";
  const identitySource = ["adapter-manifest", "runtime", "catalog", "name", "admin"].includes(model.modelIdentitySource ?? "")
    ? model.modelIdentitySource as IdentitySource
    : null;
  return {
    identityStatus,
    identitySource,
    contractStatus,
    parameterCoverage,
    executionStatus: deriveExecutionStatus({
      identityStatus,
      capabilityContractStatus: contractStatus,
      adapterValidationStatus: model.adapterValidationStatus,
      capabilitySupported: adapterUnsupported ? false : undefined,
      runtimeProbeStatus: runtimeProbe?.status,
      runtimeProbeCapability: runtimeProbe?.capability,
      requiredCapability: runtimeProbe?.requiredCapability,
      requireRuntimeProbe: false,
    }),
    runtimeStatus: deriveRuntimeStatus(runtimeProbe),
  };
}

function mappedValue(
  body: Record<string, unknown>,
  providerField: string,
  fieldMapping: Record<string, string>,
): unknown {
  if (Object.prototype.hasOwnProperty.call(body, providerField)) return body[providerField];
  const callerField = Object.entries(fieldMapping).find(([, target]) => target === providerField)?.[0];
  return callerField ? body[callerField] : undefined;
}

export function validateModelRequest(
  body: Record<string, unknown>,
  model: ModelContractSource,
  variantLimits: ReferenceMediaLimits,
  fieldMapping: Record<string, string> = {},
  paramLimits: ModelParameterLimits = {},
): string | null {
  const contract = readModelInputContract(model);
  const ignored = new Set(["model", "variant_id", "callback_url", "idempotency_key"]);

  for (const field of contract.requiredFields) {
    if (ignored.has(field)) continue;
    const value = mappedValue(body, field, fieldMapping);
    const contentHasText = field === "prompt" && Array.isArray(body.content)
      && body.content.some((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return false;
        const text = (item as Record<string, unknown>).text;
        return typeof text === "string" && text.trim().length > 0;
      });
    if (!contentHasText && (value == null || value === "" || (Array.isArray(value) && value.length === 0))) {
      return `Missing required model parameter: ${field}`;
    }
  }

  if (contract.videoContract) {
    const error = validateVideoContractRequest(body, contract.videoContract.contract);
    if (error && !(error.includes("prompt") && Array.isArray(body.content))) return error;
  }

  for (const [field, allowed] of Object.entries(contract.enums)) {
    const value = mappedValue(body, field, fieldMapping);
    if (value == null || Array.isArray(value)) continue;
    if (!allowed.includes(String(value))) {
      return `Invalid ${field}: expected one of ${allowed.join(", ")}`;
    }
  }

  for (const [field, allowed] of Object.entries(paramLimits)) {
    const value = mappedValue(body, field, fieldMapping);
    if (value == null) continue;
    if (Array.isArray(value) || !allowed.includes(String(value))) {
      return `Invalid ${field} for this variant: expected one of ${allowed.join(", ")}`;
    }
  }

  // A null variant limit means "no variant override", not "unlimited".
  // Enforce the model/Fal contract unless the variant explicitly narrows it.
  const effectiveLimits: ReferenceMediaLimits = {
    maxReferenceImages: variantLimits.maxReferenceImages ?? contract.maxReferenceImages,
    maxReferenceVideos: variantLimits.maxReferenceVideos ?? contract.maxReferenceVideos,
    maxReferenceAudios: variantLimits.maxReferenceAudios ?? contract.maxReferenceAudios,
  };
  const referenceError = validateReferenceMediaLimits(body, effectiveLimits);
  if (referenceError) return referenceError;

  const totalReferenceFiles = (["images", "videos", "audios"] as const)
    .reduce((total, kind) => total + countReferenceMedia(body, kind), 0);
  if (contract.totalReferenceFiles != null && totalReferenceFiles > contract.totalReferenceFiles) {
    return `Too many reference files: received ${totalReferenceFiles}, limit is ${contract.totalReferenceFiles}`;
  }

  if (
    contract.audioRequiresImageOrVideo &&
    countReferenceMedia(body, "audios") > 0 &&
    countReferenceMedia(body, "images") === 0 &&
    countReferenceMedia(body, "videos") === 0
  ) {
    return "Reference audio requires at least one reference image or video";
  }

  return null;
}

export function validateParameterLimitsAgainstModel(
  paramLimits: ModelParameterLimits,
  model: ModelContractSource,
): string | null {
  const contract = readModelInputContract(model);
  for (const [field, values] of Object.entries(paramLimits)) {
    const allowed = contract.enums[field];
    if (!allowed) return `Parameter limit field is not an enum field: ${field}`;
    const invalid = values.filter((value) => !allowed.includes(value));
    if (invalid.length > 0) {
      return `${field} contains unsupported values: ${invalid.join(", ")}`;
    }
  }
  return null;
}

const COMMON_VARIANT_FIELDS = new Set([
  "model", "messages", "prompt", "content", "input", "voice", "file", "image", "mask", "n", "size",
  "quality", "style", "response_format", "user", "stream", "temperature", "top_p", "max_tokens",
  "max_completion_tokens", "stop", "presence_penalty", "frequency_penalty", "tools", "tool_choice",
  "seed", "duration", "aspect_ratio", "resolution", "callback_url", "idempotency_key", "generate_audio",
  "image_url", "image_urls", "video_url", "video_urls", "audio_url", "audio_urls",
  "reference_image_url", "reference_image_urls", "reference_video_url", "reference_video_urls",
  "reference_audio_url", "reference_audio_urls", "provider_options",
]);

export function validateVariantParameterPolicy(
  fieldMapping: Record<string, string> | null | undefined,
  paramOverrides: Record<string, unknown> | null | undefined,
  model: ModelContractSource,
): string | null {
  const contract = readModelInputContract(model);
  const allowed = new Set([...COMMON_VARIANT_FIELDS, ...contract.fields]);
  for (const [source, target] of Object.entries(fieldMapping ?? {})) {
    if (!source.trim() || !target.trim()) return "Field mapping names must not be empty";
    if (!allowed.has(target)) return `Field mapping target is not in the model contract: ${target}`;
  }
  for (const field of Object.keys(paramOverrides ?? {})) {
    if (!allowed.has(field)) return `Variant override field is not in the model contract: ${field}`;
  }
  return null;
}

export function validateVariantLimits(
  requested: ReferenceMediaLimits & { maxDurationSec?: number | null },
  model: ModelContractSource,
): string | null {
  const contract = readModelInputContract(model);
  const modelReferenceLimits: ReferenceMediaLimits = {
    maxReferenceImages: contract.maxReferenceImages,
    maxReferenceVideos: contract.maxReferenceVideos,
    maxReferenceAudios: contract.maxReferenceAudios,
  };
  const requestedReferenceLimits: ReferenceMediaLimits = {
    maxReferenceImages: requested.maxReferenceImages,
    maxReferenceVideos: requested.maxReferenceVideos,
    maxReferenceAudios: requested.maxReferenceAudios,
  };
  const perKindError = validateReferenceLimitsAgainstModel(requestedReferenceLimits, modelReferenceLimits);
  if (perKindError) return perKindError;
  const referenceError = validateReferenceMediaLimits(
    {
      image_urls: requested.maxReferenceImages != null ? Array(requested.maxReferenceImages).fill(true) : undefined,
      video_urls: requested.maxReferenceVideos != null ? Array(requested.maxReferenceVideos).fill(true) : undefined,
      audio_urls: requested.maxReferenceAudios != null ? Array(requested.maxReferenceAudios).fill(true) : undefined,
    },
    {
      maxReferenceImages: contract.maxReferenceImages,
      maxReferenceVideos: contract.maxReferenceVideos,
      maxReferenceAudios: contract.maxReferenceAudios,
    },
  );
  if (referenceError) return referenceError;

  if (
    requested.maxDurationSec != null &&
    model.maxDurationSec != null &&
    requested.maxDurationSec > model.maxDurationSec
  ) {
    return `Duration limit ${requested.maxDurationSec} exceeds this model's limit ${model.maxDurationSec}`;
  }

  return null;
}

export function enumValuesForModel(model: ModelContractSource, field: string): string[] {
  return readModelInputContract(model).enums[field] ?? [];
}

export function numberFromUnknown(value: unknown): number | null {
  return firstNumber(value);
}
