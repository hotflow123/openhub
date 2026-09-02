import { Hono } from "hono";
import { z } from "zod";
import { eq, desc, inArray } from "drizzle-orm";
import { db } from "../../db/index";
import { sites, models, modelCapabilityProbes, modelParameterTemplates, type ModelRow } from "../../db/schema/index";
import { withAdminAuth } from "./_with-auth";
import { writeAudit } from "../../lib/audit";
import { modelEvidenceState } from "../../lib/model-contract";
import { isProbeForCurrentConfig } from "../../engine/capability/status";

const modelsRoute = new Hono();
withAdminAuth(modelsRoute);

function runtimeCapabilityForModality(modality: string): string | null {
  return modality === "llm"
    ? "chat"
    : modality === "image"
      ? "image.generation"
      : modality === "audio"
        ? "audio.speech"
        : modality === "video"
          ? "video.submit"
          : modality === "embedding"
            ? "embedding"
            : null;
}

modelsRoute.get("/models", async (c) => {
  const siteId = c.req.query("site_id");
  const baseQuery = db
    .select({
      id: models.id,
      siteId: models.siteId,
      rawName: models.rawName,
      displayName: models.displayName,
      vendor: models.vendor,
      family: models.family,
      modelVersion: models.modelVersion,
      modality: models.modality,
      modalitySource: models.modalitySource,
      modalityConfidence: models.modalityConfidence,
      modalityReason: models.modalityReason,
      endpointCaps: models.endpointCaps,
      paramCaps: models.paramCaps,
      adapterId: models.adapterId,
      adapterSource: models.adapterSource,
      catalogModelId: models.catalogModelId,
      catalogMatchSource: models.catalogMatchSource,
      catalogMatchConfidence: models.catalogMatchConfidence,
      catalogSyncedAt: models.catalogSyncedAt,
      schemaEndpointId: models.schemaEndpointId,
      schemaMatchSource: models.schemaMatchSource,
      schemaMatchStatus: models.schemaMatchStatus,
      schemaMatchConfidence: models.schemaMatchConfidence,
      schemaMatchReason: models.schemaMatchReason,
      schemaSyncedAt: models.schemaSyncedAt,
      // fal.ai 完整快照
      falParametersSnapshot: models.falParametersSnapshot,
      falInputSchemaSnapshot: models.falInputSchemaSnapshot,
      falPricing: models.falPricing,
       falDescription: models.falDescription,
       falSource: models.falSource,
       videoContractSnapshot: models.videoContractSnapshot,
       videoContractSource: models.videoContractSource,
       videoContractStatus: models.videoContractStatus,
       videoContractReason: models.videoContractReason,
       videoContractSyncedAt: models.videoContractSyncedAt,
       capabilityContractSnapshot: models.capabilityContractSnapshot,
       capabilityContractSource: models.capabilityContractSource,
       capabilityContractStatus: models.capabilityContractStatus,
       capabilityContractReason: models.capabilityContractReason,
       capabilityContractSyncedAt: models.capabilityContractSyncedAt,
       modelIdentityStatus: models.modelIdentityStatus,
       modelIdentitySource: models.modelIdentitySource,
       modelIdentityReason: models.modelIdentityReason,
       adapterVersion: models.adapterVersion,
       adapterHash: models.adapterHash,
       adapterValidationStatus: models.adapterValidationStatus,
       adapterValidationReason: models.adapterValidationReason,
      // 视频参数
      videoDurationEnum: models.videoDurationEnum,
      videoAspectRatios: models.videoAspectRatios,
      videoResolutions: models.videoResolutions,
      videoRequiredParams: models.videoRequiredParams,
      videoOptionalParams: models.videoOptionalParams,
      generateAudioSupported: models.generateAudioSupported,
      // LLM 能力
      contextWindow: models.contextWindow,
      maxOutputTokens: models.maxOutputTokens,
      supportsReasoning: models.supportsReasoning,
      supportsFunctionCalling: models.supportsFunctionCalling,
      supportsVision: models.supportsVision,
      // 媒体限制
      supportedSizes: models.supportedSizes,
      maxDurationSec: models.maxDurationSec,
      maxReferenceImages: models.maxReferenceImages,
      maxReferenceVideos: models.maxReferenceVideos,
      maxReferenceAudios: models.maxReferenceAudios,
      supportsStream: models.supportsStream,
      requiresAsync: models.requiresAsync,
      capsOverridden: models.capsOverridden,
      lastLatencyMs: models.lastLatencyMs,
      avgLatencyMs: models.avgLatencyMs,
      status: models.status,
      statusReason: models.statusReason,
      createdAt: models.createdAt,
      updatedAt: models.updatedAt,
      siteName: sites.name,
      siteConfigRevision: sites.configRevision,
    })
    .from(models)
    .leftJoin(sites, eq(models.siteId, sites.id));

  const rows = siteId
    ? await db
        .select({
          id: models.id,
          siteId: models.siteId,
          rawName: models.rawName,
          displayName: models.displayName,
          vendor: models.vendor,
          family: models.family,
          modelVersion: models.modelVersion,
          modality: models.modality,
          modalitySource: models.modalitySource,
          modalityConfidence: models.modalityConfidence,
          modalityReason: models.modalityReason,
          endpointCaps: models.endpointCaps,
          paramCaps: models.paramCaps,
          adapterId: models.adapterId,
          adapterSource: models.adapterSource,
          catalogModelId: models.catalogModelId,
          catalogMatchSource: models.catalogMatchSource,
          catalogMatchConfidence: models.catalogMatchConfidence,
          catalogSyncedAt: models.catalogSyncedAt,
          schemaEndpointId: models.schemaEndpointId,
          schemaMatchSource: models.schemaMatchSource,
          schemaMatchStatus: models.schemaMatchStatus,
          schemaMatchConfidence: models.schemaMatchConfidence,
          schemaMatchReason: models.schemaMatchReason,
          schemaSyncedAt: models.schemaSyncedAt,
          falParametersSnapshot: models.falParametersSnapshot,
          falInputSchemaSnapshot: models.falInputSchemaSnapshot,
          falPricing: models.falPricing,
           falDescription: models.falDescription,
           falSource: models.falSource,
           videoContractSnapshot: models.videoContractSnapshot,
           videoContractSource: models.videoContractSource,
           videoContractStatus: models.videoContractStatus,
            videoContractReason: models.videoContractReason,
            videoContractSyncedAt: models.videoContractSyncedAt,
           capabilityContractSnapshot: models.capabilityContractSnapshot,
           capabilityContractSource: models.capabilityContractSource,
           capabilityContractStatus: models.capabilityContractStatus,
           capabilityContractReason: models.capabilityContractReason,
           capabilityContractSyncedAt: models.capabilityContractSyncedAt,
           modelIdentityStatus: models.modelIdentityStatus,
           modelIdentitySource: models.modelIdentitySource,
           modelIdentityReason: models.modelIdentityReason,
           adapterVersion: models.adapterVersion,
           adapterHash: models.adapterHash,
           adapterValidationStatus: models.adapterValidationStatus,
           adapterValidationReason: models.adapterValidationReason,
          videoDurationEnum: models.videoDurationEnum,
          videoAspectRatios: models.videoAspectRatios,
          videoResolutions: models.videoResolutions,
          videoRequiredParams: models.videoRequiredParams,
          videoOptionalParams: models.videoOptionalParams,
          generateAudioSupported: models.generateAudioSupported,
          contextWindow: models.contextWindow,
          maxOutputTokens: models.maxOutputTokens,
          supportsReasoning: models.supportsReasoning,
          supportsFunctionCalling: models.supportsFunctionCalling,
          supportsVision: models.supportsVision,
          supportedSizes: models.supportedSizes,
          maxDurationSec: models.maxDurationSec,
          maxReferenceImages: models.maxReferenceImages,
          maxReferenceVideos: models.maxReferenceVideos,
          maxReferenceAudios: models.maxReferenceAudios,
          supportsStream: models.supportsStream,
          requiresAsync: models.requiresAsync,
          capsOverridden: models.capsOverridden,
          lastLatencyMs: models.lastLatencyMs,
          avgLatencyMs: models.avgLatencyMs,
          status: models.status,
          statusReason: models.statusReason,
          createdAt: models.createdAt,
          updatedAt: models.updatedAt,
          siteName: sites.name,
          siteConfigRevision: sites.configRevision,
        })
        .from(models)
        .leftJoin(sites, eq(models.siteId, sites.id))
        .where(eq(models.siteId, siteId))
    : await baseQuery;

  const probeRows = rows.length
    ? await db
      .select()
      .from(modelCapabilityProbes)
      .where(inArray(modelCapabilityProbes.modelId, rows.map((row) => row.id)))
      .orderBy(desc(modelCapabilityProbes.checkedAt))
    : [];
  const latestProbe = new Map<string, typeof probeRows[number]>();
  for (const probe of probeRows) {
    const modelRow = rows.find((row) => row.id === probe.modelId);
    if (!isProbeForCurrentConfig(probe.configRevision, modelRow?.siteConfigRevision)) continue;
    if (!latestProbe.has(`${probe.modelId}:${probe.capability}`)) {
      latestProbe.set(`${probe.modelId}:${probe.capability}`, probe);
    }
  }
  return c.json({
    data: rows.map((row) => ({
      ...row,
       ...modelEvidenceState(row, (() => {
         const capability = runtimeCapabilityForModality(row.modality);
         const probe = capability
           ? latestProbe.get(`${row.id}:${capability}`)
           : undefined;
         return probe ? { status: probe.status, capability: probe.capability, requiredCapability: capability } : null;
       })()),
      runtimeProbes: Array.from(latestProbe.values())
        .filter((probe) => probe.modelId === row.id)
        .map((probe) => ({
          capability: probe.capability,
          mode: probe.mode,
          status: probe.status,
          httpStatus: probe.httpStatus,
          upstreamCode: probe.upstreamCode,
          message: probe.message,
          requestId: probe.requestId,
          retryAfter: probe.retryAfter,
          latencyMs: probe.latencyMs,
          checkedAt: probe.checkedAt,
        })),
    })),
  });
});

modelsRoute.get("/models/:id", async (c) => {
  const id = c.req.param("id");
  const [row] = await db.select().from(models).where(eq(models.id, id)).limit(1);
  if (!row) return c.json({ error: "Not found" }, 404);
  const [site] = await db.select({ configRevision: sites.configRevision }).from(sites).where(eq(sites.id, row.siteId)).limit(1);
  const probes = await db
    .select()
    .from(modelCapabilityProbes)
    .where(eq(modelCapabilityProbes.modelId, id))
    .orderBy(desc(modelCapabilityProbes.checkedAt))
    .limit(20);
  const capability = runtimeCapabilityForModality(row.modality);
  const runtimeProbe = probes.find((probe) => capability
    && probe.capability === capability
    && isProbeForCurrentConfig(probe.configRevision, site?.configRevision));
  const templates = await db.select().from(modelParameterTemplates).where(eq(modelParameterTemplates.modelId, id));
  return c.json({ data: { ...row, ...modelEvidenceState(row, runtimeProbe ?? null), runtimeProbes: probes, parameterTemplates: templates } });
});

modelsRoute.get("/models/:id/parameter-templates", async (c) => {
  const id = c.req.param("id");
  const templates = await db.select().from(modelParameterTemplates).where(eq(modelParameterTemplates.modelId, id));
  return c.json({ data: templates });
});

modelsRoute.post("/models/:id/parameter-templates/:templateId/apply", async (c) => {
  return c.json({ error: { message: "A Variant is required to apply a parameter template", code: "parameter_template_variant_required" } }, 400);
});

const PatchModelSchema = z.object({
  displayName: z.string().nullable().optional(),
  vendor: z.string().nullable().optional(),
  family: z.string().nullable().optional(),
  modelVersion: z.string().nullable().optional(),
  modality: z.enum(["llm", "image", "audio", "video", "embedding", "unknown"]).optional(),
  adapterId: z.string().optional(),
  endpointCaps: z.array(z.string()).optional(),
  paramCaps: z.array(z.string()).optional(),
  contextWindow: z.number().int().nullable().optional(),
  maxOutputTokens: z.number().int().nullable().optional(),
  supportsReasoning: z.number().int().min(0).max(1).optional(),
  supportsFunctionCalling: z.number().int().min(0).max(1).optional(),
  supportsVision: z.number().int().min(0).max(1).optional(),
  supportedSizes: z.array(z.string()).nullable().optional(),
  maxDurationSec: z.number().int().nullable().optional(),
  supportsStream: z.number().int().min(0).max(1).optional(),
  requiresAsync: z.number().int().min(0).max(1).optional(),
  // Schema associations are confirmed only by the audited wizard action.
  // The generic editor may clear an association, but cannot create one.
  schemaEndpointId: z.null().optional(),
  status: z.enum(["active", "degraded", "offline", "unknown"]).optional(),
  statusReason: z.string().nullable().optional(),
});

modelsRoute.patch("/models/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const schemaManagedFields = [
    "falPricing",
    "falDescription",
    "falParametersSnapshot",
    "falInputSchemaSnapshot",
    "schemaMatchSource",
    "schemaMatchStatus",
    "schemaMatchConfidence",
    "schemaMatchReason",
    "videoDurationEnum",
    "videoAspectRatios",
    "videoResolutions",
    "videoRequiredParams",
    "videoOptionalParams",
    "generateAudioSupported",
    "maxReferenceImages",
    "maxReferenceVideos",
    "maxReferenceAudios",
  ];
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    schemaManagedFields.some((field) => Object.prototype.hasOwnProperty.call(body, field))
  ) {
    return c.json(
      { error: { message: "Fal schema fields are managed by the wizard", code: "schema_evidence_read_only" } },
      400,
    );
  }
  const parsed = PatchModelSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  if (parsed.data.adapterId !== undefined) {
    const { getAdapter, normalizeAdapterId } = await import("../../engine/adapter");
    const canonicalAdapterId = normalizeAdapterId(parsed.data.adapterId) ?? parsed.data.adapterId;
    if (!getAdapter(canonicalAdapterId)) {
      return c.json({ error: { message: `Unknown adapter: ${parsed.data.adapterId}`, code: "adapter_not_found" } }, 400);
    }
    parsed.data.adapterId = canonicalAdapterId;
  }

  const update: Partial<ModelRow> = {};
  // 标记能力相关字段被人工修改
  let capsTouched = false;
  if (parsed.data.endpointCaps !== undefined) {
    update.endpointCaps = JSON.stringify(parsed.data.endpointCaps);
    capsTouched = true;
  }
  if (parsed.data.paramCaps !== undefined) {
    update.paramCaps = JSON.stringify(parsed.data.paramCaps);
    capsTouched = true;
  }
  if (parsed.data.modality !== undefined) {
    update.modality = parsed.data.modality;
    capsTouched = true;
  }
  if (parsed.data.contextWindow !== undefined) {
    update.contextWindow = parsed.data.contextWindow;
    capsTouched = true;
  }
  if (parsed.data.maxOutputTokens !== undefined) {
    update.maxOutputTokens = parsed.data.maxOutputTokens;
    capsTouched = true;
  }
  if (parsed.data.supportsReasoning !== undefined) {
    update.supportsReasoning = parsed.data.supportsReasoning;
    capsTouched = true;
  }
  if (parsed.data.supportsFunctionCalling !== undefined) {
    update.supportsFunctionCalling = parsed.data.supportsFunctionCalling;
    capsTouched = true;
  }
  if (parsed.data.supportsVision !== undefined) {
    update.supportsVision = parsed.data.supportsVision;
    capsTouched = true;
  }
  if (parsed.data.supportedSizes !== undefined) {
    update.supportedSizes = parsed.data.supportedSizes
      ? JSON.stringify(parsed.data.supportedSizes)
      : null;
    capsTouched = true;
  }
  if (parsed.data.maxDurationSec !== undefined) {
    update.maxDurationSec = parsed.data.maxDurationSec;
    capsTouched = true;
  }
  if (parsed.data.supportsStream !== undefined) {
    update.supportsStream = parsed.data.supportsStream;
    capsTouched = true;
  }
  if (parsed.data.requiresAsync !== undefined) {
    update.requiresAsync = parsed.data.requiresAsync;
    capsTouched = true;
  }

  // 命名元数据
  if (parsed.data.adapterId !== undefined) {
    update.adapterId = parsed.data.adapterId;
    update.adapterSource = "manual";
  }
  if (parsed.data.displayName !== undefined) update.displayName = parsed.data.displayName;
  if (parsed.data.vendor !== undefined) update.vendor = parsed.data.vendor;
  if (parsed.data.family !== undefined) update.family = parsed.data.family;
  if (parsed.data.modelVersion !== undefined) update.modelVersion = parsed.data.modelVersion;

  // 状态
  if (parsed.data.status !== undefined) update.status = parsed.data.status;
  if (parsed.data.statusReason !== undefined) update.statusReason = parsed.data.statusReason;

  if (parsed.data.schemaEndpointId !== undefined) {
    update.schemaEndpointId = null;
    update.schemaSyncedAt = null;
    update.schemaMatchSource = null;
    update.schemaMatchStatus = "unmatched";
    update.schemaMatchConfidence = null;
    update.schemaMatchReason = "cleared_by_admin";
    update.falParametersSnapshot = null;
    update.falInputSchemaSnapshot = null;
    update.falPricing = null;
    update.falDescription = null;
    update.falSource = null;
    update.videoDurationEnum = null;
    update.videoAspectRatios = null;
    update.videoResolutions = null;
    update.videoRequiredParams = null;
    update.videoOptionalParams = null;
    update.generateAudioSupported = 0;
    update.maxReferenceImages = null;
    update.maxReferenceVideos = null;
    update.maxReferenceAudios = null;
  }
  if (capsTouched) {
    update.capsOverridden = 1;
    update.modalitySource = "manual";
    update.modalityConfidence = "high";
    update.modalityReason = "admin_override";
  }

  update.updatedAt = new Date();

  const [row] = await db
    .update(models)
    .set(update)
    .where(eq(models.id, id))
    .returning();
  if (!row) return c.json({ error: "Not found" }, 404);
  if (parsed.data.schemaEndpointId === null) {
    await writeAudit({
      actor: "admin",
      action: "model.schema.clear",
      resourceType: "model",
      resourceId: id,
    });
  }
  if (parsed.data.adapterId !== undefined) {
    await writeAudit({
      actor: "admin",
      action: "model.adapter.override",
      resourceType: "model",
      resourceId: id,
      payload: JSON.stringify({ adapterId: parsed.data.adapterId, adapterSource: "manual" }),
    });
  }
  return c.json({ data: { ...row, ...modelEvidenceState(row, null) } });
});

modelsRoute.delete("/models/:id", async (c) => {
  const id = c.req.param("id");
  await db.delete(models).where(eq(models.id, id));
  return c.json({ data: { id, deleted: true } });
});

export default modelsRoute;
