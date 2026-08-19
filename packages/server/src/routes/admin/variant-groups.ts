/**
 * 变体组管理（P2）— 多站点降级
 *
 * 业务场景：同一逻辑模型有多个站点实现（如 gpt-4o 在 OpenAI 主站 + Azure 备份），
 * 当首选站点不可用时，按 priority/weight 自动降级到下一个。
 */
import { Hono } from "hono";
import { z } from "zod";
import { eq, asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../../db/index";
import { variantGroups, variantGroupMembers, variants, sites } from "../../db/schema/index";
import { writeAudit } from "../../lib/audit";
import { withAdminAuth } from "./_with-auth";

const groups = new Hono();
withAdminAuth(groups);

const CreateGroupSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().optional(),
  strategy: z.enum(["priority", "round_robin", "least_latency"]).default("priority"),
  members: z
    .array(
      z.object({
        variantId: z.string(),
        siteId: z.string(),
        priority: z.number().int().min(0).max(100).default(50),
        weight: z.number().int().min(1).max(100).default(1),
      }),
    )
    .min(1),
});

groups.get("/variant-groups", async (c) => {
  const rows = await db.select().from(variantGroups);
  // 把 members 一并返回
  const all = await db.select().from(variantGroupMembers).orderBy(asc(variantGroupMembers.priority));
  const byGroup = new Map();
  for (const m of all) {
    if (!byGroup.has(m.groupId)) byGroup.set(m.groupId, []);
    byGroup.get(m.groupId).push(m);
  }
  return c.json({
    data: rows.map((g) => ({ ...g, members: byGroup.get(g.id) ?? [] })),
  });
});

groups.post("/variant-groups", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateGroupSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const id = nanoid();
  try {
    await db.insert(variantGroups).values({
      id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      strategy: parsed.data.strategy,
    });
    for (const m of parsed.data.members) {
      await db.insert(variantGroupMembers).values({
        id: nanoid(),
        groupId: id,
        variantId: m.variantId,
        siteId: m.siteId,
        priority: m.priority,
        weight: m.weight,
        enabled: 1,
      });
    }
  } catch (e) {
    return c.json({ error: { message: e instanceof Error ? e.message : String(e) } }, 400);
  }
  await writeAudit({
    actor: "admin",
    action: "variant_group.create",
    resourceType: "variant_group",
    resourceId: id,
    payload: JSON.stringify({ name: parsed.data.name, members: parsed.data.members.length }),
  });
  return c.json({ data: { id, ...parsed.data } }, 201);
});

groups.delete("/variant-groups/:id", async (c) => {
  const id = c.req.param("id");
  await db.delete(variantGroups).where(eq(variantGroups.id, id));
  await writeAudit({
    actor: "admin",
    action: "variant_group.delete",
    resourceType: "variant_group",
    resourceId: id,
  });
  return c.json({ data: { id, deleted: true } });
});

/**
 * P2 关键：resolveGroupVariant
 * 给定 group 名称 + 当前负载状态，按 strategy 选出一个可用的 variant + site 组合。
 * 这是 router.ts 多站点降级链路的入口。
 */
export async function resolveGroupVariant(groupName: string): Promise<{
  variant: typeof variants.$inferSelect;
  site: typeof sites.$inferSelect;
} | null> {
  const [group] = await db
    .select()
    .from(variantGroups)
    .where(eq(variantGroups.name, groupName))
    .limit(1);
  if (!group) return null;

  const members = await db
    .select()
    .from(variantGroupMembers)
    .where(eq(variantGroupMembers.groupId, group.id))
    .orderBy(asc(variantGroupMembers.priority));

  for (const m of members) {
    if (!m.enabled) continue;
    const [site] = await db.select().from(sites).where(eq(sites.id, m.siteId)).limit(1);
    if (!site || site.status !== "active") continue;
    const [variant] = await db.select().from(variants).where(eq(variants.id, m.variantId)).limit(1);
    if (!variant) continue;
    return { variant, site };
  }
  return null;
}

export default groups;