import { Hono } from "hono";
import { authMiddleware, checkVariantAccess } from "../../middleware/auth";
import { forwardChat, forwardChatStream, normalizeRouterError } from "../router";
import type { ChatRequest } from "../../engine/adapter";

const chat = new Hono();

chat.use("/v1/chat/*", authMiddleware);

/**
 * POST /v1/chat/completions
 */
chat.post("/v1/chat/completions", async (c) => {
  const rawBody = (await c.req.json()) as Record<string, unknown> & ChatRequest;
  const variantId = rawBody.model;
  if (!variantId) {
    return c.json(
      {
        error: {
          message: "Missing model (variant name) in request body",
          type: "invalid_request_error",
          code: "missing_model",
        },
      },
      400,
    );
  }

  const access = await checkVariantAccess(c, variantId);
  if (!access.ok) {
    return c.json(access.body, access.status as 401 | 403);
  }

  try {
    if (rawBody.stream) {
      const upstream = await forwardChatStream(variantId, rawBody);
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.headers.get("Content-Type") ?? "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const response = await forwardChat(variantId, rawBody);
    return c.json(response);
  } catch (err) {
    return handleRouterError(err);
  }
});

function handleRouterError(err: unknown): Response {
  const routerError = normalizeRouterError(err);
  return new Response(
    JSON.stringify({ error: { message: routerError.message, type: "router_error", code: routerError.code, details: routerError.details } }),
    { status: routerError.status, headers: { "Content-Type": "application/json" } },
  );
}

export default chat;
