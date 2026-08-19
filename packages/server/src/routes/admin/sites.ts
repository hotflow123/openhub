import { Hono } from "hono";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../../db/index";
import { sites } from "../../db/schema/index";
import { encrypt, getMasterKey } from "../../lib/crypto";
import { validateUrl } from "../../lib/ssrf";
import { discoverModels } from "../../engine/discover";
import { matchModelsForSite } from "../../engine/catalog/match-after-discover";
import { matchSchemasForSite } from "../../engine/catalog/schema-matcher";
import { writeAudit } from "../../lib/audit";
import { withAdminAuth } from "./_with-auth";

// 开发模式允许私网/回环地址（localhost mock 站点）。生产部署必须 OPENHUB_ALLOW_PRIVATE_URLS=false 或不设。
const ALLOW_PRIVATE_URLS = process.env.OPENHUB_ALLOW_PRIVATE_URLS === "true";

const sitesRoute = new Hono();
withAdminAuth(sitesRoute);

const CreateSiteSchema = z.object({
  name: z.string().min(1).max(64),
  baseUrl: z
    .string()
    .url()
    .refine(
      (u) => {
        try {
          const parsed = new URL(u);
          return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "baseUrl must use http:// or https://" },
    ),
  apiKey: z.string().min(1),
  adapterId: z.string().default("openai"),
});

const UpdateSiteSchema = CreateSiteSchema.partial();

// 子 app 用相对路径 /sites/*，父 app route("/admin", sitesRoute) 挂载
// 实际路径：/admin/sites/*

sitesRoute.get("/sites", async (c) => {
  const rows = await db.select().from(sites).orderBy(desc(sites.createdAt));
  return c.json({ data: rows.map(stripSecret) });
});

sitesRoute.get("/sites/:id", async (c) => {
  const id = c.req.param("id");
  const [row] = await db.select().from(sites).where(eq(sites.id, id)).limit(1);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ data: stripSecret(row) });
});

sitesRoute.post("/sites", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateSiteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const { name, baseUrl, apiKey, adapterId } = parsed.data;

  // P0-3: SSRF 校验
  try {
    await validateUrl(baseUrl, { allowPrivateIp: ALLOW_PRIVATE_URLS });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ error: { message: `Invalid baseUrl: ${message}`, code: "ssrf_blocked" } }, 400);
  }

  const enc = await encrypt(apiKey, getMasterKey());
  const id = nanoid();
  await db.insert(sites).values({
    id,
    name,
    baseUrl,
    apiKeyEnc: enc.ciphertext,
    apiKeyIv: enc.iv,
    adapterId,
    status: "active",
  });

  await writeAudit({
    actor: "admin",
    action: "site.create",
    resourceType: "site",
    resourceId: id,
    payload: JSON.stringify({ name, baseUrl, adapterId }),
  });

  (async () => {
    try {
      await discoverModels(id, baseUrl, apiKey);
      await matchModelsForSite(id);
      await matchSchemasForSite(id);
    } catch (err) {
      console.error(`[sites] auto-discover failed for ${id}:`, err);
    }
  })();

  return c.json({ data: { id, name, baseUrl, adapterId, status: "active" } }, 201);
});

sitesRoute.patch("/sites/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = UpdateSiteSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  // P0-3: SSRF 校验（仅当 baseUrl 变更时）
  if (parsed.data.baseUrl) {
    try {
      await validateUrl(parsed.data.baseUrl, { allowPrivateIp: ALLOW_PRIVATE_URLS });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ error: { message: `Invalid baseUrl: ${message}`, code: "ssrf_blocked" } }, 400);
    }
  }

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name) update.name = parsed.data.name;
  if (parsed.data.baseUrl) update.baseUrl = parsed.data.baseUrl;
  if (parsed.data.adapterId) update.adapterId = parsed.data.adapterId;
  if (parsed.data.apiKey) {
    const enc = await encrypt(parsed.data.apiKey, getMasterKey());
    update.apiKeyEnc = enc.ciphertext;
    update.apiKeyIv = enc.iv;
  }
  await db.update(sites).set(update).where(eq(sites.id, id));
  const [row] = await db.select().from(sites).where(eq(sites.id, id)).limit(1);
  return c.json({ data: stripSecret(row) });
});

sitesRoute.delete("/sites/:id", async (c) => {
  const id = c.req.param("id");
  await db.delete(sites).where(eq(sites.id, id));
  await writeAudit({
    actor: "admin",
    action: "site.delete",
    resourceType: "site",
    resourceId: id,
  });
  return c.json({ data: { id, deleted: true } });
});

sitesRoute.post("/sites/:id/discover", async (c) => {
  const id = c.req.param("id");
  const [site] = await db.select().from(sites).where(eq(sites.id, id)).limit(1);
  if (!site) return c.json({ error: "Site not found" }, 404);
  const { decrypt } = await import("../../lib/crypto");
  const apiKey = await decrypt(site.apiKeyEnc, site.apiKeyIv, getMasterKey());
  try {
    const result = await discoverModels(id, site.baseUrl, apiKey);
    const match = await matchModelsForSite(id);
    const schemaMatch = await matchSchemasForSite(id);
    return c.json({ data: { ...result, ...match, schemaMatched: schemaMatch.matched, schemaTotal: schemaMatch.total } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(sites)
      .set({ lastError: message, status: "error", updatedAt: new Date() })
      .where(eq(sites.id, id));
    return c.json({ error: message }, 502);
  }
});

sitesRoute.post("/sites/:id/health", async (c) => {
  const id = c.req.param("id");
  const [site] = await db.select().from(sites).where(eq(sites.id, id)).limit(1);
  if (!site) return c.json({ error: "Site not found" }, 404);
  const { decrypt } = await import("../../lib/crypto");
  const apiKey = await decrypt(site.apiKeyEnc, site.apiKeyIv, getMasterKey());
  const { getAdapter } = await import("../../engine/adapter");
  const adapter = getAdapter(site.adapterId);
  if (!adapter) return c.json({ error: "Adapter not found" }, 500);
  const ok = await adapter.healthCheck({ targetUrl: site.baseUrl, apiKey });
  return c.json({ data: { id, healthy: ok } });
});

function stripSecret<T extends { apiKeyEnc?: string; apiKeyIv?: string }>(row: T): Omit<T, "apiKeyEnc" | "apiKeyIv"> {
  const { apiKeyEnc: _e, apiKeyIv: _v, ...rest } = row;
  return rest;
}

export default sitesRoute;
