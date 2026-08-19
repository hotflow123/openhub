import type { Context, Next } from "hono";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index";
import { keys } from "../db/schema/index";
import { hashToken } from "../lib/token";
import { checkRateLimit } from "./rate-limit";

declare module "hono" {
  interface ContextVariableMap {
    hubKey: {
      id: string;
      name: string;
      allowedVariantIds: string[] | null;
      rateLimit: number | null;
    };
  }
}

/**
 * Hub 虚拟 Key 鉴权中间件
 *
 * 从 Authorization: Bearer <token> 中解析 token，校验 SHA-256 hash 是否在 keys 表中。
 */
export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json(
      {
        error: {
          message: "Missing or invalid Authorization header",
          type: "invalid_request_error",
          code: "missing_auth",
        },
      },
      401,
    );
  }

  const token = authHeader.slice(7).trim();
  const tokenHash = hashToken(token);

  const [record] = await db
    .select()
    .from(keys)
    .where(eq(keys.keyHash, tokenHash))
    .limit(1);

  if (!record) {
    return c.json(
      {
        error: {
          message: "Invalid API key",
          type: "invalid_request_error",
          code: "invalid_key",
        },
      },
      401,
    );
  }

  // P0-1: revoked 状态立即拒绝
  if (record.status === "revoked") {
    return c.json(
      {
        error: {
          message: "API key has been revoked",
          type: "invalid_request_error",
          code: "revoked_key",
        },
      },
      401,
    );
  }

  c.set("hubKey", {
    id: record.id,
    name: record.name,
    allowedVariantIds: record.allowedVariantIds ? JSON.parse(record.allowedVariantIds) : null,
    rateLimit: null, // use_count 字段用于统计，限速策略在 rate-limit.ts 内统一处理
  });

  // P0-2: 速率限制头（即便未启用也写入 -1 标记客户端）
  const rl = checkRateLimit(record.id, null);
  c.header("X-RateLimit-Limit", String(rl.limit));
  c.header("X-RateLimit-Remaining", String(Math.max(0, rl.remaining)));
  if (!rl.ok) {
    c.header("Retry-After", String(rl.retryAfterSec ?? 60));
    return c.json(
      {
        error: {
          message: `Rate limit exceeded (${rl.limit}/min). Retry after ${rl.retryAfterSec ?? 60}s.`,
          type: "rate_limit_error",
          code: "rate_limited",
        },
      },
      429,
    );
  }

  // 异步更新 last_used + use_count（不阻塞）
  db.update(keys)
    .set({
      lastUsed: new Date(),
      useCount: sql`${keys.useCount} + 1`,
    })
    .where(eq(keys.id, record.id))
    .catch(() => {});

  return next();
}

/**
 * 校验该 key 是否有权访问某个 variant
 */
export function checkVariantAccess(
  c: Context,
  variantId: string,
): { ok: true } | { ok: false; status: number; body: unknown } {
  const hubKey = c.get("hubKey");
  if (hubKey.allowedVariantIds && !hubKey.allowedVariantIds.includes(variantId)) {
    return {
      ok: false,
      status: 403,
      body: {
        error: {
          message: `Key is not authorized to use variant ${variantId}`,
          type: "permission_error",
          code: "variant_not_allowed",
        },
      },
    };
  }
  return { ok: true };
}