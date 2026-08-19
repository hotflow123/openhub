import type { Context, Next } from "hono";

const adminCredentials = {
  username: process.env.OPENHUB_ADMIN_USERNAME ?? "admin",
  password: process.env.OPENHUB_ADMIN_PASSWORD ?? "admin123",
};

const TOKEN_COOKIE = "openhub_admin_token";

/**
 * 管理后台基础认证中间件
 *
 * MVP 用 HTTP Basic Auth；Phase 3 替换为 session + 用户表。
 */
export async function adminAuthMiddleware(c: Context, next: Next) {
  // 跳过登录端点本身
  if (c.req.path === "/admin/login") {
    return next();
  }

  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Basic ")) {
    const decoded = atob(auth.slice(6));
    const [u, p] = decoded.split(":");
    if (u === adminCredentials.username && p === adminCredentials.password) {
      return next();
    }
  }

  return c.json({ error: "Unauthorized" }, 401, {
    "WWW-Authenticate": 'Basic realm="OpenHub Admin"',
  });
}

export function verifyAdminCredentials(username: string, password: string): boolean {
  return username === adminCredentials.username && password === adminCredentials.password;
}

export const ADMIN_TOKEN_COOKIE = TOKEN_COOKIE;
