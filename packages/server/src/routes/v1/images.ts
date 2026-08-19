import { Hono } from "hono";
import { authMiddleware, checkVariantAccess } from "../../middleware/auth";
import {
  forwardImageGeneration,
  forwardImageEdit,
  forwardImageVariation,
  RouterError,
} from "../router";
import type {
  ImageGenerationRequest,
  ImageEditRequest,
  ImageVariationRequest,
} from "../../engine/adapter";

const images = new Hono();
images.use("/v1/images/*", authMiddleware);

function errorResponse(status: number, message: string, code?: string) {
  return new Response(
    JSON.stringify({ error: { message, type: "router_error", code } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function handleRouterError(err: unknown): Response {
  if (err instanceof RouterError) {
    return errorResponse(err.status, err.message, err.code);
  }
  const message = err instanceof Error ? err.message : String(err);
  return errorResponse(502, message, "upstream_error");
}

/**
 * POST /v1/images/generations
 * body: { model: <variant name>, prompt, n?, size?, quality?, style?, response_format?, user? }
 */
images.post("/v1/images/generations", async (c) => {
  let body: ImageGenerationRequest;
  try {
    body = (await c.req.json()) as ImageGenerationRequest;
  } catch {
    return errorResponse(400, "Invalid JSON body", "invalid_json");
  }
  if (!body.model) return errorResponse(400, "Missing model (variant name)", "missing_model");
  if (!body.prompt) return errorResponse(400, "Missing prompt", "missing_prompt");

  const access = checkVariantAccess(c, body.model);
  if (!access.ok) return errorResponse(access.status, (access.body as any).error.message, "variant_not_allowed");

  try {
    const result = await forwardImageGeneration(body.model, {
      model: body.model,
      prompt: body.prompt,
      n: body.n,
      size: body.size,
      quality: body.quality,
      style: body.style,
      response_format: body.response_format,
      user: body.user,
    });
    return c.json(result);
  } catch (err) {
    return handleRouterError(err);
  }
});

/**
 * POST /v1/images/edits
 * multipart/form-data: model, prompt, image, mask?, n?, size?, response_format?, user?
 */
images.post("/v1/images/edits", async (c) => {
  const ct = c.req.header("Content-Type") ?? "";
  if (!ct.includes("multipart/form-data")) {
    return errorResponse(400, "Content-Type must be multipart/form-data", "invalid_content_type");
  }

  const form = await c.req.parseBody();
  const model = String(form["model"] ?? "");
  const prompt = String(form["prompt"] ?? "");
  if (!model) return errorResponse(400, "Missing model", "missing_model");
  if (!prompt) return errorResponse(400, "Missing prompt", "missing_prompt");

  const imageField = form["image"];
  if (!imageField) return errorResponse(400, "Missing image", "missing_image");
  const maskField = form["mask"];

  const access = checkVariantAccess(c, model);
  if (!access.ok) return errorResponse(access.status, (access.body as any).error.message, "variant_not_allowed");

  const req: ImageEditRequest = {
    model,
    prompt,
    image: imageField as Blob,
    mask: maskField ? (maskField as Blob) : undefined,
    n: form["n"] ? Number(form["n"]) : undefined,
    size: form["size"] ? String(form["size"]) : undefined,
    response_format: form["response_format"]
      ? (String(form["response_format"]) as "url" | "b64_json")
      : undefined,
    user: form["user"] ? String(form["user"]) : undefined,
  };

  try {
    const result = await forwardImageEdit(model, req);
    return c.json(result);
  } catch (err) {
    return handleRouterError(err);
  }
});

/**
 * POST /v1/images/variations
 * multipart/form-data: model, image, n?, size?, response_format?, user?
 */
images.post("/v1/images/variations", async (c) => {
  const ct = c.req.header("Content-Type") ?? "";
  if (!ct.includes("multipart/form-data")) {
    return errorResponse(400, "Content-Type must be multipart/form-data", "invalid_content_type");
  }

  const form = await c.req.parseBody();
  const model = String(form["model"] ?? "");
  if (!model) return errorResponse(400, "Missing model", "missing_model");
  const imageField = form["image"];
  if (!imageField) return errorResponse(400, "Missing image", "missing_image");

  const access = checkVariantAccess(c, model);
  if (!access.ok) return errorResponse(access.status, (access.body as any).error.message, "variant_not_allowed");

  const req: ImageVariationRequest = {
    model,
    image: imageField as Blob,
    n: form["n"] ? Number(form["n"]) : undefined,
    size: form["size"] ? String(form["size"]) : undefined,
    response_format: form["response_format"]
      ? (String(form["response_format"]) as "url" | "b64_json")
      : undefined,
    user: form["user"] ? String(form["user"]) : undefined,
  };

  try {
    const result = await forwardImageVariation(model, req);
    return c.json(result);
  } catch (err) {
    return handleRouterError(err);
  }
});

export default images;
