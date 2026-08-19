import { extractInputSchemaCapabilities } from "./fal-input-schema";
import {
  countReferenceMedia,
  validateReferenceLimitsAgainstModel,
  validateReferenceMediaLimits,
  type ReferenceMediaLimits,
} from "./reference-media";

type JsonObject = Record<string, unknown>;

export interface ModelContractSource {
  falParametersSnapshot: string | null;
  falInputSchemaSnapshot: string | null;
  videoRequiredParams: string | null;
  videoOptionalParams: string | null;
  maxReferenceImages: number | null;
  maxReferenceVideos: number | null;
  maxReferenceAudios: number | null;
  maxDurationSec: number | null;
}

export interface ModelInputContract extends ReferenceMediaLimits {
  fields: string[];
  requiredFields: string[];
  enums: Record<string, string[]>;
  totalReferenceFiles: number | null;
  audioRequiresImageOrVideo: boolean;
}

export type ModelParameterLimits = Record<string, string[]>;

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
  const rawParameters = parseJson(model.falParametersSnapshot);
  const parameters = Array.isArray(rawParameters) ? rawParameters : [];
  const inputSchema = asObject(parseJson(model.falInputSchemaSnapshot));
  const capabilities = extractInputSchemaCapabilities(
    model.falInputSchemaSnapshot,
    model.falParametersSnapshot,
  );
  const properties = asObject(inputSchema?.properties);

  const fields = Array.from(new Set([
    ...parameters
      .map((parameter) => asObject(parameter)?.name)
      .filter((name): name is string => typeof name === "string"),
    ...Object.keys(properties ?? {}),
  ]));

  const requiredFields = Array.from(new Set([
    ...parameters
      .filter((parameter) => asObject(parameter)?.required === true)
      .map((parameter) => asObject(parameter)?.name)
      .filter((name): name is string => typeof name === "string"),
    ...asStringArray(inputSchema?.required),
    ...asStringArray(parseJson(model.videoRequiredParams)),
  ]));

  const enums: Record<string, string[]> = {};
  for (const parameter of parameters) {
    const row = asObject(parameter);
    const name = row?.name;
    const values = asStringArray(row?.enum);
    if (typeof name === "string" && values.length > 0) enums[name] = values;
  }
  for (const [name, property] of Object.entries(properties ?? {})) {
    const values = asStringArray(asObject(property)?.enum);
    if (values.length > 0 && !enums[name]) enums[name] = values;
  }

  return {
    fields,
    requiredFields,
    enums,
    maxReferenceImages: capabilities.maxReferenceImages ?? model.maxReferenceImages,
    maxReferenceVideos: capabilities.maxReferenceVideos ?? model.maxReferenceVideos,
    maxReferenceAudios: capabilities.maxReferenceAudios ?? model.maxReferenceAudios,
    totalReferenceFiles: findTotalReferenceFiles(parameters, inputSchema),
    audioRequiresImageOrVideo: hasAudioDependency(parameters, inputSchema),
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
    if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
      return `Missing required model parameter: ${field}`;
    }
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
