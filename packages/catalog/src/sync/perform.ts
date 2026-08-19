/**
 * models.dev 目录同步核心
 *
 * 流程：
 *  1. 拉取 JSON（地址可通过 ctx.url 覆盖）
 *  2. Zod 校验（schema 漂移则写 status=failed，不修改任何行）
 *  3. 用 stable() 计算每条记录的语义 hash，与库内对比
 *  4. 事务内 upsert：add/update/keep
 *  5. 远端已移除的 ID 不删除（保留供审计），只计入 removed 计数
 *  6. 同步运行记录写入 catalog_sync_runs
 */

import { nanoid } from "nanoid";
import { CatalogResponseSchema } from "../upstream/schema.js";
import { stable } from "../upstream/stable.js";
import { catalogToFields } from "./catalog-to-fields.js";
import type { SyncResult } from "./types.js";

const DEFAULT_URL = "https://models.dev/models.json";

function normalizeCatalogResponse(raw: unknown): unknown {
  if (
    raw !== null &&
    typeof raw === "object" &&
    "data" in raw &&
    Array.isArray((raw as { data?: unknown }).data)
  ) {
    return raw;
  }

  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    return {
      data: Object.entries(raw as Record<string, unknown>).map(([id, value]) =>
        value !== null && typeof value === "object" && !Array.isArray(value)
          ? { id, ...(value as Record<string, unknown>) }
          : { id, name: id },
      ),
    };
  }

  return raw;
}

export interface SyncDb {
  insertRun(values: Record<string, unknown>): Promise<void>;
  updateRun(id: string, values: Record<string, unknown>): Promise<void>;
  selectAllCatalog(): Promise<{ id: string; rawPayload: string }[]>;
  insertCatalog(values: Record<string, unknown>): Promise<void>;
  updateCatalog(id: string, values: Record<string, unknown>): Promise<void>;
}

export interface SyncOptions {
  url?: string;
  /** 同步前 hook，可用于加锁 */
  beforeSync?: () => Promise<void>;
  /** 同步后 hook */
  afterSync?: (result: SyncResult) => Promise<void>;
}

export async function performSync(
  db: SyncDb,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const url = options.url ?? process.env.MODELS_DEV_URL ?? DEFAULT_URL;
  const runId = nanoid();
  const startedAt = new Date();
  let added = 0;
  let updated = 0;
  let removed = 0;
  let total = 0;

  await options.beforeSync?.();
  await db.insertRun({
    id: runId,
    sourceUrl: url,
    status: "running",
    startedAt,
    triggeredBy: "manual",
  });

  try {
    const timeoutMs = Number(process.env.CATALOG_SYNC_TIMEOUT_MS ?? 30_000);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) {
      throw new Error("CATALOG_SYNC_TIMEOUT_MS must be at least 1000 milliseconds");
    }

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

    const raw = (await response.json()) as unknown;
    const parsed = CatalogResponseSchema.safeParse(normalizeCatalogResponse(raw));
    if (!parsed.success) {
      throw new Error(`Schema validation failed: ${parsed.error.message}`);
    }

    total = parsed.data.data.length;

    const existing = await db.selectAllCatalog();
    const existingMap = new Map<string, string>(existing.map((r) => [r.id, r.rawPayload]));

    const now = new Date();
    for (const item of parsed.data.data) {
      const rawJson = JSON.stringify(item);
      const oldRaw = existingMap.get(item.id);

      if (!oldRaw) {
        await db.insertCatalog({
          id: item.id,
          ...catalogToFields(item),
          rawPayload: rawJson,
          updatedAt: now,
        });
        added++;
      } else if (stable(JSON.parse(oldRaw)) !== stable(item)) {
        await db.updateCatalog(item.id, {
          ...catalogToFields(item),
          rawPayload: rawJson,
          updatedAt: now,
        });
        updated++;
      }
    }

    const incomingIds = new Set(parsed.data.data.map((i) => i.id));
    for (const [id] of existingMap) {
      if (!incomingIds.has(id)) removed++;
    }

    const completedAt = new Date();
    await db.updateRun(runId, {
      status: "success",
      recordCount: total,
      changedCount: added + updated,
      finishedAt: completedAt,
    });

    const result: SyncResult = {
      runId,
      status: "success",
      total,
      added,
      updated,
      removed,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    };
    await options.afterSync?.(result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.updateRun(runId, {
      status: "failed",
      errorMessage: message,
      finishedAt: new Date(),
    });
    return {
      runId,
      status: "failed",
      total,
      added,
      updated,
      removed,
      errorMessage: message,
      durationMs: Date.now() - startedAt.getTime(),
    };
  }
}