/**
 * 管理后台 /admin/tasks 路由（仅查看，不做手动重试——Phase 4 再补）
 */

import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index";
import { tasks } from "../../db/schema/index";
import { withAdminAuth } from "./_with-auth";

const tasksRoute = new Hono();
withAdminAuth(tasksRoute);

tasksRoute.get("/tasks", async (c) => {
  const status = c.req.query("status");
  const rows = await db
    .select()
    .from(tasks)
    .where(status ? eq(tasks.status, status as any) : undefined)
    .orderBy(desc(tasks.createdAt))
    .limit(100);
  return c.json({
    data: rows.map((t) => ({
      id: t.id,
      site_id: t.siteId,
      variant_id: t.variantId,
      model_id: t.modelId,
      type: t.type,
      status: t.status,
      site_task_id: t.siteTaskId,
      created_at: Math.floor(t.createdAt.getTime() / 1000),
      started_at: t.startedAt ? Math.floor(t.startedAt.getTime() / 1000) : null,
      completed_at: t.completedAt ? Math.floor(t.completedAt.getTime() / 1000) : null,
      error: t.error,
      poll_count: t.pollCount,
      callback_done: !!t.callbackDone,
    })),
  });
});

tasksRoute.get("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task) return c.json({ error: "Not found" }, 404);
  return c.json({ data: task });
});

export default tasksRoute;
