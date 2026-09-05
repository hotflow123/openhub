import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../../db";
import { modelProtocolBindings, models, modelSchemaCatalog, protocolCatalog, protocolSyncRuns, sites, variants } from "../../db/schema";
import {
  assessProtocolReadiness,
  getProtocolCatalogRecord,
  bindModelsToLatestProtocols,
  listModelProtocolBindings,
  listProtocolCatalog,
  protocolStore,
} from "../../engine/protocol-catalog";
import { buildForwardContext } from "../../routes/router";
import { resolveAdapterForModel } from "../../engine/adapter";
import { decrypt, getMasterKey } from "../../lib/crypto";
import { writeAudit } from "../../lib/audit";
import { importProtocolDocument, syncProtocolSource } from "../../engine/memefast-protocol-sync";
import { MEMEFAST_PROTOCOL_SOURCES, findMemeFastProtocolSource } from "../../lib/memefast-sources";
import { withAdminAuth } from "./_with-auth";

const route = new Hono();
withAdminAuth(route);

route.get("/memefast/protocol-sources", (c) => c.json({ data: MEMEFAST_PROTOCOL_SOURCES }));

route.post("/memefast/protocols/import", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { sourceUrl?: string; document?: unknown } & Record<string, unknown>;
  const result = await importProtocolDocument(body.document ?? body, protocolStore, {
    sourceUrl: body.sourceUrl ?? "local://admin-import",
  });
  const bindings = result.status === "success"
    ? await bindModelsToLatestProtocols()
    : { inspected: 0, bound: 0, existing: 0, unmatched: 0 };
  return c.json({ data: { ...result, bindings } }, result.status === "success" ? 201 : 502);
});

route.post("/memefast/protocols/sync", async (c) => {
  const source = c.req.query("source");
  if (!source || !findMemeFastProtocolSource(source)) {
    return c.json({ error: { code: "untrusted_source", message: "Use a source from /admin/memefast/protocol-sources" } }, 400);
  }
  const result = await syncProtocolSource(source, protocolStore);
  const bindings = result.status === "failed"
    ? { inspected: 0, bound: 0, existing: 0, unmatched: 0 }
    : await bindModelsToLatestProtocols();
  return c.json({ data: { ...result, bindings } }, result.status === "failed" ? 502 : 200);
});

route.post("/memefast/video-verifications", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    modelId?: string;
    siteTaskId?: string;
  };
  if (!body.modelId || !body.siteTaskId) {
    return c.json({
      error: { code: "invalid_video_verification", message: "modelId and siteTaskId are required" },
    }, 400);
  }

  const [model] = await db.select().from(models).where(eq(models.id, body.modelId)).limit(1);
  if (!model || model.modality !== "video") {
    return c.json({ error: { code: "video_model_not_found", message: "video model not found" } }, 404);
  }
  const [site] = await db.select().from(sites).where(eq(sites.id, model.siteId)).limit(1);
  const [variant] = await db
    .select()
    .from(variants)
    .where(and(eq(variants.modelId, model.id), eq(variants.name, model.rawName)))
    .limit(1);
  const protocol = await listModelProtocolBindings(model.id).then((rows) => rows[0]);
  const protocolRecord = protocol ? await getProtocolCatalogRecord(protocol.protocolRecordId) : undefined;
  if (!site || !variant || !protocol || !protocolRecord) {
    return c.json({ error: { code: "video_verification_unavailable", message: "model is missing site, variant, or protocol binding" } }, 409);
  }
  const document = JSON.parse(protocolRecord.rawDocument) as Parameters<typeof assessProtocolReadiness>[0];
  const readiness = assessProtocolReadiness(document);
  if (!readiness.ready) {
    return c.json({ error: { code: "protocol_incomplete", message: readiness.missing.join(", ") } }, 409);
  }
  const resolved = resolveAdapterForModel(model.adapterId, site.adapterId);
  if (!resolved?.adapter.queryVideoTask) {
    return c.json({ error: { code: "video_query_unsupported", message: "adapter does not support video.query" } }, 409);
  }

  const apiKey = await decrypt(site.apiKeyEnc, site.apiKeyIv, getMasterKey());
  const result = await resolved.adapter.queryVideoTask(
    body.siteTaskId,
    buildForwardContext(variant, site, apiKey, {
      binding: protocol,
      catalog: protocolRecord,
      document,
    }),
  );
  if (result.status !== "completed" || !result.result?.video_url) {
    return c.json({
      data: { verified: false, status: result.status, hasResult: Boolean(result.result?.video_url) },
    }, 409);
  }

  await db.update(protocolCatalog).set({
    status: "active",
    enabled: true,
    evidenceStatus: "runtime_verified",
    updatedAt: new Date(),
  }).where(eq(protocolCatalog.recordId, protocolRecord.recordId));
  await db.update(modelProtocolBindings).set({
    evidenceStatus: "runtime_verified",
    updatedAt: new Date(),
  }).where(eq(modelProtocolBindings.id, protocol.id));
  await db.update(variants).set({
    isPublic: 1,
    updatedAt: new Date(),
  }).where(eq(variants.id, variant.id));
  await writeAudit({
    actor: "admin",
    action: "memefast.video.verify",
    resourceType: "model",
    resourceId: model.id,
    payload: JSON.stringify({ modelId: model.id, siteTaskId: body.siteTaskId, protocolId: protocol.protocolId }),
  });
  return c.json({
    data: { verified: true, model: model.rawName, protocolId: protocol.protocolId, status: result.status },
  });
});

route.get("/memefast/protocols", async (c) => {
  return c.json({ data: await listProtocolCatalog(c.req.query("protocol_id")) });
});

route.get("/memefast/protocols/:recordId", async (c) => {
  const row = await getProtocolCatalogRecord(c.req.param("recordId"));
  return row ? c.json({ data: row }) : c.json({ error: "Not found" }, 404);
});

route.get("/memefast/protocol-sync-runs", async (c) => {
  const rows = await db.select().from(protocolSyncRuns).orderBy(protocolSyncRuns.startedAt);
  return c.json({ data: rows });
});

route.get("/memefast/protocol-bindings", async (c) => {
  return c.json({ data: await listModelProtocolBindings(c.req.query("model_id")) });
});

route.post("/memefast/protocol-bindings", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    modelId?: string;
    protocolRecordId?: string;
    parameterTemplateId?: string | null;
    fieldMapping?: Record<string, unknown>;
    capabilityOverrides?: Record<string, unknown>;
    evidenceStatus?: "documented" | "imported" | "fixture_verified" | "runtime_verified" | "enabled";
    bindingReason?: string | null;
  };
  if (!body.modelId || !body.protocolRecordId) {
    return c.json({ error: { code: "invalid_binding", message: "modelId and protocolRecordId are required" } }, 400);
  }
  const [model] = await db.select({ id: models.id }).from(models).where(eq(models.id, body.modelId)).limit(1);
  const protocol = await getProtocolCatalogRecord(body.protocolRecordId);
  if (!model || !protocol) return c.json({ error: { code: "not_found", message: "model or protocol record not found" } }, 404);
  if (body.parameterTemplateId) {
    const [template] = await db
      .select({ endpointId: modelSchemaCatalog.endpointId })
      .from(modelSchemaCatalog)
      .where(eq(modelSchemaCatalog.endpointId, body.parameterTemplateId))
      .limit(1);
    if (!template) return c.json({ error: { code: "template_not_found", message: "parameterTemplateId not found" } }, 400);
  }
  const id = nanoid();
  await db.insert(modelProtocolBindings).values({
    id,
    modelId: body.modelId,
    protocolRecordId: body.protocolRecordId,
    protocolId: protocol.protocolId,
    protocolVersion: protocol.version,
    parameterTemplateId: body.parameterTemplateId ?? null,
    fieldMapping: JSON.stringify(body.fieldMapping ?? {}),
    capabilityOverrides: JSON.stringify(body.capabilityOverrides ?? {}),
    evidenceStatus: body.evidenceStatus ?? "imported",
    bindingReason: body.bindingReason ?? null,
  });
  const [row] = await db.select().from(modelProtocolBindings).where(eq(modelProtocolBindings.id, id)).limit(1);
  return c.json({ data: row }, 201);
});

export default route;
