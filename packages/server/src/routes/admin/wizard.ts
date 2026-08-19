import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../../db/index";
import {
  models,
  variants,
  sites,
  modelCatalog,
  modelSchemaCatalog,
} from "../../db/schema/index";
import { withAdminAuth } from "./_with-auth";
import { writeAudit } from "../../lib/audit";
import { inferModelCapability, type ModelCapability } from "../../engine/llm-model-infer";
import { extractInputSchemaCapabilities } from "../../lib/fal-input-schema";
import {
  getAdapter,
  listAdapters,
  normalizeAdapterId,
  validateAdapterCapability,
  validateAdapterConfig,
} from "../../engine/adapter";
import {
  validateVariantLimits,
  validateParameterLimitsAgainstModel,
  readModelInputContract,
} from "../../lib/model-contract";

const wizard = new Hono();
withAdminAuth(wizard);

const ModalitySchema = z.enum(["llm", "embedding", "image", "audio", "video"]);

wizard.get("/wizard/models", async (c) => {
  const unknownModels = await db.select({ id: models.id, siteId: models.siteId, rawName: models.rawName, displayName: models.displayName, status: models.status, adapterId: models.adapterId, siteName: sites.name, siteBaseUrl: sites.baseUrl }).from(models).leftJoin(sites, eq(models.siteId, sites.id)).where(eq(models.status, "unknown")).orderBy(models.createdAt).limit(100);
  return c.json({ data: unknownModels });
});

// ─────────────────────────────────────────────────────────────────
// Step 1 — 返回模型 + 当前 fal schema 快照
// ─────────────────────────────────────────────────────────────────
wizard.get("/wizard/:modelId/step1", async (c) => {
  const modelId = c.req.param("modelId");
  const [model] = await db
    .select({
      id: models.id,
      rawName: models.rawName,
      displayName: models.displayName,
      modality: models.modality,
      catalogModelId: models.catalogModelId,
      catalogMatchSource: models.catalogMatchSource,
      catalogMatchConfidence: models.catalogMatchConfidence,
      siteId: models.siteId,
      endpointCaps: models.endpointCaps,
      paramCaps: models.paramCaps,
      contextWindow: models.contextWindow,
      maxOutputTokens: models.maxOutputTokens,
      supportsReasoning: models.supportsReasoning,
      supportedSizes: models.supportedSizes,
      maxDurationSec: models.maxDurationSec,
      supportsStream: models.supportsStream,
      requiresAsync: models.requiresAsync,
      adapterId: models.adapterId,
      maxReferenceImages: models.maxReferenceImages,
      maxReferenceVideos: models.maxReferenceVideos,
      maxReferenceAudios: models.maxReferenceAudios,
      // fal schema 关联
      schemaEndpointId: models.schemaEndpointId,
      schemaMatchSource: models.schemaMatchSource,
      falParametersSnapshot: models.falParametersSnapshot,
      falInputSchemaSnapshot: models.falInputSchemaSnapshot,
      videoDurationEnum: models.videoDurationEnum,
      videoAspectRatios: models.videoAspectRatios,
      videoResolutions: models.videoResolutions,
      videoRequiredParams: models.videoRequiredParams,
      videoOptionalParams: models.videoOptionalParams,
      generateAudioSupported: models.generateAudioSupported,
    })
    .from(models)
    .where(eq(models.id, modelId))
    .limit(1);
  if (!model) return c.json({ error: "Model not found" }, 404);

  const modelInputContract = readModelInputContract(model);

  const [site] = await db
    .select({ name: sites.name, status: sites.status, adapterId: sites.adapterId })
    .from(sites)
    .where(eq(sites.id, model.siteId))
    .limit(1);

  // catalog 候选
  const candidates: Array<{
    catalogId: string | null;
    catalogName: string | null;
    modality: string | null;
    confidence: string | null;
    source: string | null;
  }> = [];

  if (model.catalogModelId) {
    const [catalog] = await db
      .select({
        id: modelCatalog.id,
        name: modelCatalog.name,
        modalitiesOut: modelCatalog.modalitiesOut,
      })
      .from(modelCatalog)
      .where(eq(modelCatalog.id, model.catalogModelId))
      .limit(1);

    if (catalog) {
      let modality = "llm";
      try {
        const output = JSON.parse(catalog.modalitiesOut || "[]") as string[];
        if (output.includes("video")) modality = "video";
        else if (output.includes("image")) modality = "image";
        else if (output.includes("audio")) modality = "audio";
      } catch { /* ignore */ }

      candidates.push({
        catalogId: catalog.id,
        catalogName: catalog.name,
        modality,
        confidence: model.catalogMatchConfidence,
        source: model.catalogMatchSource,
      });
    }
  }

  if (!candidates.length) {
    candidates.push({
      catalogId: null,
      catalogName: null,
      modality: model.modality,
      confidence: null,
      source: null,
    });
  }

  // 如果 catalog 匹配失败或低置信度，尝试 LLM 推理
  const catalogMatchFailed =
    candidates.length === 0 ||
    candidates.every((c) => !c.catalogId) ||
    model.catalogMatchConfidence === "low" ||
    model.catalogMatchConfidence === null;

  let inferredCapability: ModelCapability | null = null;
  if (catalogMatchFailed) {
    try {
      inferredCapability = await inferModelCapability(model.rawName);
    } catch (err) {
      console.warn(`[wizard] LLM inference failed for ${model.rawName}:`, err);
    }
  }

  // 应用推理结果到 prefill（如果推理成功且置信度高）
  let prefillModality = model.modality;
  let prefillEndpointCaps = model.endpointCaps;
  let prefillContextWindow = model.contextWindow;
  let prefillMaxOutputTokens = model.maxOutputTokens;
  let prefillSupportedSizes = model.supportedSizes;
  let prefillMaxDurationSec = model.maxDurationSec;
  let prefillSupportsReasoning = model.supportsReasoning;
  let prefillRequiresAsync = model.requiresAsync;

  if (inferredCapability && inferredCapability.confidence > 0.5) {
    // 只在推理模态不是 unknown 时才应用
    if (inferredCapability.modality !== "unknown") {
      prefillModality = inferredCapability.modality;
    }

    // LLM 能力
    if (inferredCapability.llm && inferredCapability.modality === "llm") {
      if (!prefillEndpointCaps) {
        const caps = ["chat"];
        if (inferredCapability.llm.attachment) caps.push("vision");
        if (inferredCapability.llm.toolCall) caps.push("function_calling");
        prefillEndpointCaps = JSON.stringify(caps);
      }
      prefillContextWindow = prefillContextWindow ?? inferredCapability.llm.contextWindow;
      prefillMaxOutputTokens = prefillMaxOutputTokens ?? inferredCapability.llm.outputLimit;
      prefillSupportsReasoning = prefillSupportsReasoning ?? (inferredCapability.llm.reasoning ? 1 : 0);
    }

    // 视频能力
    if (inferredCapability.video && inferredCapability.modality === "video") {
      if (!prefillEndpointCaps) {
        prefillEndpointCaps = JSON.stringify(["video_generation"]);
      }
      prefillMaxDurationSec = prefillMaxDurationSec ?? inferredCapability.video.maxDurationSec;
      prefillRequiresAsync = prefillRequiresAsync ?? (inferredCapability.video.requiresAsync ? 1 : 0);
    }

    // 图像能力
    if (inferredCapability.image && inferredCapability.modality === "image") {
      if (!prefillEndpointCaps) {
        const caps = ["image_generation"];
        if (inferredCapability.image.supportsMask) caps.push("image_editing");
        prefillEndpointCaps = JSON.stringify(caps);
      }
      if (!prefillSupportedSizes && inferredCapability.image.supportedSizes) {
        prefillSupportedSizes = JSON.stringify(inferredCapability.image.supportedSizes);
      }
    }

    // 音频能力
    if (inferredCapability.audio && inferredCapability.modality === "audio") {
      if (!prefillEndpointCaps) {
        prefillEndpointCaps = JSON.stringify(["tts"]);
      }
      prefillMaxDurationSec = prefillMaxDurationSec ?? inferredCapability.audio.maxDurationSec;
    }
  }

  return c.json({
    data: {
      modelId: model.id,
      rawName: model.rawName,
      displayName: model.displayName,
      siteName: site?.name ?? "未知站点",
      siteStatus: site?.status ?? "unknown",
      siteAdapterId: site?.adapterId ?? null,
      adapterOptions: listAdapters().map((adapter) => ({
        id: adapter.id,
        capabilities: adapter.capabilities,
      })),
      suggestedModality: prefillModality,
      candidates,
      inferredCapability,
      prefill: {
        catalogModelId: model.catalogModelId,
        catalogMatchSource: model.catalogMatchSource,
        catalogMatchConfidence: model.catalogMatchConfidence,
        endpointCaps: prefillEndpointCaps,
        paramCaps: model.paramCaps,
        contextWindow: prefillContextWindow,
        maxOutputTokens: prefillMaxOutputTokens,
        supportsReasoning: prefillSupportsReasoning,
        supportedSizes: prefillSupportedSizes,
        maxDurationSec: prefillMaxDurationSec,
        supportsStream: model.supportsStream,
        requiresAsync: prefillRequiresAsync,
        adapterId: model.adapterId,
      },
      // 当前关联的 fal schema 快照
      currentFalSchema: model.schemaEndpointId,
      falParametersSnapshot: model.falParametersSnapshot,
      // 从已保存的 falInputSchemaSnapshot 解析参考资源上限
      falInputSchemaCapabilities: extractInputSchemaCapabilities(
        model.falInputSchemaSnapshot ?? null,
        model.falParametersSnapshot ?? null,
      ),
      modelInputContract: {
        fields: modelInputContract.fields,
        requiredFields: modelInputContract.requiredFields,
        enums: modelInputContract.enums,
        totalReferenceFiles: modelInputContract.totalReferenceFiles,
        audioRequiresImageOrVideo: modelInputContract.audioRequiresImageOrVideo,
      },
      videoDurationEnum: model.videoDurationEnum,
      videoAspectRatios: model.videoAspectRatios,
      videoResolutions: model.videoResolutions,
      videoRequiredParams: model.videoRequiredParams,
      videoOptionalParams: model.videoOptionalParams,
      generateAudioSupported: model.generateAudioSupported,
    },
  });
});

// ─────────────────────────────────────────────────────────────────
// applySchema — 将 fal schema 参数应用到模型（不修改 rawName）
// 传入 fal schema endpointId，从 catalog 读取 parameters，提取并写入 models 表
// ─────────────────────────────────────────────────────────────────
const ApplySchemaSchema = z.object({
  endpointId: z.string().min(1),
  modality: ModalitySchema,
});

wizard.post("/wizard/:modelId/apply-schema", async (c) => {
  const modelId = c.req.param("modelId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = ApplySchemaSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  // 读取模型
  const [model] = await db
    .select({ id: models.id, siteId: models.siteId })
    .from(models)
    .where(eq(models.id, modelId))
    .limit(1);
  if (!model) return c.json({ error: "Model not found" }, 404);

  // 读取 fal schema catalog
  const [schema] = await db
    .select()
    .from(modelSchemaCatalog)
    .where(eq(modelSchemaCatalog.endpointId, parsed.data.endpointId))
    .limit(1);
  if (!schema) return c.json({ error: "Schema not found" }, 404);

  // 解析 parameters 数组
  let parameters: any[] = [];
  if (typeof schema.parameters === "string") {
    try {
      parameters = JSON.parse(schema.parameters);
    } catch { /* ignore */ }
  } else if (Array.isArray(schema.parameters)) {
    parameters = schema.parameters;
  }

  const params = parameters;

  // === 从 parameters[] 提取各字段 ===
  const durationParam = params.find((p) => p.name === "duration");
  const resolutionParam = params.find((p) => p.name === "resolution");
  const aspectRatioParam = params.find((p) => p.name === "aspect_ratio");
  const generateAudioParam = params.find((p) => p.name === "generate_audio");
  const imageSizeParam = params.find(
    (p) => p.name === "image_size" || p.name === "size",
  );
  const maxImagesParam = params.find(
    (p) => p.name === "max_images" || p.name === "image_count",
  );
  const maxAudioParam = params.find(
    (p) => p.name === "max_audio_files" || p.name === "audio_count",
  );
  const maxVideoParam = params.find(
    (p) => p.name === "max_video_files" || p.name === "video_count",
  );
  const requiredParams = params
    .filter((p) => p.required)
    .map((p) => p.name);
  const optionalParams = params
    .filter((p) => !p.required)
    .map((p) => p.name);

  // 解析时长
  let maxDurationSec: number | null = null;
  if (durationParam?.enum && Array.isArray(durationParam.enum)) {
    const nums = durationParam.enum
      .map((v: any) => Number(v))
      .filter((n: number) => Number.isFinite(n) && n > 0);
    if (nums.length > 0) maxDurationSec = Math.max(...nums);
  }

  // 根据 modality 决定 endpointCaps
  let endpointCaps: string;
  let supportedSizes: string | null = null;
  if (parsed.data.modality === "video") {
    endpointCaps = JSON.stringify(["video_generation"]);
  } else if (parsed.data.modality === "image") {
    const caps = ["image_generation"];
    if (params.some((p) => p.name === "mask_url" || p.name === "inpaint")) {
      caps.push("image_editing");
    }
    endpointCaps = JSON.stringify(caps);
    if (imageSizeParam?.enum && Array.isArray(imageSizeParam.enum)) {
      supportedSizes = JSON.stringify(imageSizeParam.enum.map(String));
    }
  } else if (parsed.data.modality === "llm") {
    const caps = ["chat"];
    if (params.some((p) => p.name === "image_url" || p.name === "image_urls")) {
      caps.push("vision");
    }
    endpointCaps = JSON.stringify(caps);
  } else {
    endpointCaps = "[]";
  }

  // generateAudio
  const generateAudioSupported =
    typeof generateAudioParam?.default === "boolean"
      ? generateAudioParam.default
        ? 1
        : 0
      : 0;

  // requiresAsync
  const requiresAsync = schema.falSource === "queue" ? 1 : 0;

  // 解析 inputSchema 提取参考资源上限
  const caps = extractInputSchemaCapabilities(
    schema.inputSchema ?? null,
    schema.parameters ?? null,
  );

  // 更新模型
  const now = new Date();
  await db
    .update(models)
    .set({
      modality: parsed.data.modality,
      endpointCaps,
      paramCaps: "[]",
      capsOverridden: 0,
      schemaEndpointId: parsed.data.endpointId,
      schemaMatchSource: "manual",
      schemaSyncedAt: now,
      falParametersSnapshot:
        params.length > 0 ? JSON.stringify(params) : null,
      falInputSchemaSnapshot: caps.inputSchemaJson,
      falPricing: schema.pricing ?? null,
      falDescription: schema.description ?? null,
      falSource: schema.falSource ?? null,
      // 视频参数：优先用 parameters 数组里的 enum，fallback 到 inputSchema 提取
      videoDurationEnum:
        caps.durationEnum.length > 0
          ? JSON.stringify(caps.durationEnum)
          : null,
      videoAspectRatios:
        caps.aspectRatioEnum.length > 0
          ? JSON.stringify(caps.aspectRatioEnum)
          : null,
      videoResolutions:
        caps.resolutionEnum.length > 0
          ? JSON.stringify(caps.resolutionEnum)
          : null,
      videoRequiredParams:
        requiredParams.length > 0
          ? JSON.stringify(requiredParams)
          : null,
      videoOptionalParams:
        optionalParams.length > 0
          ? JSON.stringify(optionalParams)
          : null,
      generateAudioSupported,
      supportedSizes,
      maxDurationSec,
      maxReferenceImages: caps.maxReferenceImages,
      maxReferenceVideos: caps.maxReferenceVideos,
      maxReferenceAudios: caps.maxReferenceAudios,
      requiresAsync,
      supportsStream: 1,
      updatedAt: now,
    })
    .where(eq(models.id, modelId));

  await writeAudit({
    actor: "admin",
    action: "wizard.apply-schema",
    resourceType: "model",
    resourceId: modelId,
    payload: JSON.stringify({
      modelId,
      endpointId: parsed.data.endpointId,
      modality: parsed.data.modality,
    }),
  });

  return c.json({
    data: {
      applied: true,
      endpointId: parsed.data.endpointId,
      modality: parsed.data.modality,
      maxDurationSec,
      maxReferenceImages: caps.maxReferenceImages,
      maxReferenceVideos: caps.maxReferenceVideos,
      maxReferenceAudios: caps.maxReferenceAudios,
      inputSchemaJson: caps.inputSchemaJson,
      parametersCount: params.length,
    },
  });
});

// ─────────────────────────────────────────────────────────────────
// confirm — 创建变体（不变更模型原始名称）
// ─────────────────────────────────────────────────────────────────
const ConfirmSchema = z.object({
  step2: z.object({
    modality: ModalitySchema,
    catalogId: z.string().nullable(),
    endpointCaps: z.array(z.string()),
    paramCaps: z.array(z.string()),
  }),
  step3: z.object({
    adapterId: z.string().min(1),
    variantName: z.string().min(1).max(64),
    description: z.string(),
    paramOverrides: z.record(z.string(), z.unknown()),
    paramBlocked: z.array(z.string()),
    fieldMapping: z.record(z.string(), z.string()),
    paramLimits: z.record(z.string(), z.array(z.string())).optional(),
    adapterConfig: z.record(z.string(), z.unknown()).nullable().optional(),
    contextWindow: z.number().int().positive().nullable().optional(),
    maxOutputTokens: z.number().int().positive().nullable().optional(),
    supportedSizes: z.array(z.string()).nullable().optional(),
    maxDurationSec: z.number().int().positive().nullable().optional(),
    supportsReasoning: z.boolean().optional(),
    supportsStream: z.boolean().optional(),
    requiresAsync: z.boolean().optional(),
    maxImages: z.number().int().positive().nullable().optional(),
    maxDuration: z.number().int().positive().nullable().optional(),
    maxAudioLen: z.number().int().positive().nullable().optional(),
    isPublic: z.boolean().optional(),
    // 视频微调字段
    selectedDurationSecs: z.array(z.union([z.number(), z.string().min(1)])).optional(),
    selectedAspectRatios: z.array(z.string()).optional(),
    selectedResolutions: z.array(z.string()).optional(),
    maxReferenceImages: z.number().int().nonnegative().nullable().optional(),
    maxReferenceVideos: z.number().int().nonnegative().nullable().optional(),
    maxReferenceAudios: z.number().int().nonnegative().nullable().optional(),
    generateAudio: z.boolean().optional(),
  }),
});

wizard.post("/wizard/:modelId/confirm", async (c) => {
  const modelId = c.req.param("modelId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = ConfirmSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const [model] = await db.select().from(models).where(eq(models.id, modelId)).limit(1);
  if (!model) return c.json({ error: "Model not found" }, 404);
  const [site] = await db
    .select()
    .from(sites)
    .where(eq(sites.id, model.siteId))
    .limit(1);
  if (!site) return c.json({ error: "Site not found" }, 500);
  if (site.status !== "active") {
    return c.json({
      error: {
        message: `Site ${site.name} is ${site.status}; activate it before creating a callable variant`,
        code: "site_unavailable",
      },
    }, 409);
  }
  const [existing] = await db.select({ id: variants.id }).from(variants).where(eq(variants.name, parsed.data.step3.variantName)).limit(1);
  if (existing) return c.json({ error: { message: `Variant name '${parsed.data.step3.variantName}' already exists`, code: "variant_name_taken" } }, 409);
  const { step2, step3 } = parsed.data;
  const adapterId = normalizeAdapterId(step3.adapterId);
  const adapter = adapterId ? getAdapter(adapterId) : undefined;
  if (!adapter || !adapterId) {
    return c.json({
      error: {
        message: `Adapter not found: ${step3.adapterId}`,
        code: "adapter_not_found",
      },
    }, 400);
  }

  const capabilityError = validateAdapterCapability(adapter, step2.modality);
  if (capabilityError) {
    return c.json({ error: { message: capabilityError, code: "adapter_capability_unsupported" } }, 400);
  }

  const adapterConfig = step3.adapterConfig ?? undefined;
  const adapterConfigError = validateAdapterConfig(adapter, adapterConfig, step2.modality);
  if (adapterConfigError) {
    return c.json({ error: { message: adapterConfigError, code: "adapter_config_invalid" } }, 400);
  }

  const selectedDurationValues = step3.selectedDurationSecs?.map(String) ?? [];
  const numericDurationValues = selectedDurationValues
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  const maxDurationSec =
    step3.maxDurationSec ??
    (numericDurationValues.length > 0
      ? Math.max(...numericDurationValues)
      : model.maxDurationSec);
  const referenceLimitError = validateVariantLimits({ ...step3, maxDurationSec }, model);
  if (referenceLimitError) {
    return c.json({ error: { message: referenceLimitError, code: "model_constraint_invalid" } }, 400);
  }

  const paramLimits = {
    ...(step3.paramLimits ?? {}),
    ...(selectedDurationValues.length > 0
      ? { duration: selectedDurationValues }
      : {}),
    ...(step3.selectedAspectRatios && step3.selectedAspectRatios.length > 0
      ? { aspect_ratio: step3.selectedAspectRatios }
      : {}),
    ...(step3.selectedResolutions && step3.selectedResolutions.length > 0
      ? { resolution: step3.selectedResolutions }
      : {}),
  };
  const paramLimitsError = validateParameterLimitsAgainstModel(paramLimits, model);
  if (paramLimitsError) {
    return c.json({ error: { message: paramLimitsError, code: "model_constraint_invalid" } }, 400);
  }
  const now = new Date();
  const variantId = `var_${nanoid(10)}`;

  // selectedDurationSecs / selectedAspectRatios / selectedResolutions 写入变体限制
  const maxImages = step3.maxImages ?? step3.maxReferenceImages ?? null;

  // 强制覆盖只保存用户明确填写的值；允许值集合单独保存到 param_limits。
  const mergedOverrides = {
    ...step3.paramOverrides,
    ...(step3.generateAudio != null
      ? { generate_audio: step3.generateAudio }
      : {}),
  };

  db.transaction((tx) => {
    tx.update(models).set({
      adapterId,
      modality: step2.modality,
      endpointCaps: JSON.stringify(step2.endpointCaps),
      paramCaps: JSON.stringify(step2.paramCaps),
      capsOverridden: 1,
      status: "active",
      catalogModelId: step2.catalogId,
      catalogMatchSource: "admin",
      catalogMatchConfidence: "high",
      catalogSyncedAt: now,
      contextWindow: step3.contextWindow ?? model.contextWindow,
      maxOutputTokens: step3.maxOutputTokens ?? model.maxOutputTokens,
      supportsReasoning: Number(step3.supportsReasoning ?? model.supportsReasoning),
      supportedSizes: step3.supportedSizes ? JSON.stringify(step3.supportedSizes) : model.supportedSizes,
      maxDurationSec,
      supportsStream: Number(step3.supportsStream ?? model.supportsStream),
      requiresAsync: Number(step3.requiresAsync ?? model.requiresAsync),
      updatedAt: now,
    }).where(eq(models.id, modelId)).run();

    tx.insert(variants).values({
      id: variantId,
      name: step3.variantName,
      modelId,
      description: step3.description || null,
      adapterConfig: adapterConfig ? JSON.stringify(adapterConfig) : null,
      paramOverrides: JSON.stringify(mergedOverrides),
      paramBlocked: JSON.stringify(step3.paramBlocked),
      fieldMapping: JSON.stringify(step3.fieldMapping),
      paramLimits: Object.keys(paramLimits).length > 0 ? JSON.stringify(paramLimits) : null,
      maxContext: step3.contextWindow ?? null,
      maxOutput: step3.maxOutputTokens ?? null,
      maxImages: maxImages ?? null,
      maxReferenceImages: step3.maxReferenceImages ?? null,
      maxReferenceVideos: step3.maxReferenceVideos ?? null,
      maxReferenceAudios: step3.maxReferenceAudios ?? null,
      maxDuration: step3.maxDuration ?? maxDurationSec ?? null,
      maxAudioLen: step3.maxAudioLen ?? null,
      isPublic: Number(step3.isPublic ?? true),
      createdAt: now,
      updatedAt: now,
    }).run();
  });

  await writeAudit({ actor: "admin", action: "wizard.confirm", resourceType: "variant", resourceId: variantId, payload: JSON.stringify({ modelId, variantName: step3.variantName, modality: step2.modality }) });
  return c.json({ data: { variantId, adapterId } }, 201);
});

export default wizard;
