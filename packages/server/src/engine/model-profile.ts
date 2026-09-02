import type { InferredCapability } from "./infer";

export interface DerivedModelProfile {
  vendor: string | null;
  family: string | null;
  modelVersion: string | null;
  modality: InferredCapability["modality"];
  modalitySource: NonNullable<InferredCapability["classificationSource"]>;
  modalityConfidence: NonNullable<InferredCapability["classificationConfidence"]>;
  modalityReason: string | null;
  endpointCaps: string;
  paramCaps: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsReasoning: number;
  supportsFunctionCalling: number;
  supportsVision: number;
  supportedSizes: string | null;
  maxDurationSec: number | null;
  supportsStream: number;
  requiresAsync: number;
}

function textValue(value: string | undefined): string | null {
  return value && value !== "Unknown" ? value : null;
}

function jsonList(value: string[] | undefined): string | null {
  return value && value.length > 0 ? JSON.stringify(value) : null;
}

export function shouldRefreshDerivedModelProfile(capsOverridden: number): boolean {
  return capsOverridden === 0;
}

export function buildDerivedModelProfile(inferred: InferredCapability): DerivedModelProfile {
  const endpointCaps = inferred.endpointCaps ?? [];
  const profile: DerivedModelProfile = {
    vendor: textValue(inferred.inferredVendor),
    family: textValue(inferred.inferredFamily),
    modelVersion: textValue(inferred.inferredVersion),
    modality: inferred.modality,
    modalitySource: inferred.classificationSource ?? "unknown",
    modalityConfidence: inferred.classificationConfidence ?? "low",
    modalityReason: inferred.classificationReason ?? null,
    endpointCaps: JSON.stringify(endpointCaps),
    paramCaps: JSON.stringify(inferred.paramCaps ?? []),
    contextWindow: null,
    maxOutputTokens: null,
    supportsReasoning: 0,
    supportsFunctionCalling: 0,
    supportsVision: 0,
    supportedSizes: null,
    maxDurationSec: null,
    supportsStream: endpointCaps.includes("stream") ? 1 : 0,
    requiresAsync: inferred.falSource === "queue" || inferred.video?.requiresAsync === true ? 1 : 0,
  };

  if (inferred.modality === "llm") {
    profile.contextWindow = inferred.llm?.contextWindow ?? null;
    profile.supportsFunctionCalling =
      inferred.llm?.supportsFunctionCalling === true || endpointCaps.includes("function_calling") ? 1 : 0;
    profile.supportsVision =
      inferred.llm?.supportsVision === true || endpointCaps.includes("vision") ? 1 : 0;
    profile.supportsReasoning = endpointCaps.includes("reasoning") ? 1 : 0;
  }

  if (inferred.modality === "image") {
    profile.supportedSizes = jsonList(inferred.image?.supportedSizes);
  }

  if (inferred.modality === "video") {
    profile.maxDurationSec = inferred.video?.maxDurationSec ?? null;
  }

  return profile;
}
