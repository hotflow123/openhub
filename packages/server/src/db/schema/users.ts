import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * 用户表（多租户 P3）
 *
 * Phase 3 引入：取代单 admin/admin123 硬编码认证。
 * 密码存 SHA-256 + salt；token 由 jwt 颁发。
 */
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull().unique(),
    email: text("email"),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),

    role: text("role", { enum: ["admin", "user"] })
      .notNull()
      .default("user"),

    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),

    lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    usernameIdx: index("idx_users_username").on(t.username),
    statusIdx: index("idx_users_status").on(t.status),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;