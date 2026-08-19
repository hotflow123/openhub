/**
 * 异步任务服务（视频等）
 *
 * 负责：
 *  - 提交任务（带幂等）
 *  - 状态机条件更新（pending/processing/completed/failed/timeout）
 *  - 启动时恢复超时任务
 *  - 调度回调
 *
 * 注意：本文件不直接调用 adapter 提交站点任务，submit 由 worker 完成，
 * 此处只负责 OpenHub 侧的任务表 CRUD。
 */

import { and, eq, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import { db } from "../../db/index";
import { tasks, type Task, type NewTask } from "../../db/schema/index";

export const POLLING_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h
export const POLL_INTERVAL_MS = 10_000; // 10s 轮询周期
export const CALLBACK_BACKOFF_MIN = [1, 5, 30, 120, 360]; // 1m / 5m / 30m / 2h / 6h

/**
 * 创建任务（含幂等性检查）。
 * 返回 { task, created } —— created=false 表示命中已有幂等任务。
 */
export async function createTask(input: {
  siteId: string;
  variantId: string;
  modelId: string;
  createdByKeyId: string;
  type: "video" | "audio_long" | "image_variation";
  idempotencyKey?: string | null;
  taskMeta?: Record<string, unknown> | null;
  callbackUrl?: string | null;
  callbackSecret?: string | null;
}): Promise<{ task: Task; created: boolean }> {
  if (input.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existing) {
      // 命中幂等：复用旧任务
      return { task: existing, created: false };
    }
  }

  const now = new Date();
  const id = `task_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const newRow: NewTask = {
    id,
    siteId: input.siteId,
    variantId: input.variantId,
    modelId: input.modelId,
    createdByKeyId: input.createdByKeyId,
    type: input.type,
    idempotencyKey: input.idempotencyKey ?? null,
    taskMeta: input.taskMeta ? JSON.stringify(input.taskMeta) : null,
    callbackUrl: input.callbackUrl ?? null,
    callbackSecret: input.callbackSecret ?? null,
    status: "pending",
    maxPollingAt: new Date(now.getTime() + POLLING_TIMEOUT_MS),
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.insert(tasks).values(newRow);
  } catch (e: unknown) {
    // 幂等键冲突（并发提交）
    if (
      input.idempotencyKey &&
      e instanceof Error &&
      /UNIQUE/i.test(e.message)
    ) {
      const [existing] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing) return { task: existing, created: false };
    }
    throw e;
  }

  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task) throw new Error("Task created but not found immediately after insert");
  return { task, created: true };
}

/**
 * 取出活跃任务（pending/processing 且未超时），按 last_poll_at 升序优先处理最久未查的
 */
export async function listActiveTasks(limit = 50): Promise<Task[]> {
  const now = new Date();
  return db
    .select()
    .from(tasks)
    .where(
      and(
        inArray(tasks.status, ["pending", "processing"]),
        sql`(${tasks.maxPollingAt} IS NULL OR ${tasks.maxPollingAt} > ${now.getTime() / 1000})`,
      ),
    )
    .orderBy(sql`${tasks.lastPollAt} IS NULL DESC`, tasks.lastPollAt)
    .limit(limit);
}

/**
 * 取出回调待投递的任务
 */
export async function listCallbackDueTasks(limit = 20): Promise<Task[]> {
  const now = new Date();
  return db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.callbackDone, 0),
        isNotNull(tasks.callbackUrl),
        isNotNull(tasks.callbackNextAt),
        lte(tasks.callbackNextAt, now),
        lt(tasks.callbackAttempts, 5),
      ),
    )
    .limit(limit);
}

/**
 * 启动时批量标记已超时的任务
 */
export async function markTimeoutTasks(): Promise<number> {
  const now = new Date();
  const result = await db
    .update(tasks)
    .set({ status: "timeout", updatedAt: now })
    .where(
      and(
        inArray(tasks.status, ["pending", "processing"]),
        lt(tasks.maxPollingAt, now),
      ),
    );
  return Number((result as { rowsAffected?: number }).rowsAffected ?? 0);
}

/**
 * 条件更新任务状态（防止并发覆盖）
 * 返回是否真的更新了一行。
 */
export async function updateTaskStatus(
  id: string,
  expected: Task["status"],
  patch: Partial<Task>,
): Promise<boolean> {
  const now = new Date();
  const result = await db
    .update(tasks)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(tasks.id, id), eq(tasks.status, expected)));
  return Number((result as { rowsAffected?: number }).rowsAffected ?? 0) > 0;
}

/**
 * 写入 site_task_id 并把状态推到 processing（worker 成功提交站点后调用）
 */
export async function markTaskProcessing(id: string, siteTaskId: string): Promise<boolean> {
  return updateTaskStatus(id, "pending", {
    siteTaskId,
    status: "processing",
    startedAt: new Date(),
    lastPollAt: new Date(),
    pollCount: sql`${tasks.pollCount} + 1` as unknown as number,
  });
}

/**
 * Worker 提交站点失败时调用
 */
export async function markTaskFailed(id: string, error: string): Promise<boolean> {
  const now = new Date();
  return updateTaskStatus(id, "pending", {
    status: "failed",
    error,
    completedAt: now,
  });
}

/**
 * Worker 轮询站点后写入结果
 */
export async function writeTaskPoll(
  id: string,
  expected: Task["status"],
  patch: {
    status: Task["status"];
    result?: string | null;
    resultExpiresAt?: Date | null;
    error?: string | null;
    completedAt?: Date | null;
  },
): Promise<boolean> {
  const now = new Date();
  const update: Partial<Task> = {
    ...patch,
    lastPollAt: now,
    pollCount: sql`${tasks.pollCount} + 1` as unknown as number,
  };
  return updateTaskStatus(id, expected, update);
}

/**
 * 触发回调：把 callback_next_at 设为当前时刻，由 callback worker 取出并投递
 */
export async function scheduleCallback(id: string): Promise<boolean> {
  const now = new Date();
  const result = await db
    .update(tasks)
    .set({ callbackNextAt: now, updatedAt: now })
    .where(and(eq(tasks.id, id), eq(tasks.callbackDone, 0)));
  return Number((result as { rowsAffected?: number }).rowsAffected ?? 0) > 0;
}

/**
 * 回调投递失败：累加 attempts、按退避表设 callback_next_at
 */
export async function recordCallbackFailure(id: string, attempts: number): Promise<void> {
  const now = new Date();
  const delayMin = CALLBACK_BACKOFF_MIN[attempts] ?? CALLBACK_BACKOFF_MIN[CALLBACK_BACKOFF_MIN.length - 1];
  const nextAt = new Date(now.getTime() + delayMin * 60 * 1000);
  await db
    .update(tasks)
    .set({
      callbackAttempts: sql`${tasks.callbackAttempts} + 1`,
      callbackNextAt: nextAt,
      updatedAt: now,
    })
    .where(eq(tasks.id, id));
}

export async function markCallbackDone(id: string): Promise<void> {
  const now = new Date();
  await db
    .update(tasks)
    .set({ callbackDone: 1, updatedAt: now })
    .where(eq(tasks.id, id));
}

/**
 * 取出单个任务
 */
export async function getTask(id: string): Promise<Task | undefined> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return task;
}

/**
 * 把 result 字段解析为对象
 */
export function parseTaskResult(task: Task): Record<string, unknown> | null {
  if (!task.result) return null;
  try {
    return JSON.parse(task.result);
  } catch {
    return null;
  }
}

/**
 * 把 task_meta 字段解析为对象
 */
export function parseTaskMeta(task: Task): Record<string, unknown> | null {
  if (!task.taskMeta) return null;
  try {
    return JSON.parse(task.taskMeta);
  } catch {
    return null;
  }
}
