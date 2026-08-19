import { Hono } from "hono";
import { desc, eq, and } from "drizzle-orm";
import { db } from "../../db/index";
import { auditLog } from "../../db/schema/index";
import { withAdminAuth } from "./_with-auth";

const audit = new Hono();
withAdminAuth(audit);

audit.get("/audit", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
  const action = c.req.query("action");
  const actor = c.req.query("actor");

  const conditions = [] as any[];
  if (action) conditions.push(eq(auditLog.action, action));
  if (actor) conditions.push(eq(auditLog.actor, actor));

  const where = conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);

  const rows = await db
    .select()
    .from(auditLog)
    .where(where as any)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .offset(offset);
  return c.json({ data: rows });
});

audit.get("/audit/stats", async (c) => {
  const [total] = await db
    .select({ count: sql<number>`count(*)` })
    .from(auditLog);
  return c.json({ data: { total: total?.count ?? 0 } });
});

import { sql } from "drizzle-orm";

export default audit;