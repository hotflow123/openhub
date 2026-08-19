import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * New API 站点表
 *
 * 字段定义：DESIGN.md 第 7 章 "sites"
 */
export const sites = sqliteTable(
  "sites",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    apiKeyEnc: text("api_key_enc").notNull(),
    apiKeyIv: text("api_key_iv").notNull(),
    adapterId: text("adapter_id").notNull().default("openai"),
    status: text("status", { enum: ["active", "disabled", "error"] })
      .notNull()
      .default("active"),
    errorCount: integer("error_count").notNull().default(0),
    lastCheck: integer("last_check", { mode: "timestamp" }),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    statusIdx: index("idx_sites_status").on(t.status),
  }),
);

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;