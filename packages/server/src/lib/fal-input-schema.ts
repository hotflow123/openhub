import { REFERENCE_MEDIA_FIELDS } from "./reference-media";

type JsonObject = Record<string, any>;

const IMAGE_FIELDS = new Set<string>(REFERENCE_MEDIA_FIELDS.images);
const VIDEO_FIELDS = new Set<string>(REFERENCE_MEDIA_FIELDS.videos);
const AUDIO_FIELDS = new Set<string>(REFERENCE_MEDIA_FIELDS.audios);

function parseJsonObject(raw: string | JsonObject | null | undefined): JsonObject | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function walkSchema(value: unknown, visit: (obj: JsonObject) => void, seen = new WeakSet<object>()): void {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  const obj = value as JsonObject;
  visit(obj);
  for (const child of Object.values(obj)) {
    if (Array.isArray(child)) {
      for (const item of child) walkSchema(item, visit, seen);
    } else {
      walkSchema(child, visit, seen);
    }
  }
}

function extractMaxItemsFromProp(prop: unknown): number | null {
  let found: number | null = null;
  walkSchema(prop, (obj) => {
    if (found === null && typeof obj.maxItems === "number") found = obj.maxItems;
  });
  return found;
}

function extractMaxItemsFromDescription(prop: unknown, fieldName: string): number | null {
  let description: string | null = null;
  walkSchema(prop, (obj) => {
    if (description === null && typeof obj.description === "string") description = obj.description;
  });
  if (!description) return null;
  const textDescription = description as string;

  const unitPattern = fieldName.includes("image")
    ? "images?|files?"
    : fieldName.includes("video")
      ? "videos?|files?"
      : "audios?|files?";
  const match = textDescription.match(new RegExp(`\\bup\\s+to\\s+(\\d+)\\s+(?:${unitPattern})\\b`, "i"));
  return match ? Number(match[1]) : null;
}

function findMaxItemsInSchema(schema: unknown, paramNames: string[]): number | null {
  const wanted = new Set(paramNames);
  let found: number | null = null;
  walkSchema(schema, (obj) => {
    if (found !== null || !obj.properties || typeof obj.properties !== "object") return;
    for (const name of wanted) {
      const prop = (obj.properties as JsonObject)[name];
      if (prop !== undefined) {
        const maxItems = extractMaxItemsFromProp(prop) ?? extractMaxItemsFromDescription(prop, name);
        if (maxItems !== null) {
          found = maxItems;
          return;
        }
      }
    }
  });
  return found;
}

function findProperty(schema: unknown, names: string[]): JsonObject | null {
  const wanted = new Set(names);
  let result: JsonObject | null = null;
  walkSchema(schema, (obj) => {
    if (result || !obj.properties || typeof obj.properties !== "object") return;
    for (const name of wanted) {
      const prop = (obj.properties as JsonObject)[name];
      if (prop && typeof prop === "object") {
        result = prop as JsonObject;
        return;
      }
    }
  });
  return result;
}

export interface FalInputSchemaCapabilities {
  inputSchemaJson: string | null;
  maxReferenceImages: number | null;
  maxReferenceVideos: number | null;
  maxReferenceAudios: number | null;
  imageUrlsSupported: boolean;
  videoUrlsSupported: boolean;
  audioUrlsSupported: boolean;
  referenceImageFields: string[];
  referenceVideoFields: string[];
  referenceAudioFields: string[];
  durationEnum: string[];
  aspectRatioEnum: string[];
  resolutionEnum: string[];
  generateAudioDefault: boolean | null;
}

export function extractInputSchemaCapabilities(
  inputSchemaRaw: string | JsonObject | null | undefined,
  parametersRaw: string | null | undefined,
): FalInputSchemaCapabilities {
  const empty: FalInputSchemaCapabilities = {
    inputSchemaJson: null,
    maxReferenceImages: null,
    maxReferenceVideos: null,
    maxReferenceAudios: null,
    imageUrlsSupported: false,
    videoUrlsSupported: false,
    audioUrlsSupported: false,
    referenceImageFields: [],
    referenceVideoFields: [],
    referenceAudioFields: [],
    durationEnum: [],
    aspectRatioEnum: [],
    resolutionEnum: [],
    generateAudioDefault: null,
  };
  const inputSchema = parseJsonObject(inputSchemaRaw);
  if (!inputSchema && !parametersRaw) return empty;

  let maxReferenceImages = findMaxItemsInSchema(inputSchema, [...IMAGE_FIELDS]);
  let maxReferenceVideos = findMaxItemsInSchema(inputSchema, [...VIDEO_FIELDS]);
  let maxReferenceAudios = findMaxItemsInSchema(inputSchema, [...AUDIO_FIELDS]);

  let imageUrlsSupported = false;
  let videoUrlsSupported = false;
  let audioUrlsSupported = false;
  let referenceImageFields: string[] = [];
  let referenceVideoFields: string[] = [];
  let referenceAudioFields: string[] = [];
  let durationEnum: string[] = [];
  let aspectRatioEnum: string[] = [];
  let resolutionEnum: string[] = [];
  let generateAudioDefault: boolean | null = null;

  if (parametersRaw && typeof parametersRaw === "string") {
    try {
      const params = JSON.parse(parametersRaw) as any[];
      const names = params.map(function(p: any) { return p.name; }).filter((name): name is string => typeof name === "string");
      referenceImageFields = names.filter((name) => IMAGE_FIELDS.has(name));
      referenceVideoFields = names.filter((name) => VIDEO_FIELDS.has(name));
      referenceAudioFields = names.filter((name) => AUDIO_FIELDS.has(name));
      imageUrlsSupported = referenceImageFields.length > 0;
      videoUrlsSupported = referenceVideoFields.length > 0;
      audioUrlsSupported = referenceAudioFields.length > 0;
      const imageParam = params.find((p: any) => IMAGE_FIELDS.has(p?.name));
      const videoParam = params.find((p: any) => VIDEO_FIELDS.has(p?.name));
      const audioParam = params.find((p: any) => AUDIO_FIELDS.has(p?.name));
      if (imageParam && maxReferenceImages === null) {
        const parsed = extractMaxItemsFromDescription(imageParam, imageParam.name);
        if (parsed !== null) maxReferenceImages = parsed;
      }
      if (videoParam && maxReferenceVideos === null) {
        const parsed = extractMaxItemsFromDescription(videoParam, videoParam.name);
        if (parsed !== null) maxReferenceVideos = parsed;
      }
      if (audioParam && maxReferenceAudios === null) {
        const parsed = extractMaxItemsFromDescription(audioParam, audioParam.name);
        if (parsed !== null) maxReferenceAudios = parsed;
      }
      const d = params.find(function(p: any) { return p.name === "duration"; });
      if (d?.enum) durationEnum = d.enum.map(String);
      const ar = params.find(function(p: any) { return p.name === "aspect_ratio"; });
      if (ar?.enum) aspectRatioEnum = ar.enum.map(String);
      const res = params.find(function(p: any) { return p.name === "resolution"; });
      if (res?.enum) resolutionEnum = res.enum.map(String);
      const ga = params.find(function(p: any) { return p.name === "generate_audio"; });
      if (ga?.default !== undefined) generateAudioDefault = ga.default as boolean;
    } catch (_) { /* ignore */ }
  }

  imageUrlsSupported ||= findProperty(inputSchema, [...IMAGE_FIELDS]) !== null;
  videoUrlsSupported ||= findProperty(inputSchema, [...VIDEO_FIELDS]) !== null;
  audioUrlsSupported ||= findProperty(inputSchema, [...AUDIO_FIELDS]) !== null;
  if (referenceImageFields.length === 0 && imageUrlsSupported) referenceImageFields = REFERENCE_MEDIA_FIELDS.images.filter((name) => findProperty(inputSchema, [name]) !== null);
  if (referenceVideoFields.length === 0 && videoUrlsSupported) referenceVideoFields = REFERENCE_MEDIA_FIELDS.videos.filter((name) => findProperty(inputSchema, [name]) !== null);
  if (referenceAudioFields.length === 0 && audioUrlsSupported) referenceAudioFields = REFERENCE_MEDIA_FIELDS.audios.filter((name) => findProperty(inputSchema, [name]) !== null);

  const durationProp = findProperty(inputSchema, ["duration"]);
  const aspectProp = findProperty(inputSchema, ["aspect_ratio"]);
  const resolutionProp = findProperty(inputSchema, ["resolution"]);
  if (durationEnum.length === 0 && Array.isArray(durationProp?.enum)) {
    durationEnum = durationProp.enum.map(String);
  }
  if (aspectRatioEnum.length === 0 && Array.isArray(aspectProp?.enum)) {
    aspectRatioEnum = aspectProp.enum.map(String);
  }
  if (resolutionEnum.length === 0 && Array.isArray(resolutionProp?.enum)) {
    resolutionEnum = resolutionProp.enum.map(String);
  }
  if (generateAudioDefault === null && typeof findProperty(inputSchema, ["generate_audio"])?.default === "boolean") {
    generateAudioDefault = findProperty(inputSchema, ["generate_audio"])?.default as boolean;
  }

  return {
    inputSchemaJson: typeof inputSchemaRaw === "string"
      ? inputSchemaRaw
      : inputSchema
        ? JSON.stringify(inputSchema)
        : null,
    maxReferenceImages,
    maxReferenceVideos,
    maxReferenceAudios,
    imageUrlsSupported,
    videoUrlsSupported,
    audioUrlsSupported,
    referenceImageFields,
    referenceVideoFields,
    referenceAudioFields,
    durationEnum,
    aspectRatioEnum,
    resolutionEnum,
    generateAudioDefault,
  };
}
