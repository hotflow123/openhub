import { Hono } from "hono";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "../../db/index";
import { sites, models, type ModelRow } from "../../db/schema/index";
import { withAdminAuth } from "./_with-auth";

const modelsRoute = new Hono();
withAdminAuth(modelsRoute);

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
      endpointCaps: models.endpointCaps,
      paramCaps: models.paramCaps,
      adapterId: models.adapterId,
      catalogModelId: models.catalogModelId,
      catalogMatchSource: models.catalogMatchSource,
      catalogMatchConfidence: models.catalogMatchConfidence,
      catalogSyncedAt: models.catalogSyncedAt,
      schemaEndpointId: models.schemaEndpointId,
      schemaMatchSource: models.schemaMatchSource,
      schemaSyncedAt: models.schemaSyncedAt,
      // fal.ai 完整快照
      falParametersSnapshot: models.falParametersSnapshot,
      falInputSchemaSnapshot: models.falInputSchemaSnapshot,
      falPricing: models.falPricing,
      falDescription: models.falDescription,
      falSource: models.falSource,
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
          endpointCaps: models.endpointCaps,
          paramCaps: models.paramCaps,
          adapterId: models.adapterId,
          catalogModelId: models.catalogModelId,
          catalogMatchSource: models.catalogMatchSource,
          catalogMatchConfidence: models.catalogMatchConfidence,
          catalogSyncedAt: models.catalogSyncedAt,
          schemaEndpointId: models.schemaEndpointId,
          schemaMatchSource: models.schemaMatchSource,
          schemaSyncedAt: models.schemaSyncedAt,
          falParametersSnapshot: models.falParametersSnapshot,
          falInputSchemaSnapshot: models.falInputSchemaSnapshot,
          falPricing: models.falPricing,
          falDescription: models.falDescription,
          falSource: models.falSource,
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
        })
        .from(models)
        .leftJoin(sites, eq(models.siteId, sites.id))
        .where(eq(models.siteId, siteId))
    : await baseQuery;

  return c.json({ data: rows });
});

modelsRoute.get("/models/:id", async (c) => {
  const id = c.req.param("id");
  const [row] = await db.select().from(models).where(eq(models.id, id)).limit(1);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ data: row });
});

const PatchModelSchema = z.object({
  displayName: z.string().nullable().optional(),
  vendor: z.string().nullable().optional(),
  family: z.string().nullable().optional(),
  modelVersion: z.string().nullable().optional(),
  modality: z.enum(["llm", "image", "audio", "video", "embedding"]).optional(),
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
  // fal 快照字段（JSON 字符串）
  falPricing: z.string().nullable().optional(),
  falDescription: z.string().nullable().optional(),
  falParametersSnapshot: z.string().nullable().optional(),
  falInputSchemaSnapshot: z.string().nullable().optional(),
  schemaEndpointId: z.string().nullable().optional(),
  schemaMatchSource: z.string().nullable().optional(),
  videoDurationEnum: z.string().nullable().optional(),
  videoAspectRatios: z.string().nullable().optional(),
  videoResolutions: z.string().nullable().optional(),
  videoRequiredParams: z.string().nullable().optional(),
  videoOptionalParams: z.string().nullable().optional(),
  generateAudioSupported: z.number().int().min(0).max(1).optional(),
  maxReferenceImages: z.number().int().nullable().optional(),
  maxReferenceVideos: z.number().int().nullable().optional(),
  maxReferenceAudios: z.number().int().nullable().optional(),
  status: z.enum(["active", "degraded", "offline", "unknown"]).optional(),
  statusReason: z.string().nullable().optional(),
});

modelsRoute.patch("/models/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = PatchModelSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

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
  if (parsed.data.displayName !== undefined) update.displayName = parsed.data.displayName;
  if (parsed.data.vendor !== undefined) update.vendor = parsed.data.vendor;
  if (parsed.data.family !== undefined) update.family = parsed.data.family;
  if (parsed.data.modelVersion !== undefined) update.modelVersion = parsed.data.modelVersion;

  // 状态
  if (parsed.data.status !== undefined) update.status = parsed.data.status;
  if (parsed.data.statusReason !== undefined) update.statusReason = parsed.data.statusReason;

  // fal.ai 快照（可手动覆盖）
  if (parsed.data.falPricing !== undefined) update.falPricing = parsed.data.falPricing;
  if (parsed.data.falDescription !== undefined) update.falDescription = parsed.data.falDescription;
  if (parsed.data.falParametersSnapshot !== undefined) update.falParametersSnapshot = parsed.data.falParametersSnapshot;
  if (parsed.data.falInputSchemaSnapshot !== undefined) update.falInputSchemaSnapshot = parsed.data.falInputSchemaSnapshot;
  if (parsed.data.schemaEndpointId !== undefined) {
    update.schemaEndpointId = parsed.data.schemaEndpointId;
    if (parsed.data.schemaEndpointId === null) {
      update.schemaSyncedAt = null;
      update.schemaMatchSource = null;
    }
  }
  if (parsed.data.schemaMatchSource !== undefined) update.schemaMatchSource = parsed.data.schemaMatchSource;
  if (parsed.data.videoDurationEnum !== undefined) update.videoDurationEnum = parsed.data.videoDurationEnum;
  if (parsed.data.videoAspectRatios !== undefined) update.videoAspectRatios = parsed.data.videoAspectRatios;
  if (parsed.data.videoResolutions !== undefined) update.videoResolutions = parsed.data.videoResolutions;
  if (parsed.data.videoRequiredParams !== undefined) update.videoRequiredParams = parsed.data.videoRequiredParams;
  if (parsed.data.videoOptionalParams !== undefined) update.videoOptionalParams = parsed.data.videoOptionalParams;
  if (parsed.data.generateAudioSupported !== undefined) update.generateAudioSupported = parsed.data.generateAudioSupported;
  if (parsed.data.maxReferenceImages !== undefined) update.maxReferenceImages = parsed.data.maxReferenceImages;
  if (parsed.data.maxReferenceVideos !== undefined) update.maxReferenceVideos = parsed.data.maxReferenceVideos;
  if (parsed.data.maxReferenceAudios !== undefined) update.maxReferenceAudios = parsed.data.maxReferenceAudios;

  if (capsTouched) update.capsOverridden = 1;

  update.updatedAt = new Date();

  const [row] = await db
    .update(models)
    .set(update)
    .where(eq(models.id, id))
    .returning();
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ data: row });
});

modelsRoute.delete("/models/:id", async (c) => {
  const id = c.req.param("id");
  await db.delete(models).where(eq(models.id, id));
  return c.json({ data: { id, deleted: true } });
});

export default modelsRoute;
