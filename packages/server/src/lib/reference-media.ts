export const REFERENCE_MEDIA_FIELDS = {
  images: [
    "image_url",
    "image_urls",
    "reference_image_url",
    "reference_image_urls",
    "reference_images",
    "image_references",
    "ref_image_urls",
    "input_image_url",
    "input_image_urls",
    "end_image_url",
    "end_image_urls",
  ],
  videos: [
    "video_url",
    "video_urls",
    "reference_video",
    "reference_videos",
    "reference_video_url",
    "reference_video_urls",
  ],
  audios: [
    "audio_url",
    "audio_urls",
    "reference_audio",
    "reference_audios",
    "reference_audio_url",
    "reference_audio_urls",
  ],
} as const;

export interface ReferenceMediaLimits {
  maxReferenceImages?: number | null;
  maxReferenceVideos?: number | null;
  maxReferenceAudios?: number | null;
}

type ReferenceMediaKind = keyof typeof REFERENCE_MEDIA_FIELDS;

function resourceCount(value: unknown): number {
  if (value == null || value === "") return 0;
  return Array.isArray(value) ? value.length : 1;
}

export function countReferenceMedia(
  body: Record<string, unknown>,
  kind: ReferenceMediaKind,
): number {
  return REFERENCE_MEDIA_FIELDS[kind].reduce(
    (count, field) => count + resourceCount(body[field]),
    0,
  );
}

export function validateReferenceMediaLimits(
  body: Record<string, unknown>,
  limits: ReferenceMediaLimits,
): string | null {
  const checks: Array<[ReferenceMediaKind, number | null | undefined, string]> = [
    ["images", limits.maxReferenceImages, "reference images"],
    ["videos", limits.maxReferenceVideos, "reference videos"],
    ["audios", limits.maxReferenceAudios, "reference audios"],
  ];

  for (const [kind, limit, label] of checks) {
    if (limit == null) continue;
    const count = countReferenceMedia(body, kind);
    if (count > limit) return `Too many ${label}: received ${count}, limit is ${limit}`;
  }

  return null;
}

export function validateReferenceLimitsAgainstModel(
  requested: ReferenceMediaLimits,
  model: ReferenceMediaLimits,
): string | null {
  const checks: Array<[keyof ReferenceMediaLimits, string]> = [
    ["maxReferenceImages", "reference images"],
    ["maxReferenceVideos", "reference videos"],
    ["maxReferenceAudios", "reference audios"],
  ];

  for (const [field, label] of checks) {
    const requestedLimit = requested[field];
    const modelLimit = model[field];
    if (requestedLimit != null && modelLimit != null && requestedLimit > modelLimit) {
      return `${label} limit ${requestedLimit} exceeds this model's limit ${modelLimit}`;
    }
  }

  return null;
}
