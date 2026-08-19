import { Hono } from "hono";
import { authMiddleware, checkVariantAccess } from "../../middleware/auth";
import { forwardChat, forwardChatStream, RouterError } from "../router";
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

  const access = checkVariantAccess(c, variantId);
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
  if (err instanceof RouterError) {
    return new Response(
      JSON.stringify({
        error: { message: err.message, type: "router_error", code: err.code },
      }),
      { status: err.status, headers: { "Content-Type": "application/json" } },
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return new Response(
    JSON.stringify({ error: { message, type: "upstream_error" } }),
    { status: 502, headers: { "Content-Type": "application/json" } },
  );
}

export default chat;
