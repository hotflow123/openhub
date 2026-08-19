import { Hono } from "hono";
import { authMiddleware, checkVariantAccess } from "../../middleware/auth";
import { RouterError } from "../router";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { sites, variants, models } from "../../db/schema/index";
import { decrypt, getMasterKey } from "../../lib/crypto";
import { resolveAdapterForModel } from "../../engine/adapter";

const embeddings = new Hono();
embeddings.use("/v1/embeddings", authMiddleware);

embeddings.post("/v1/embeddings", async (c) => {
  const body = (await c.req.json()) as { model: string; input: string | string[] };
  const variantId = body.model;
  if (!variantId) {
    return c.json({ error: { message: "Missing model" } }, 400);
  }

  const access = checkVariantAccess(c, variantId);
  if (!access.ok) {
    return c.json(access.body, access.status as 401 | 403);
  }

  try {
    const [variant] = await db.select().from(variants).where(eq(variants.name, variantId)).limit(1);
    if (!variant) return c.json({ error: { message: "Variant not found" } }, 404);

    const [modelRow] = await db.select().from(models).where(eq(models.id, variant.modelId)).limit(1);
    if (!modelRow) return c.json({ error: { message: "Model not found" } }, 500);

    const [site] = await db.select().from(sites).where(eq(sites.id, modelRow.siteId)).limit(1);
    if (!site) return c.json({ error: { message: "Site not found" } }, 500);

    const resolved = resolveAdapterForModel(modelRow.adapterId, site.adapterId);
    const adapter = resolved?.adapter;
    if (!adapter?.forwardEmbedding) {
      return c.json({ error: { message: "Adapter does not support embeddings" } }, 400);
    }
    const apiKey = await decrypt(site.apiKeyEnc, site.apiKeyIv, getMasterKey());
    const result = await adapter.forwardEmbedding(
      { model: modelRow.rawName, input: body.input },
      { targetUrl: site.baseUrl, apiKey },
    );
    return c.json(result);
  } catch (err) {
    if (err instanceof RouterError) {
      return c.json({ error: { message: err.message, code: err.code } }, err.status as 400 | 404 | 500);
    }
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: { message } }, 502);
  }
});

export default embeddings;
