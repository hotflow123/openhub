import type { VideoQueryResult, VideoResult, VideoTaskStatus } from "../adapter";

export function normalizeVideoResult(value: unknown): VideoResult | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const videoUrl = row.video_url ?? row.videoUrl ?? row.url;
  if (typeof videoUrl !== "string" || videoUrl.length === 0) return undefined;
  return {
    video_url: videoUrl,
    ...(typeof row.cover_url === "string" ? { cover_url: row.cover_url } : {}),
    ...(typeof row.duration === "number" ? { duration: row.duration } : {}),
    ...(typeof row.width === "number" ? { width: row.width } : {}),
    ...(typeof row.height === "number" ? { height: row.height } : {}),
    ...(typeof row.ratio === "string" ? { ratio: row.ratio } : {}),
    ...(typeof row.resolution === "string" ? { resolution: row.resolution } : {}),
    ...(row.provider_metadata && typeof row.provider_metadata === "object" && !Array.isArray(row.provider_metadata)
      ? { provider_metadata: row.provider_metadata as Record<string, unknown> }
      : {}),
  };
}

export function normalizeVideoQuery(
  status: VideoTaskStatus,
  result: unknown,
  error?: string,
): VideoQueryResult {
  const normalized = normalizeVideoResult(result);
  if (status === "completed" && !normalized) {
    return { status: "failed", error: "missing_video_result" };
  }
  return { status, result: normalized, error };
}
