import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { sites } from "./sites";

/**
 * Hub 对外发行的虚拟 Key
 *
 * 字段定义：DESIGN.md 第 7 章 "api_keys"
 */
export const keys = sqliteTable(
  "keys",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    keyPrefix: text("key_prefix").notNull(),
    keySuffix: text("key_suffix").notNull(),

    allowedVariantIds: text("allowed_variant_ids"),

    status: text("status", { enum: ["active", "revoked"] })
      .notNull()
      .default("active"),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),

    lastUsed: integer("last_used", { mode: "timestamp" }),
    useCount: integer("use_count").notNull().default(0),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    hashIdx: index("idx_api_keys_hash").on(t.keyHash),
    statusIdx: index("idx_api_keys_status").on(t.status),
  }),
);

export type VirtualKey = typeof keys.$inferSelect;
export type NewVirtualKey = typeof keys.$inferInsert;