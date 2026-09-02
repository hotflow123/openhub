import { Hono } from "hono";
import { authMiddleware, checkVariantAccess } from "../../middleware/auth";
import { forwardEmbedding, normalizeRouterError } from "../router";
import type { EmbeddingRequest } from "../../engine/adapter";

const embeddings = new Hono();
embeddings.use("/v1/embeddings", authMiddleware);

embeddings.post("/v1/embeddings", async (c) => {
  let body: EmbeddingRequest;
  try {
    body = (await c.req.json()) as EmbeddingRequest;
  } catch {
    return c.json({ error: { message: "Invalid JSON body", code: "invalid_json" } }, 400);
  }
  const variantId = body.model;
  if (!variantId) {
    return c.json({ error: { message: "Missing model" } }, 400);
  }

  const access = await checkVariantAccess(c, variantId);
  if (!access.ok) {
    return c.json(access.body, access.status as 401 | 403);
  }

  if (body.input == null) return c.json({ error: { message: "Missing input" } }, 400);

  try {
    return c.json(await forwardEmbedding(variantId, body));
  } catch (err) {
    const routerError = normalizeRouterError(err);
    return new Response(
      JSON.stringify({ error: { message: routerError.message, code: routerError.code, details: routerError.details } }),
      { status: routerError.status, headers: { "Content-Type": "application/json" } },
    );
  }
});

export default embeddings;
