import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * 审计日志
 *
 * 记录所有 admin 操作和重要运行时事件。Phase 2 P2 安全项。
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actor: text("actor").notNull(), // "admin" | key_id | "system"
    action: text("action").notNull(), // "site.create" | "site.delete" | "key.revoke" | ...
    resourceType: text("resource_type"), // "site" | "variant" | "key" | ...
    resourceId: text("resource_id"),
    payload: text("payload"), // JSON 快照
    ip: text("ip"),
    userAgent: text("user_agent"),
    status: text("status", { enum: ["success", "failed"] })
      .notNull()
      .default("success"),
    errorMessage: text("error_message"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    actorIdx: index("idx_audit_actor").on(t.actor),
    actionIdx: index("idx_audit_action").on(t.action),
    resourceIdx: index("idx_audit_resource").on(t.resourceType, t.resourceId),
    createdIdx: index("idx_audit_created").on(t.createdAt),
  }),
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;