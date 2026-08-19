import { Hono } from "hono";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "../../db/index";
import { keys } from "../../db/schema/index";
import { generateVirtualKey } from "../../lib/token";
import { writeAudit } from "../../lib/audit";
import { withAdminAuth } from "./_with-auth";

const keysRoute = new Hono();
withAdminAuth(keysRoute);

const CreateKeySchema = z.object({
  name: z.string().min(1).max(64),
  allowedVariantIds: z.array(z.string()).max(100).optional(),
});

keysRoute.get("/keys", async (c) => {
  const rows = await db
    .select({
      id: keys.id,
      keyPrefix: keys.keyPrefix,
      keySuffix: keys.keySuffix,
      name: keys.name,
      allowedVariantIds: keys.allowedVariantIds,
      status: keys.status,
      revokedAt: keys.revokedAt,
      lastUsed: keys.lastUsed,
      useCount: keys.useCount,
      createdAt: keys.createdAt,
    })
    .from(keys)
    .orderBy(desc(keys.createdAt));
  return c.json({ data: rows });
});

keysRoute.post("/keys", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateKeySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const { raw, hash, prefix, suffix } = generateVirtualKey();
  const id = crypto.randomUUID();

  await db.insert(keys).values({
    id,
    keyHash: hash,
    keyPrefix: prefix,
    keySuffix: suffix,
    name: parsed.data.name,
    allowedVariantIds: parsed.data.allowedVariantIds
      ? JSON.stringify(parsed.data.allowedVariantIds)
      : null,
    status: "active",
  });

  await writeAudit({
    actor: "admin",
    action: "key.create",
    resourceType: "key",
    resourceId: id,
    payload: JSON.stringify({ name: parsed.data.name }),
  });

  return c.json({ data: { id, key: raw, prefix, suffix, name: parsed.data.name } }, 201);
});

keysRoute.delete("/keys/:id", async (c) => {
  const id = c.req.param("id");
  // 物理删除（虽然 audit_log 保留操作记录）
  await db.delete(keys).where(eq(keys.id, id));
  await writeAudit({
    actor: "admin",
    action: "key.delete",
    resourceType: "key",
    resourceId: id,
  });
  return c.json({ data: { id, deleted: true } });
});

/**
 * P0-1: 撤销 API Key
 * 把 status 设为 revoked + revoked_at = now。Key 立即失效（authMiddleware 校验）
 * 但保留记录用于审计。再次撤销 / 删除已撤销的 key 都是 no-op。
 */
keysRoute.post("/keys/:id/revoke", async (c) => {
  const id = c.req.param("id");
  const [row] = await db
    .select({ id: keys.id, status: keys.status, revokedAt: keys.revokedAt })
    .from(keys)
    .where(eq(keys.id, id))
    .limit(1);
  if (!row) return c.json({ error: "Key not found" }, 404);
  if (row.status === "revoked") {
    return c.json({
      data: {
        id: row.id,
        status: row.status,
        revoked_at: row.revokedAt ? Math.floor(row.revokedAt.getTime() / 1000) : null,
        already_revoked: true,
      },
    });
  }
  const now = new Date();
  await db.update(keys).set({ status: "revoked", revokedAt: now }).where(eq(keys.id, id));
  await writeAudit({
    actor: "admin",
    action: "key.revoke",
    resourceType: "key",
    resourceId: id,
  });
  return c.json({
    data: {
      id,
      status: "revoked",
      revoked_at: Math.floor(now.getTime() / 1000),
    },
  });
});

export default keysRoute;