import { Hono } from "hono";
import { authMiddleware, checkVariantAccess } from "../../middleware/auth";
import { forwardEmbedding, RouterError } from "../router";
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

  const access = checkVariantAccess(c, variantId);
  if (!access.ok) {
    return c.json(access.body, access.status as 401 | 403);
  }

  if (body.input == null) return c.json({ error: { message: "Missing input" } }, 400);

  try {
    return c.json(await forwardEmbedding(variantId, body));
  } catch (err) {
    if (err instanceof RouterError) {
      return c.json({ error: { message: err.message, code: err.code } }, err.status as 400 | 404 | 500);
    }
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: { message } }, 502);
  }
});

export default embeddings;
