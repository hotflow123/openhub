import type { NormalizedParameterTemplate, ParameterField } from "@openhub/catalog/parameter-template";
import type { ModelRow } from "../../db/schema/models";
import type { AdapterRegistration } from "../adapter-manifest";

export interface ParameterTemplateCompatibility {
  decision: "confirmed" | "candidate" | "incompatible" | "conflict";
  operation: string;
  fieldMapping: Record<string, string>;
  requiredFields: string[];
  unsupportedFields: string[];
  unmappedRequiredFields: string[];
  overridableFields: string[];
  reasons: string[];
}

const CANONICAL_FIELDS = new Set([
  "prompt", "content", "duration", "aspect_ratio", "resolution", "size", "quality", "style",
  "image", "mask", "image_url", "image_urls", "video_url", "video_urls", "audio_url", "audio_urls",
  "reference_image_url", "reference_image_urls", "reference_video_url", "reference_video_urls",
  "reference_audio_url", "reference_audio_urls", "generate_audio", "input", "voice", "file", "n",
  "response_format", "speed", "language", "temperature", "seed", "width", "height", "steps",
]);

const operationFor = (operation: string): string[] => {
  if (operation === "image.text_to_image") return ["image.generation"];
  if (operation === "image.image_to_image") return ["image.edit"];
  if (operation.startsWith("video.")) return ["video.submit", "video.query"];
  if (operation === "audio.speech") return ["audio.speech"];
  return [];
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s_\-/.:]+/g, " ").trim();
}

function identityCore(value: string): string {
  return normalize(value)
    .replace(/\s+(text to video|image to video|video to video|text to image|image to image|lipsync|recast|speech|transcription)$/i, "")
    .replace(/\s+(t2v|i2v|v2v|t2i|i2i)$/i, "")
    .trim();
}

function scoreIdentity(model: ModelRow, template: NormalizedParameterTemplate): number {
  const names = [model.rawName, model.displayName, model.family, model.vendor].filter((value): value is string => Boolean(value)).map(identityCore);
  const source = identityCore(template.sourceModelId);
  const compactSource = source.replace(/\s+/g, "");
  if (names.includes(source) || names.some((name) => name.replace(/\s+/g, "") === compactSource)) return 1;
  const tokens = new Set(source.split(" ").filter((token) => token.length > 2));
  const modelTokens = new Set(names.join(" ").split(" ").filter((token) => token.length > 2));
  const shared = [...tokens].filter((token) => modelTokens.has(token));
  return tokens.size ? shared.length / tokens.size : 0;
}

function fieldRequired(field: ParameterField): boolean {
  return field.required === true;
}

function configuredVideoProtocol(config: Record<string, unknown> | undefined): string | undefined {
  const video = config?.video;
  if (!video || typeof video !== "object" || Array.isArray(video)) return undefined;
  const protocol = (video as Record<string, unknown>).protocol;
  return typeof protocol === "string" && protocol.trim() ? protocol.trim() : undefined;
}

export function evaluateParameterTemplateCompatibility(input: {
  model: ModelRow;
  template: NormalizedParameterTemplate;
  registration: AdapterRegistration | null;
  operation: string;
  templateConfirmed: boolean;
  adapterConfig?: Record<string, unknown>;
}): ParameterTemplateCompatibility {
  const { model, template, registration, operation, templateConfirmed, adapterConfig } = input;
  const reasons: string[] = [];
  const fieldMapping: Record<string, string> = {};
  const overridableFields: string[] = [];
  const unsupportedFields: string[] = [];
  const requiredFields = template.required.length ? [...template.required] : Object.entries(template.inputs).filter(([, field]) => fieldRequired(field)).map(([name]) => name);
  const unmappedRequiredFields: string[] = [];
  const expectedOperations = operationFor(operation);

  if (template.modality !== model.modality) reasons.push("modality_mismatch");
  if (!registration) reasons.push("adapter_registration_missing");
  const bindings = registration?.manifest.templateBindings?.filter((binding) => binding.modality === template.modality) ?? [];
  const protocol = template.modality === "video" ? configuredVideoProtocol(adapterConfig) : undefined;
  const binding = protocol
    ? bindings.find((candidate) => candidate.id === protocol)
    : bindings.length === 1 ? bindings[0] : undefined;
  if (!binding && bindings.length > 1) reasons.push("adapter_template_binding_required");
  if (template.modality === "video" && bindings.length > 1 && !protocol) reasons.push("video_protocol_required");
  if (template.modality === "video" && protocol && !binding) reasons.push("video_protocol_unsupported");
  if (binding && expectedOperations.some((item) => !binding.operations.includes(item as never))) reasons.push("adapter_operation_unsupported");
  if (template.modality === "video" && (!registration?.manifest.capabilities.includes("video.submit") || !registration.manifest.capabilities.includes("video.query"))) reasons.push("video_submit_query_lifecycle_missing");
  if (template.modality === "audio" && operation === "audio.source") reasons.push("audio_source_operation_requires_adapter");

  for (const [name, field] of Object.entries(template.inputs)) {
    const declared = binding?.fields[name];
    if (declared) {
      fieldMapping[name] = declared.target;
      if (declared.overridable) overridableFields.push(name);
    } else if (CANONICAL_FIELDS.has(name)) {
      fieldMapping[name] = name;
      if (["aspect_ratio", "resolution", "duration", "image_urls", "video_urls", "audio_urls", "image_url", "video_url", "audio_url"].includes(name)) overridableFields.push(name);
    } else {
      unsupportedFields.push(name);
      if (fieldRequired(field) || requiredFields.includes(name)) unmappedRequiredFields.push(name);
    }
  }
  if (unmappedRequiredFields.length) reasons.push("required_fields_unmapped");
  if (unsupportedFields.length) reasons.push("unsupported_fields_present");

  const identityScore = scoreIdentity(model, template);
  if (identityScore >= 0.99) reasons.push("exact_model_identity");
  else if (identityScore >= 0.5) reasons.push("model_identity_candidate");
  else reasons.push("model_identity_unmatched");

  const hardIncompatible = reasons.some((reason) => ["modality_mismatch", "adapter_registration_missing", "adapter_operation_unsupported", "video_submit_query_lifecycle_missing", "video_protocol_unsupported", "audio_source_operation_requires_adapter", "required_fields_unmapped", "model_identity_unmatched"].includes(reason));
  const decision = hardIncompatible ? "incompatible" : !templateConfirmed || identityScore < 0.99 || reasons.includes("adapter_template_binding_required") || reasons.includes("video_protocol_required") || reasons.includes("unsupported_fields_present") ? "candidate" : "confirmed";
  return { decision, operation, fieldMapping, requiredFields, unsupportedFields, unmappedRequiredFields, overridableFields: [...new Set(overridableFields)], reasons };
}

export function matchParameterTemplates(input: {
  model: ModelRow;
  templates: readonly NormalizedParameterTemplate[];
  registration: AdapterRegistration | null;
  templateConfirmed?: boolean;
  adapterConfig?: Record<string, unknown>;
}): Array<{ template: NormalizedParameterTemplate; compatibility: ParameterTemplateCompatibility; confidence: "high" | "medium" | "low" }> {
  return input.templates
    .filter((template) => template.modality === input.model.modality)
    .map((template) => {
      const score = scoreIdentity(input.model, template);
      const compatibility = evaluateParameterTemplateCompatibility({ model: input.model, template, registration: input.registration, operation: template.operation, templateConfirmed: input.templateConfirmed ?? false, adapterConfig: input.adapterConfig });
      const confidence: "high" | "medium" | "low" = score >= 0.99 ? "high" : score >= 0.5 ? "medium" : "low";
      return { template, compatibility, confidence };
    })
    .filter((item) => item.confidence !== "low");
}
