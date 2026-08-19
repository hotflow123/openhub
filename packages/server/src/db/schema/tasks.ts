import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { sites } from "./sites";
import { models } from "./models";
import { variants } from "./variants";
import { keys } from "./keys";

/**
 * 异步任务表（视频、长时间音频等）
 *
 * 状态机合法转换：
 *   pending   → processing | failed | timeout
 *   processing → completed | failed | timeout
 *   failed    → processing   (管理员手动重试)
 *
 * 所有状态更新使用条件写 `WHERE status=?`，避免并发覆盖。
 */
export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),

    // 关联
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    variantId: text("variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "cascade" }),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),

    // 归属（用于权限校验：调用方只能查自己提交的任务）
    createdByKeyId: text("created_by_key_id")
      .notNull()
      .references(() => keys.id, { onDelete: "cascade" }),

    // 幂等键（unique）。null 表示客户端未提供。
    idempotencyKey: text("idempotency_key"),

    // 站点任务标识（首次提交后写入）
    siteTaskId: text("site_task_id"),

    // 任务类型
    type: text("type", {
      enum: ["video", "audio_long", "image_variation"],
    }).notNull(),

    // 调度元数据（不含用户原始 prompt，仅存调度相关字段：duration、aspect_ratio 等）
    taskMeta: text("task_meta"),

    // 状态机
    status: text("status", {
      enum: ["pending", "processing", "completed", "failed", "timeout"],
    })
      .notNull()
      .default("pending"),

    // 结果（视频 URL 等）
    result: text("result"),
    resultExpiresAt: integer("result_expires_at", { mode: "timestamp" }),
    error: text("error"),

    // 回调
    callbackUrl: text("callback_url"),
    callbackSecret: text("callback_secret"),
    callbackAttempts: integer("callback_attempts").notNull().default(0),
    callbackNextAt: integer("callback_next_at", { mode: "timestamp" }),
    callbackDone: integer("callback_done").notNull().default(0),

    // 超时与时间戳
    maxPollingAt: integer("max_polling_at", { mode: "timestamp" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),

    // 轮询
    pollCount: integer("poll_count").notNull().default(0),
    lastPollAt: integer("last_poll_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    statusIdx: index("idx_tasks_status").on(t.status),
    keyIdx: index("idx_tasks_key").on(t.createdByKeyId),
    siteIdx: index("idx_tasks_site").on(t.siteId),
    maxPollingIdx: index("idx_tasks_max_polling").on(t.maxPollingAt),
    callbackIdx: index("idx_tasks_callback").on(t.callbackDone, t.callbackNextAt),
    idempotencyIdx: index("idx_tasks_idempotency").on(t.idempotencyKey),
  }),
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export const TASK_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "timeout",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTaskStatus(s: unknown): s is TaskStatus {
  return (
    s === "pending" ||
    s === "processing" ||
    s === "completed" ||
    s === "failed" ||
    s === "timeout"
  );
}
