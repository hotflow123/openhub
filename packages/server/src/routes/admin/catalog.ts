import { count, desc, eq, inArray, isNotNull, isNull, like, sql } from "drizzle-orm";
import { Hono } from "hono";
import { generateAliases, performSync } from "@openhub/catalog/sync";
import { db } from "../../db/index";
import {
  catalogSyncRuns,
  modelCatalog,
  modelCatalogAlias,
  modelSchemaCatalog,
  modelSchemaAlias,
  schemaCatalogSyncRuns,
  sites,
  models,
} from "../../db/schema/index";
import { aliasDb, syncDb } from "../../engine/catalog/db-adapter";
import { refreshCatalogMappings } from "../../engine/catalog/refresh-mappings";
import {
  inferModelCapability,
  inferUnmatchedModels,
  type ModelCapability,
  type ModelInferResult,
} from "../../engine/llm-model-infer";
import { withAdminAuth } from "./_with-auth";
import { syncFalEncyclopedia } from "../../scripts/sync-fal-encyclopedia.js";
import { extractInputSchemaCapabilities } from "../../lib/fal-input-schema";

const catalog = new Hono();
withAdminAuth(catalog);

catalog.post("/catalog/sync", async (c) => {
  const result = await performSync(syncDb);
  if (result.status === "success") {
    await refreshCatalogMappings();
  }
  return c.json({ data: result });
});

catalog.get("/catalog/runs", async (c) => {
  const rows = await db
    .select()
    .from(catalogSyncRuns)
    .orderBy(desc(catalogSyncRuns.startedAt))
    .limit(10);
  const adapted = rows.map((r) => {
    const startedAtMs = typeof r.startedAt === "number" ? r.startedAt * 1000 : null;
    const finishedAtMs = typeof r.finishedAt === "number" ? r.finishedAt * 1000 : null;
    return {
      id: r.id,
      syncStartedAt: startedAtMs,
      syncCompletedAt: finishedAtMs,
      status: r.status,
      totalRecords: r.recordCount ?? null,
      addedRecords: r.status === "success" && r.recordCount ? r.changedCount : null,
      updatedRecords: null,
      removedRecords: null,
      errorMessage: r.errorMessage ?? null,
    };
  });
  return c.json({ data: adapted });
});

catalog.get("/catalog", async (c) => {
  const q = c.req.query("q");
  const parsedLimit = Number(c.req.query("limit") ?? 50);
  const parsedOffset = Number(c.req.query("offset") ?? 0);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;
  const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

  const rows = q
    ? await db
        .select()
        .from(modelCatalog)
        .where(like(modelCatalog.name, `%${q}%`))
        .limit(limit)
        .offset(offset)
    : await db.select().from(modelCatalog).limit(limit).offset(offset);
  return c.json({ data: rows });
});

catalog.get("/catalog/stats", async (c) => {
  const [latest] = await db
    .select()
    .from(catalogSyncRuns)
    .orderBy(desc(catalogSyncRuns.startedAt))
    .limit(1);
  const [catalogTotal] = await db.select({ value: count() }).from(modelCatalog);
  const [aliasTotal] = await db.select({ value: count() }).from(modelCatalogAlias);
  const [modelTotal] = await db.select({ value: count() }).from(models);
  const [matchedTotal] = await db
    .select({ value: count() })
    .from(models)
    .where(isNotNull(models.catalogModelId));
  const [unmatchedTotal] = await db
    .select({ value: count() })
    .from(models)
    .where(isNull(models.catalogModelId));
  const totalModels = modelTotal?.value ?? 0;
  const matchedModels = matchedTotal?.value ?? 0;

  const [schemaTotal] = await db.select({ value: count() }).from(modelSchemaCatalog);
  const [schemaAliasTotal] = await db.select({ value: count() }).from(modelSchemaAlias);
  const [schemaMatchedTotal] = await db
    .select({ value: count() })
    .from(models)
    .where(isNotNull(models.schemaEndpointId));

  return c.json({
    data: {
      lastRun: latest ?? null,
      catalog: { total: catalogTotal?.value ?? 0 },
      aliases: { total: aliasTotal?.value ?? 0 },
      schema: {
        total: schemaTotal?.value ?? 0,
        aliases: schemaAliasTotal?.value ?? 0,
        matched: schemaMatchedTotal?.value ?? 0,
      },
      models: {
        total: totalModels,
        matched: matchedModels,
        unmatched: unmatchedTotal?.value ?? 0,
        matchRate: totalModels > 0 ? matchedModels / totalModels : 0,
      },
    },
  });
});

catalog.post("/catalog/generate-aliases", async (c) => {
  const catalogs = await db.select({ id: modelCatalog.id }).from(modelCatalog);
  const generated = await generateAliases(aliasDb, catalogs);
  return c.json({ data: { generated } });
});

catalog.post("/catalog/rematch", async (c) => {
  const result = await refreshCatalogMappings();
  return c.json({ data: result });
});

/** fal.ai Schema 统计 */
catalog.get("/catalog/schema-stats", async (c) => {
  const [schemaTotal] = await db
    .select({ value: count() })
    .from(modelSchemaCatalog);
  const [aliasTotal] = await db
    .select({ value: count() })
    .from(modelSchemaAlias);
  const [matchedTotal] = await db
    .select({ value: count() })
    .from(models)
    .where(isNotNull(models.schemaEndpointId));
  const [latestRun] = await db
    .select()
    .from(schemaCatalogSyncRuns)
    .orderBy(desc(schemaCatalogSyncRuns.startedAt))
    .limit(1);
  return c.json({
    data: {
      schemas: schemaTotal?.value ?? 0,
      aliases: aliasTotal?.value ?? 0,
      matchedModels: matchedTotal?.value ?? 0,
      lastRun: latestRun ?? null,
    },
  });
});

/** fal.ai Schema 搜索 */
catalog.get("/catalog/schema", async (c) => {
  const rawQ = c.req.query("q");
  const q = typeof rawQ === "string" && rawQ.trim() !== "" ? rawQ.trim() : null;
  const rawModality = c.req.query("modality");
  const modality = typeof rawModality === "string" && rawModality !== "" ? rawModality : null;
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 20), 1), 100);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);

  try {
    let rows;
    if (q) {
      rows = await db
        .select()
        .from(modelSchemaCatalog)
        .where(like(modelSchemaCatalog.title, `%${q}%`))
        .limit(limit)
        .offset(offset);
    } else if (modality) {
      rows = await db
        .select()
        .from(modelSchemaCatalog)
        .where(eq(modelSchemaCatalog.modality, modality as any))
        .limit(limit)
        .offset(offset);
    } else {
      rows = await db
        .select()
        .from(modelSchemaCatalog)
        .limit(limit)
        .offset(offset);
    }

  // 聚合每个 endpointId 的别名数量和关联模型数量
  const schemaEndpointIds = rows.map((r) => r.endpointId);
  const aliasMap = new Map<string, number>();
  const matchedMap = new Map<string, number>();

  // 默认全部为 0（避免 endpointId 不在 alias/matched 表中时显示 undefined）
  for (const row of rows) {
    aliasMap.set(row.endpointId, 0);
    matchedMap.set(row.endpointId, 0);
  }

  if (schemaEndpointIds.length > 0) {
    const aliasRows = await db
      .select({ endpointId: modelSchemaAlias.endpointId, count: count() })
      .from(modelSchemaAlias)
      .where(inArray(modelSchemaAlias.endpointId, schemaEndpointIds))
      .groupBy(modelSchemaAlias.endpointId);

    const matchedRows = await db
      .select({ schemaEndpointId: models.schemaEndpointId, count: count() })
      .from(models)
      .where(inArray(models.schemaEndpointId, schemaEndpointIds))
      .groupBy(models.schemaEndpointId);

    for (const r of aliasRows) aliasMap.set(r.endpointId, Number(r.count));
    for (const r of matchedRows) {
      if (r.schemaEndpointId) matchedMap.set(r.schemaEndpointId, Number(r.count));
    }
  }

  const adapted = rows.map((row) => {
    let parameters: any[] = [];
    let parametersCount = 0;
    let requiredParams: string[] = [];
    let durationEnum: string[] = [];
    let resolutionEnum: string[] = [];
    let aspectRatioEnum: string[] = [];
    let generateAudioDefault: boolean | null = null;
    let imageUrlsSupported = false;
    let videoUrlsSupported = false;
    let audioUrlsSupported = false;
    let maxReferenceImages: number | null = null;
    let maxReferenceVideos: number | null = null;
    let maxReferenceAudios: number | null = null;

    if (row.parameters && typeof row.parameters === "string") {
      try {
        parameters = JSON.parse(row.parameters);
        parametersCount = parameters.length;
        requiredParams = parameters.filter((p) => p.required).map((p) => p.name);

        const durationP = parameters.find((p) => p.name === "duration");
        if (durationP?.enum) durationEnum = durationP.enum.map(String).slice(0, 30);

        const resolutionP = parameters.find((p) => p.name === "resolution");
        if (resolutionP?.enum) resolutionEnum = resolutionP.enum.map(String);

        const aspectP = parameters.find((p) => p.name === "aspect_ratio");
        if (aspectP?.enum) aspectRatioEnum = aspectP.enum.map(String);

        const gaP = parameters.find((p) => p.name === "generate_audio");
        if (gaP?.default !== undefined) generateAudioDefault = gaP.default as boolean;

        const inputCaps = extractInputSchemaCapabilities(row.inputSchema, row.parameters);
        durationEnum = inputCaps.durationEnum;
        resolutionEnum = inputCaps.resolutionEnum;
        aspectRatioEnum = inputCaps.aspectRatioEnum;
        generateAudioDefault = inputCaps.generateAudioDefault;
        imageUrlsSupported = inputCaps.imageUrlsSupported;
        videoUrlsSupported = inputCaps.videoUrlsSupported;
        audioUrlsSupported = inputCaps.audioUrlsSupported;
        maxReferenceImages = inputCaps.maxReferenceImages;
        maxReferenceVideos = inputCaps.maxReferenceVideos;
        maxReferenceAudios = inputCaps.maxReferenceAudios;
      } catch {
        /* ignore */
      }
    }

    return {
      endpointId: row.endpointId,
      title: row.title,
      modality: row.modality,
      falCategory: row.falCategory,
      falSource: row.falSource,
      pricing: row.pricing,
      apiDocs: row.apiDocs,
      status: row.status,
      // 聚合数据
      aliasCount: aliasMap.get(row.endpointId) ?? 0,
      matchedCount: matchedMap.get(row.endpointId) ?? 0,
      // 解析后的参数摘要
      parametersCount,
      requiredParams,
      durationEnum,
      resolutionEnum,
      aspectRatioEnum,
      generateAudioDefault,
      imageUrlsSupported,
      videoUrlsSupported,
      audioUrlsSupported,
      maxReferenceImages,
      maxReferenceVideos,
      maxReferenceAudios,
    };
  });

    return c.json({ data: adapted });
  } catch (err) {
    console.error("[catalog/schema] query error:", err);
    return c.json({ error: String(err) }, 500);
  }
});

/** fal.ai Schema 详情 */
catalog.get("/catalog/schema/:endpointId", async (c) => {
  const endpointId = c.req.param("endpointId");
  const [row] = await db
    .select()
    .from(modelSchemaCatalog)
    .where(eq(modelSchemaCatalog.endpointId, endpointId))
    .limit(1);
  if (!row) return c.json({ error: "Not found" }, 404);

  let parameters = [];
  if (row.parameters && typeof row.parameters === "string") {
    try {
      parameters = JSON.parse(row.parameters);
    } catch {
      parameters = [];
    }
  }

  return c.json({
    data: {
      endpointId: row.endpointId,
      title: row.title,
      modality: row.modality,
      falCategory: row.falCategory,
      falSource: row.falSource,
      description: row.description,
      pricing: row.pricing,
      apiDocs: row.apiDocs,
      status: row.status,
      parameters,
      inputSchema: row.inputSchema ? JSON.parse(row.inputSchema as string) : null,
      outputSchema: row.outputSchema ? JSON.parse(row.outputSchema as string) : null,
    },
  });
});

/** fal.ai Schema 同步 */
catalog.post("/catalog/sync-schema", async (c) => {
  const filePath = c.req.query("file");
  try {
    const result = await syncFalEncyclopedia({
      filePath: filePath || undefined,
      triggeredBy: "manual",
    });
    return c.json({ data: result });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

/** 获取 fal.ai Schema 同步历史 */
catalog.get("/catalog/schema-runs", async (c) => {
  const rows = await db
    .select()
    .from(schemaCatalogSyncRuns)
    .orderBy(desc(schemaCatalogSyncRuns.startedAt))
    .limit(10);
  return c.json({
    data: rows.map((r) => ({
      id: r.id,
      status: r.status,
      sourceFile: r.sourceFile,
      recordCount: r.recordCount,
      changedCount: r.changedCount,
      aliasCount: r.aliasCount,
      errorMessage: r.errorMessage,
      startedAt: r.startedAt ? r.startedAt * 1000 : null,
      finishedAt: r.finishedAt ? r.finishedAt * 1000 : null,
      triggeredBy: r.triggeredBy,
    })),
  });
});

export default catalog;

// ─────────────────────────────────────────────────────────────────
// LLM 推理端点
// ─────────────────────────────────────────────────────────────────

/** 对单个模型执行 LLM 能力推理 */
catalog.post("/catalog/infer", async (c) => {
  const body = await c.req.json() as {
    rawName: string;
    forcedModality?: ModelCapability["modality"];
    variantName?: string;
  };
  if (!body.rawName) return c.json({ error: "rawName required" }, 400);

  try {
    const capability = await inferModelCapability(body.rawName, {
      forcedModality: body.forcedModality,
      variantName: body.variantName,
    });
    return c.json({ data: capability });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

/** 对指定站点的所有未匹配模型执行批量 LLM 推理 */
catalog.post("/catalog/infer-site", async (c) => {
  const body = await c.req.json() as { siteId?: string };
  const siteId = body.siteId;

  if (!siteId) {
    return c.json({ error: "siteId required" }, 400);
  }

  // 验证站点存在
  const [site] = await db
    .select({ id: sites.id })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1);
  if (!site) return c.json({ error: "site not found" }, 404);

  try {
    const result = await inferUnmatchedModels(siteId);
    return c.json({ data: result });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
