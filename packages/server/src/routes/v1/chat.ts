import { Hono } from "hono";
import { authMiddleware, checkVariantAccess } from "../../middleware/auth";
import { forwardChat, forwardChatStream, RouterError } from "../router";
import { mapParams } from "../../engine/param-mapper";
import type { ChatRequest } from "../../engine/adapter";
import type { Variant } from "../../db/schema/index";

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
    const { eq } = await import("drizzle-orm");
    const { db } = await import("../../db/index");
    const { variants } = await import("../../db/schema/index");
    const [variant] = await db
      .select()
      .from(variants)
      .where(eq(variants.name, variantId))
      .limit(1);

    const body = applyVariantParamMapping(rawBody as Record<string, unknown>, variant);

    if (body.stream) {
      const upstream = await forwardChatStream(variantId, body);
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.headers.get("Content-Type") ?? "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const response = await forwardChat(variantId, body);
    return c.json(response);
  } catch (err) {
    return handleRouterError(err);
  }
});

/**
 * 应用 variant 上的 param_overrides / param_blocked / field_mapping
 * （DESIGN 第 7 章"variants"表的三字段拆分）
 */
function applyVariantParamMapping(
  body: Record<string, unknown>,
  variant: Variant | undefined,
): ChatRequest {
  if (!variant) return body as ChatRequest;
  try {
    const { body: mapped } = mapParams({
      callerBody: body,
      variant: {
        param_overrides: variant.paramOverrides ? JSON.parse(variant.paramOverrides) : undefined,
        param_blocked: variant.paramBlocked ? JSON.parse(variant.paramBlocked) : undefined,
        field_mapping: variant.fieldMapping ? JSON.parse(variant.fieldMapping) : undefined,
        adapter_config: variant.adapterConfig ? JSON.parse(variant.adapterConfig) : undefined,
      },
      adapter: {}, // adapter 内部配置随 variant 走
    });
    return mapped as unknown as ChatRequest;
  } catch (e) {
    console.error("[chat] param apply failed:", e);
    return body as ChatRequest;
  }
}

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