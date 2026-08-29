import { inferModalityFromCatalog } from "./modality";

export interface CatalogProfileSource {
  labName?: string | null;
  family?: string | null;
  contextLimit?: number | null;
  outputLimit?: number | null;
  reasoning?: boolean | null;
  toolCall?: boolean | null;
  modalitiesIn?: string | null;
  modalitiesOut?: string | null;
}

export interface CatalogProfileTarget {
  capsOverridden: number;
  modality: string;
  modalitySource: string;
  vendor?: string | null;
  family?: string | null;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  supportsReasoning?: number;
  supportsFunctionCalling?: number;
  supportsVision?: number;
}

export function buildCatalogProfileUpdate(
  model: CatalogProfileTarget,
  catalog: CatalogProfileSource,
  confidence: "high" | "medium" | "low",
): Record<string, unknown> {
  if (model.capsOverridden === 1 || confidence !== "high") return {};

  const update: Record<string, unknown> = {};
  if ((!model.vendor || model.vendor === "Unknown") && catalog.labName) update.vendor = catalog.labName;
  if ((!model.family || model.family === "Unknown") && catalog.family) update.family = catalog.family;

  const catalogModality = inferModalityFromCatalog(catalog.modalitiesIn ?? null, catalog.modalitiesOut ?? null);
  if (model.modality === "unknown" && catalogModality) {
    update.modality = catalogModality;
    update.modalitySource = "catalog";
    update.modalityConfidence = "high";
    update.modalityReason = "catalog_high_confidence_match";
  }

  const finalModality = model.modality === "unknown" ? catalogModality ?? "unknown" : model.modality;
  if (finalModality !== "llm") {
    return {
      ...update,
      contextWindow: null,
      maxOutputTokens: null,
      supportsReasoning: 0,
      supportsFunctionCalling: 0,
      supportsVision: 0,
    };
  }

  if (model.modalitySource === "runtime" || model.modalitySource === "schema") return update;
  if (model.contextWindow == null && catalog.contextLimit != null) update.contextWindow = catalog.contextLimit;
  if (model.maxOutputTokens == null && catalog.outputLimit != null) update.maxOutputTokens = catalog.outputLimit;
  if (model.supportsReasoning !== 1 && catalog.reasoning === true) update.supportsReasoning = 1;
  if (model.supportsFunctionCalling !== 1 && catalog.toolCall === true) update.supportsFunctionCalling = 1;
  if (model.supportsVision !== 1 && catalogHasImageInput(catalog)) update.supportsVision = 1;
  return update;
}

export function clearCatalogProfileUpdate(model: CatalogProfileTarget): Record<string, unknown> {
  if (model.capsOverridden === 1 || model.modalitySource !== "catalog") return {};
  return {
    vendor: null,
    family: null,
    contextWindow: null,
    maxOutputTokens: null,
    supportsReasoning: 0,
    supportsFunctionCalling: 0,
    supportsVision: 0,
    modality: "unknown",
    modalitySource: "unknown",
    modalityConfidence: "low",
    modalityReason: "catalog_match_removed",
  };
}

function catalogHasImageInput(catalog: CatalogProfileSource): boolean {
  if (!catalog.modalitiesIn) return false;
  try {
    const values = JSON.parse(catalog.modalitiesIn) as unknown;
    return Array.isArray(values) && values.some((value) => value === "image");
  } catch {
    return false;
  }
}
