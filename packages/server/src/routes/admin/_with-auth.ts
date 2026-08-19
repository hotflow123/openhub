/**
 * 公共管理员鉴权中间件
 *
 * 五个 admin 子 app 各自 import 并 use 这个中间件。
 */

import { Hono } from "hono";
import { adminAuthMiddleware } from "../../middleware/admin-auth";

export function withAdminAuth(app: Hono): void {
  app.use("*", adminAuthMiddleware);
}
