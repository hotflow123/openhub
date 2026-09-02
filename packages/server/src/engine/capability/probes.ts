import { randomUUID } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { modelCapabilityProbes, models, sites, variants } from "../../db/schema/index";
import { decrypt, getMasterKey } from "../../lib/crypto";
import { getAdapter, normalizeAdapterId, providerV1Url } from "../adapter";
import { classifyProbeFailure, type ProbeStatus } from "./status";

export const ProbeModeSchema = z.enum(["none", "safe", "full"]);
export type ProbeMode = z.infer<typeof ProbeModeSchema>;

export const ProbeStatusSchema = z.enum([
  "unknown",
  "available",
  "temporary_failure",
  "forbidden",
  "unsupported",
  "request_invalid",
  "contract_mismatch",
]);

export interface ProbeResult {
  modelId: string;
  capability: string;
  mode: ProbeMode;
  status: ProbeStatus;
  httpStatus: number | null;
  upstreamCode: string | null;
  message: string | null;
  requestId: string | null;
  retryAfter: string | null;
  latencyMs: number | null;
  configRevision?: number | null;
  probedAt: Date;
}

export interface ProbeOptions {
  confirmLive?: boolean;
  variantId?: string;
}

export interface ProbeEvidenceSummary {
  siteHealth: "healthy" | "unhealthy" | "unknown";
  modelListed: "listed" | "not_listed" | "unknown";
  capabilityProbe: ProbeStatus | "not_run";
}

export function summarizeProbe(result: Pick<ProbeResult, "mode" | "status" | "message">): ProbeEvidenceSummary {
  const siteHealth = result.message === "listed_by_provider_not_callable" || result.message === "not_listed_by_provider"
    ? "healthy"
    : result.status === "forbidden" || result.status === "temporary_failure"
      ? "unhealthy"
      : "unknown";
  const modelListed = result.message === "listed_by_provider_not_callable"
    ? "listed"
    : result.message === "not_listed_by_provider"
      ? "not_listed"
      : "unknown";
  return {
    siteHealth,
    modelListed,
    capabilityProbe: result.mode === "safe" ? "not_run" : result.status,
  };
}

function sanitize(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/Bearer\s+[^\s,]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

async function readError(response: Response): Promise<{ code: string | null; message: string | null }> {
  const text = await response.text().catch(() => "");
  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    const error = payload.error && typeof payload.error === "object"
      ? payload.error as Record<string, unknown>
      : payload;
    return {
      code: typeof error.code === "string" ? sanitize(error.code) : null,
      message: sanitize(typeof error.message === "string" ? error.message : text),
    };
  } catch {
    return { code: null, message: sanitize(text) };
  }
}

async function persist(result: ProbeResult, adapterId: string | null, adapterVersion: string | null): Promise<void> {
  if (result.mode === "none") return;
  await db.insert(modelCapabilityProbes).values({
    id: randomUUID(),
    modelId: result.modelId,
    capability: result.capability,
    mode: result.mode,
    status: result.status,
    httpStatus: result.httpStatus,
    upstreamCode: result.upstreamCode,
    message: result.message,
    requestId: result.requestId,
    retryAfter: result.retryAfter,
    latencyMs: result.latencyMs,
    adapterId,
    adapterVersion,
    configRevision: result.configRevision ?? null,
    checkedAt: result.probedAt,
  });
}

function emptyResult(modelId: string, mode: ProbeMode, capability = "unknown"): ProbeResult {
  return {
    modelId,
    capability,
    mode,
    status: "unknown",
    httpStatus: null,
    upstreamCode: null,
    message: null,
    requestId: null,
    retryAfter: null,
    latencyMs: null,
    probedAt: new Date(),
  };
}

function parseStoredArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function capabilityForModality(modality: string, endpointCaps?: string | null): string | null {
  const caps = parseStoredArray(endpointCaps);
  return modality === "image"
    ? "image.generation"
    : modality === "audio"
      ? (caps.includes("stt") || caps.includes("audio.transcription")) && !caps.includes("tts")
        ? "audio.transcription"
        : "audio.speech"
      : modality === "video"
        ? "video.submit"
        : null;
}

function parseStoredObject(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function probeError(error: unknown): { status: ProbeStatus; httpStatus: number | null; code: string | null; message: string | null } {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const info = value.info && typeof value.info === "object" ? value.info as Record<string, unknown> : value;
  const httpStatus = typeof info.status === "number" ? info.status : null;
  const message = sanitize(typeof info.message === "string" ? info.message : error instanceof Error ? error.message : String(error));
  const code = sanitize(typeof info.code === "string" ? info.code : null);
  return {
    status: httpStatus ? classifyProbeFailure(httpStatus, message ?? undefined) : code === "video_protocol_unverified" ? "request_invalid" : "temporary_failure",
    httpStatus,
    code,
    message,
  };
}

async function liveProbeMedia(
  row: {
    id: string;
    rawName: string;
    modality: string;
    adapterId: string | null;
    adapterVersion: string | null;
    baseUrl: string;
    apiKey: string;
    configRevision: number | null;
    adapterConfig?: string | null;
    endpointCaps?: string | null;
  },
  result: ProbeResult,
  options: ProbeOptions,
): Promise<void> {
  const capability = capabilityForModality(row.modality, row.endpointCaps);
  if (!capability) {
    result.status = "unsupported";
    result.message = "live_probe_not_supported_for_modality";
    return;
  }

  result.capability = capability;
  const adapter = getAdapter(normalizeAdapterId(row.adapterId) ?? row.adapterId ?? "");
  if (!adapter || !adapter.capabilities.includes(capability)) {
    result.status = "unsupported";
    result.message = "adapter_does_not_support_modality";
    return;
  }

  let adapterConfig = parseStoredObject(row.adapterConfig ?? null);
  if (row.modality === "video") {
    const variantRows = await db
      .select({ id: variants.id, adapterConfig: variants.adapterConfig, adapterConfigStatus: variants.adapterConfigStatus })
      .from(variants)
      .where(eq(variants.modelId, row.id));
    const variant = options.variantId
      ? variantRows.find((item) => item.id === options.variantId)
      : variantRows.length === 1 ? variantRows[0] : undefined;
    if (!variant) {
      result.status = "unknown";
      result.message = variantRows.length > 1 ? "live_probe_variant_required" : "live_probe_callable_variant_required";
      return;
    }
    if (variant.adapterConfigStatus !== "valid") {
      result.status = "unknown";
      result.message = "live_probe_variant_config_not_validated";
      return;
    }
    adapterConfig = parseStoredObject(variant.adapterConfig);
  }

  const context = {
    targetUrl: row.baseUrl,
    apiKey: row.apiKey,
    model: row.rawName,
    ...(adapterConfig ? { config: adapterConfig } : {}),
  };
  const started = Date.now();

  try {
    if (row.modality === "image" && adapter.forwardImageGeneration) {
      const response = await adapter.forwardImageGeneration({
        model: row.rawName,
        prompt: "OpenHub verification",
        n: 1,
      }, context);
      result.status = Array.isArray(response?.data) ? "available" : "contract_mismatch";
      result.message = result.status === "available" ? "image_probe_succeeded" : "image_response_missing_data";
    } else if (row.modality === "audio" && capability === "audio.transcription") {
      result.status = "unknown";
      result.message = "live_probe_requires_audio_fixture";
    } else if (row.modality === "audio" && adapter.forwardAudioSpeech) {
      const response = await adapter.forwardAudioSpeech({
        model: row.rawName,
        input: "OpenHub verification",
        voice: "alloy",
      }, context);
      result.status = response.byteLength > 0 ? "available" : "contract_mismatch";
      result.message = result.status === "available" ? "audio_probe_succeeded" : "audio_response_empty";
    } else if (row.modality === "video" && adapter.submitVideoTask && adapter.queryVideoTask) {
      const submitted = await adapter.submitVideoTask({
        model: row.rawName,
        prompt: "OpenHub verification",
        duration: 1,
        aspect_ratio: "1:1",
        resolution: "480p",
      }, context);
      if (!submitted.siteTaskId) {
        result.status = "contract_mismatch";
        result.message = "video_submit_response_missing_task_id";
      } else {
        const queried = await adapter.queryVideoTask(submitted.siteTaskId, context);
        result.status = queried.status === "failed" ? "request_invalid" : "available";
        result.message = queried.status === "failed" ? "video_probe_task_failed" : "video_submit_query_succeeded";
      }
    } else {
      result.status = "unsupported";
      result.message = "adapter_does_not_implement_probe_path";
    }
  } catch (error) {
    const failure = probeError(error);
    result.status = failure.status;
    result.httpStatus = failure.httpStatus;
    result.upstreamCode = failure.code;
    result.message = failure.message;
  }
  result.latencyMs = Date.now() - started;
}

export async function probeModel(modelId: string, mode: ProbeMode = "safe", options: ProbeOptions = {}): Promise<ProbeResult> {
  const [row] = await db
    .select({
      id: models.id,
      rawName: models.rawName,
      modality: models.modality,
      adapterId: models.adapterId,
      adapterVersion: models.adapterVersion,
      baseUrl: sites.baseUrl,
      apiKeyEnc: sites.apiKeyEnc,
      apiKeyIv: sites.apiKeyIv,
      configRevision: sites.configRevision,
      endpointCaps: models.endpointCaps,
    })
    .from(models)
    .leftJoin(sites, eq(models.siteId, sites.id))
    .where(eq(models.id, modelId))
    .limit(1);

  if (mode === "none") return emptyResult(modelId, mode);
  if (!row || !row.baseUrl || !row.apiKeyEnc || !row.apiKeyIv) {
    const result = emptyResult(modelId, mode);
    result.status = "unsupported";
    result.message = "model_or_site_not_found";
    await persist(result, row?.adapterId ?? null, row?.adapterVersion ?? null);
    return result;
  }

  const result = emptyResult(modelId, mode);
  result.configRevision = row.configRevision;
  if (mode === "full" && !options.confirmLive) {
    result.status = "unknown";
    result.message = "live_probe_confirmation_required";
    await persist(result, row.adapterId, row.adapterVersion);
    return result;
  }
  const apiKey = await decrypt(row.apiKeyEnc, row.apiKeyIv, getMasterKey());
  try {
    if (mode === "safe") {
      const adapter = getAdapter(normalizeAdapterId(row.adapterId) ?? row.adapterId);
      if (!adapter || !adapter.capabilities.includes("models.list")) {
        result.status = "unsupported";
        result.message = "safe_probe_not_supported_by_adapter";
        await persist(result, row.adapterId, row.adapterVersion);
        return result;
      }
      const started = Date.now();
      let listed: boolean | null = null;
      if (adapter.discoverModels) {
        const discovered = await adapter.discoverModels({ targetUrl: row.baseUrl, apiKey });
        listed = discovered.some((model) => model.id === row.rawName);
      } else {
        const healthy = await adapter.healthCheck({ targetUrl: row.baseUrl, apiKey });
        if (!healthy) {
          result.status = "temporary_failure";
          result.message = "site_health_failed";
          result.latencyMs = Date.now() - started;
          await persist(result, row.adapterId, row.adapterVersion);
          return result;
        }
      }
      result.latencyMs = Date.now() - started;
      result.status = "unknown";
      result.message = listed === true
        ? "listed_by_provider_not_callable"
        : listed === false
          ? "not_listed_by_provider"
          : "site_health_only";
      await persist(result, row.adapterId, row.adapterVersion);
      return result;
    }

    if (row.modality !== "llm") {
      result.capability = capabilityForModality(row.modality, row.endpointCaps) ?? "unknown";
      const apiKeyForProbe = apiKey;
      await liveProbeMedia({
        id: row.id,
        rawName: row.rawName,
        modality: row.modality,
        adapterId: row.adapterId,
        adapterVersion: row.adapterVersion,
        baseUrl: row.baseUrl,
        apiKey: apiKeyForProbe,
        configRevision: row.configRevision,
        endpointCaps: row.endpointCaps,
      }, result, options);
      await persist(result, row.adapterId, row.adapterVersion);
      return result;
    }

    const started = Date.now();
    const response = await fetch(providerV1Url(row.baseUrl, "/v1/chat/completions"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: row.rawName,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 32,
        stream: false,
      }),
      signal: AbortSignal.timeout(10000),
    });
    result.latencyMs = Date.now() - started;
    result.httpStatus = response.status;
    result.requestId = response.headers.get("x-request-id");
    result.retryAfter = response.headers.get("retry-after");
    if (!response.ok) {
      const error = await readError(response);
      result.upstreamCode = error.code;
      result.message = error.message;
      result.status = classifyProbeFailure(response.status, error.message ?? undefined);
    } else {
      const payload = await response.json().catch(() => null) as { choices?: unknown } | null;
      if (!Array.isArray(payload?.choices)) {
        result.status = "contract_mismatch";
        result.message = "chat_response_missing_choices";
      } else {
        result.status = "available";
        result.capability = "chat";
        result.message = "chat_probe_succeeded";
      }
    }
  } catch (error) {
    result.status = "temporary_failure";
    result.message = sanitize(error instanceof Error ? error.message : String(error));
  }

  await persist(result, row.adapterId, row.adapterVersion);
  return result;
}

export async function probeUnknownModels(mode: ProbeMode = "safe", limit = 20): Promise<ProbeResult[]> {
  const rows = await db.select({ id: models.id }).from(models).limit(Math.max(1, Math.min(limit, 100)));
  const results: ProbeResult[] = [];
  for (const row of rows) results.push(await probeModel(row.id, mode));
  return results;
}
