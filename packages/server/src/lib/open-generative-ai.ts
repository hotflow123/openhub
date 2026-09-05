export interface ExternalModelInput {
  type?: string;
  title?: string;
  name?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minValue?: number;
  maxValue?: number;
  step?: number;
  items?: unknown;
  examples?: unknown[];
}

export interface ExternalModelRecord {
  id?: string;
  name?: string;
  description?: string;
  provider?: string;
  provider_name?: string;
  family?: string;
  required?: string[];
  promptRequired?: boolean;
  imageField?: string;
  lastImageField?: string;
  videoField?: string;
  audioField?: string;
  maxImages?: number;
  maxVideos?: number;
  maxAudios?: number;
  inputs?: Record<string, ExternalModelInput>;
}

export interface NormalizedExternalParameter {
  name: string;
  type: string;
  required: boolean;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  items?: unknown;
  examples?: unknown[];
}

export interface NormalizedExternalModel {
  endpointId: string;
  sourceModelId: string;
  title: string;
  modality: "image" | "video" | "audio" | "unknown";
  categories: string[];
  description: string | null;
  inputSchema: Record<string, unknown>;
  parameters: NormalizedExternalParameter[];
}

const MODALITIES: Record<string, NormalizedExternalModel["modality"]> = {
  t2iModels: "image",
  i2iModels: "image",
  t2vModels: "video",
  i2vModels: "video",
  v2vModels: "video",
  recastModels: "video",
  lipsyncModels: "video",
  imageLipSyncModels: "video",
  videoLipSyncModels: "video",
  audioModels: "audio",
};

function normalizeInput(name: string, input: ExternalModelInput): NormalizedExternalParameter {
  return {
    name,
    type: input.type === "int" ? "integer" : input.type ?? "string",
    required: false,
    ...(input.title && { title: input.title }),
    ...(input.description && { description: input.description }),
    ...(input.default !== undefined && { default: input.default }),
    ...(input.enum && { enum: input.enum }),
    ...(input.minValue !== undefined && { minimum: input.minValue }),
    ...(input.maxValue !== undefined && { maximum: input.maxValue }),
    ...(input.step !== undefined && { multipleOf: input.step }),
    ...(input.items !== undefined && { items: input.items }),
    ...(input.examples && { examples: input.examples }),
  };
}

function sourceMetadata(model: ExternalModelRecord): Record<string, unknown> | null {
  const metadata = {
    ...(model.provider && { provider: model.provider }),
    ...(model.provider_name && { providerName: model.provider_name }),
    ...(model.family && { family: model.family }),
    ...(model.imageField && { imageField: model.imageField }),
    ...(model.lastImageField && { lastImageField: model.lastImageField }),
    ...(model.videoField && { videoField: model.videoField }),
    ...(model.audioField && { audioField: model.audioField }),
    ...(model.maxImages !== undefined && { maxImages: model.maxImages }),
    ...(model.maxVideos !== undefined && { maxVideos: model.maxVideos }),
    ...(model.maxAudios !== undefined && { maxAudios: model.maxAudios }),
  };
  return Object.keys(metadata).length ? metadata : null;
}

export function normalizeOpenGenerativeAiModels(
  records: Record<string, ExternalModelRecord[]>,
): NormalizedExternalModel[] {
  const byId = new Map<string, NormalizedExternalModel>();

  for (const [collection, models] of Object.entries(records)) {
    const modality = MODALITIES[collection] ?? "unknown";
    const categoryName = collection.replace(/Models$/, "");

    for (const model of models) {
      if (!model.id) continue;
      const inputs = Object.entries(model.inputs ?? {}).map(([name, input]) => normalizeInput(name, input));
      let required = new Set([...model.required ?? [], ...(model.promptRequired ? ["prompt"] : [])]);
      const existing = byId.get(model.id);

      if (!existing) {
        const metadata = sourceMetadata(model);
        byId.set(model.id, {
          endpointId: `open-generative-ai:${model.id}`,
          sourceModelId: model.id,
          title: model.name ?? model.id,
          modality,
          categories: [categoryName],
          description: model.description ?? null,
          parameters: inputs.map((input) => ({ ...input, required: required.has(input.name) })),
          inputSchema: {
            type: "object",
            properties: Object.fromEntries(inputs.map((input) => [input.name, input])),
            required: [...required],
            ...(metadata && { "x-openhub-source-metadata": metadata }),
          },
        });
        continue;
      }

      if (!existing.categories.includes(categoryName)) existing.categories.push(categoryName);
      if (existing.modality === "unknown") existing.modality = modality;
      existing.description ||= model.description ?? null;

      const properties = existing.inputSchema.properties as Record<string, NormalizedExternalParameter>;
      for (const input of inputs) properties[input.name] ??= { ...input };
      const previousRequired = existing.inputSchema.required as string[];
      required = new Set([...previousRequired, ...required]);
      existing.inputSchema.required = [...required];
      existing.parameters = Object.values(properties).map((input) => ({
        ...input,
        required: required.has(input.name),
      }));

      const metadata = (existing.inputSchema["x-openhub-source-metadata"] ?? {}) as Record<string, unknown>;
      Object.assign(metadata, sourceMetadata(model) ?? {});
      if (Object.keys(metadata).length) existing.inputSchema["x-openhub-source-metadata"] = metadata;
    }
  }

  return [...byId.values()];
}


