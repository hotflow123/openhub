/**
 * 轮询 worker（视频/异步任务）
 *
 * 每个 POLL_INTERVAL_MS 一轮：
 *   1. 把超时的 processing 任务标记为 timeout（worker 启动时也跑一次）
 *   2. 取所有 processing 任务（限制 50 个）
 *   3. 对每个任务：调用 adapter.queryVideoTask，按结果更新状态
 *   4. 完成 / 失败 / 超时 时触发回调
 *
 * 同时跑回调 worker（独立 setInterval）。
 *
 * 设计选择：
 *  - 单进程 in-memory 调度；多实例部署需要替换为外部队列
 *  - 并发通过简单串行 + Promise.all 控制，不引入 p-limit（避免新依赖）
 */

import { resolveRouteById } from "../../routes/router";
import {
  listActiveTasks,
  listCallbackDueTasks,
  markTimeoutTasks,
  parseTaskMeta,
  parseTaskResult,
  recordCallbackFailure,
  scheduleCallback,
  writeTaskPoll,
  markCallbackDone,
  POLL_INTERVAL_MS,
  CALLBACK_BACKOFF_MIN,
} from "./service";
import { createHmac } from "node:crypto";
import { logger } from "../../lib/log";
import { mapParams } from "../param-mapper";

let pollTimer: NodeJS.Timeout | null = null;
let callbackTimer: NodeJS.Timeout | null = null;
let running = false;

export interface WorkerOptions {
  /** 是否启动定时轮询（默认 true）。测试时可设 false。 */
  enablePolling?: boolean;
  /** 是否启动回调投递 worker（默认 true） */
  enableCallback?: boolean;
  /** 轮询周期（毫秒）。默认 POLL_INTERVAL_MS */
  pollIntervalMs?: number;
  /** 回调周期（毫秒）。默认 5000 */
  callbackIntervalMs?: number;
}

export async function startWorker(opts: WorkerOptions = {}): Promise<void> {
  if (running) return;
  running = true;

  const enablePolling = opts.enablePolling ?? true;
  const enableCallback = opts.enableCallback ?? true;
  const pollInterval = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
  const callbackInterval = opts.callbackIntervalMs ?? 5_000;

  // 启动时先批量处理超时任务，再立即跑一轮
  try {
    const marked = await markTimeoutTasks();
    if (marked > 0) logger.info(`[tasks] marked ${marked} timed-out tasks on startup`);
    await pollOnce();
    await deliverCallbacksOnce();
  } catch (e) {
    logger.error("[tasks] startup poll/callback error", e);
  }

  if (enablePolling) {
    pollTimer = setInterval(() => {
      pollOnce().catch((e) => logger.error("[tasks] poll cycle error", e));
    }, pollInterval);
    pollTimer.unref?.();
  }

  if (enableCallback) {
    callbackTimer = setInterval(() => {
      deliverCallbacksOnce().catch((e) => logger.error("[tasks] callback cycle error", e));
    }, callbackInterval);
    callbackTimer.unref?.();
  }

  logger.info(
    `[tasks] worker started (poll=${enablePolling ? pollInterval + "ms" : "off"}, callback=${enableCallback ? callbackInterval + "ms" : "off"})`,
  );
}

export function stopWorker(): void {
  if (pollTimer) clearInterval(pollTimer);
  if (callbackTimer) clearInterval(callbackTimer);
  pollTimer = null;
  callbackTimer = null;
  running = false;
}

/**
 * 处理一批 pending 任务：调用 adapter.submitVideoTask，成功后置为 processing。
 * pending 任务由 POST /v1/video/generations 直接置为 pending 并立即被这一轮认领。
 */
export async function submitPendingTasks(): Promise<number> {
  const pending = await listActiveTasks();
  const submits = pending.filter((t) => t.status === "pending" && !t.siteTaskId);
  let ok = 0;
  for (const task of submits) {
    try {
      const meta = parseTaskMeta(task) ?? {};
      // 调用 adapter.submitVideoTask
      let route;
      try {
        route = await resolveRouteById(task.variantId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await markTaskFailedLocal(task.id, message);
        logger.error(`[tasks] ${task.id} route resolve failed: ${message}`);
        continue;
      }
      const { adapter, variant, model, site, apiKey } = route;

      if (!adapter.submitVideoTask) {
        await markTaskFailedLocal(task.id, "adapter does not support video.submit");
        continue;
      }

      const schemaFields = (() => {
        try {
          const parsed = variant.modelId && model.falParametersSnapshot
            ? JSON.parse(model.falParametersSnapshot)
            : [];
          return Array.isArray(parsed)
            ? parsed.map((p: { name?: unknown }) => p.name).filter((n: unknown): n is string => typeof n === "string")
            : [];
        } catch {
          return [];
        }
      })();
      const requestFields = schemaFields.length > 0
        ? schemaFields
        : Object.keys(meta).filter((field) => field !== "variant_id");
      const submitInput = mapParams({
        callerBody: { ...meta },
        variant: {
          param_overrides: variant.paramOverrides ? JSON.parse(variant.paramOverrides) : undefined,
          param_blocked: variant.paramBlocked ? JSON.parse(variant.paramBlocked) : undefined,
          field_mapping: variant.fieldMapping ? JSON.parse(variant.fieldMapping) : undefined,
          adapter_config: variant.adapterConfig ? JSON.parse(variant.adapterConfig) : undefined,
        },
        adapter: {
          // Fal Schema is the provider-specific allow-list for this model.
          knownFields: Array.from(new Set([
            ...requestFields,
            "model",
            "prompt",
            "duration",
            "aspect_ratio",
            "resolution",
            "size",
            "seed",
            "stream",
            "callback_url",
            "idempotency_key",
          ])),
        },
      }).body;
      const result = await adapter.submitVideoTask(submitInput, {
        targetUrl: site.baseUrl,
        apiKey,
        config: variant.adapterConfig ? JSON.parse(variant.adapterConfig) : undefined,
      });

      // pending → processing（条件更新）
      const { markTaskProcessing } = await import("./service");
      const updated = await markTaskProcessing(task.id, result.siteTaskId);
      if (updated) {
        ok++;
        logger.info(`[tasks] ${task.id} submitted, site_task_id=${result.siteTaskId}`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await markTaskFailedLocal(task.id, message);
      logger.error(`[tasks] ${task.id} submit failed: ${message}`);
    }
  }
  return ok;
}

async function markTaskFailedLocal(id: string, error: string): Promise<void> {
  const { markTaskFailed } = await import("./service");
  await markTaskFailed(id, error).catch(() => {});
  await scheduleCallback(id).catch(() => {});
}

/**
 * 一轮轮询：把所有 processing 任务向站点查询一次
 */
export async function pollOnce(): Promise<void> {
  // 先把已超时但状态为 processing 的任务标 timeout
  await markTimeoutTasks().catch(() => {});

  // 把 pending 任务提交到站点
  await submitPendingTasks();

  const active = await listActiveTasks();
  const processing = active.filter((t) => t.status === "processing" && t.siteTaskId);

  for (const task of processing) {
    try {
      const route = await resolveRouteById(task.variantId);
      const { adapter, variant, site, apiKey } = route;

      if (!adapter.queryVideoTask) {
        continue;
      }

      const result = await adapter.queryVideoTask(task.siteTaskId!, {
        targetUrl: site.baseUrl,
        apiKey,
        config: variant.adapterConfig ? JSON.parse(variant.adapterConfig) : undefined,
      });

      const raw = (result as { raw?: unknown }).raw;
      const statusField =
        typeof raw === "object" && raw !== null && "status" in raw
          ? (raw as { status?: unknown }).status
          : result.status;
      const mappedStatus = adapter.mapVideoStatus
        ? adapter.mapVideoStatus(statusField)
        : (statusField as "pending" | "processing" | "completed" | "failed" | "timeout");

      const completedNow = new Date();

      // 只在真正终态时写 completed_at
      const updated = await writeTaskPoll(task.id, "processing", {
        status: mappedStatus,
        result: result.result ? JSON.stringify(result.result) : null,
        resultExpiresAt: (result as { result_expires_at?: Date }).result_expires_at ?? null,
        error: result.error ?? null,
        completedAt:
          mappedStatus === "completed" || mappedStatus === "failed"
            ? completedNow
            : null,
      });

      if (!updated) {
        // 状态被别人改了（管理员重试等），跳过本轮
        continue;
      }

      if (mappedStatus === "completed" || mappedStatus === "failed" || mappedStatus === "timeout") {
        await scheduleCallback(task.id);
        logger.info(`[tasks] ${task.id} → ${mappedStatus}`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error(`[tasks] poll error for ${task.id}: ${message}`);
      // 单任务失败不影响其他任务
    }
  }
}

/**
 * 一轮回调投递
 */
export async function deliverCallbacksOnce(): Promise<void> {
  const due = await listCallbackDueTasks();
  for (const task of due) {
    try {
      const payload = JSON.stringify({
        event:
          task.status === "completed"
            ? "task.completed"
            : task.status === "timeout"
              ? "task.timeout"
              : "task.failed",
        id: task.id,
        status: task.status,
        result: parseTaskResult(task),
        error: task.error,
        timestamp: Date.now(),
      });

      const sig = task.callbackSecret
        ? "sha256=" + createHmac("sha256", task.callbackSecret).update(payload).digest("hex")
        : undefined;

      const resp = await fetch(task.callbackUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sig ? { "X-OpenHub-Signature": sig } : {}),
        },
        body: payload,
        signal: AbortSignal.timeout(10_000),
      });

      if (resp.ok) {
        await markCallbackDone(task.id);
        logger.info(`[tasks] callback delivered for ${task.id}`);
      } else {
        await recordCallbackFailure(task.id, task.callbackAttempts);
        logger.warn(
          `[tasks] callback ${task.id} non-2xx (${resp.status}), next attempt in ${
            CALLBACK_BACKOFF_MIN[task.callbackAttempts] ?? "?"
          }m`,
        );
      }
    } catch (e) {
      await recordCallbackFailure(task.id, task.callbackAttempts);
      logger.error(`[tasks] callback ${task.id} threw`, e);
    }
  }
}
