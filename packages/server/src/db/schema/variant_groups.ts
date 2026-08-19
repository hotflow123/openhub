import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { variants } from "./variants";
import { sites } from "./sites";

/**
 * 变体组（多站点降级 P2）
 *
 * 一个 variant_group 包含多个 variants，按优先级顺序排序。
 * 路由时：第一个 site 健康就选它，否则降级到下一个。
 */
export const variantGroups = sqliteTable(
  "variant_groups",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description"),
    strategy: text("strategy", {
      enum: ["priority", "round_robin", "least_latency"],
    })
      .notNull()
      .default("priority"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
);

export type VariantGroup = typeof variantGroups.$inferSelect;
export type NewVariantGroup = typeof variantGroups.$inferInsert;

/**
 * 变体组成员（关联表）
 */
export const variantGroupMembers = sqliteTable(
  "variant_group_members",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => variantGroups.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "cascade" }),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull().default(50),
    weight: integer("weight").notNull().default(1),
    enabled: integer("enabled").notNull().default(1),
  },
  (t) => ({
    groupIdx: index("idx_vgm_group").on(t.groupId),
    variantIdx: index("idx_vgm_variant").on(t.variantId),
  }),
);

export type VariantGroupMember = typeof variantGroupMembers.$inferSelect;
export type NewVariantGroupMember = typeof variantGroupMembers.$inferInsert;