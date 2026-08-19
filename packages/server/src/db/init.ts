/**
 * 数据库初始化脚本
 *
 * 启动时由 index.ts 调用：
 *  - 确保所有表存在（db:push 已生成）
 *  - Phase 2：若 model_catalog 为空且允许联网，后台跑一次 sync（失败可接受）
 */

import Database from "better-sqlite3";

const REQUIRED_TABLES = [
  "sites",
  "models",
  "keys",
  "variants",
  "model_catalog",
  "model_catalog_alias",
  "catalog_sync_runs",
  "tasks",
];

const REQUIRED_COLUMNS: Record<string, string[]> = {
  models: [
    "fal_input_schema_snapshot",
    "max_reference_images",
    "max_reference_videos",
    "max_reference_audios",
    "schema_match_status",
    "schema_match_confidence",
    "schema_match_reason",
  ],
  model_schema_alias: ["source"],
  variants: [
    "max_reference_images",
    "max_reference_videos",
    "max_reference_audios",
    "param_limits",
  ],
};

const DB_URL = process.env.OPENHUB_DB_URL ?? "./data/openhub.db";

export async function ensureSchema(): Promise<void> {
  // 直接用 better-sqlite3 查询 sqlite_master（避免 drizzle 类型复杂度）
  const sqlite = new Database(DB_URL, { readonly: false });
  try {
    const rows = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];

    const existing = new Set(rows.map((r) => r.name));
    const missing = REQUIRED_TABLES.filter((t) => !existing.has(t));

    if (missing.length > 0) {
      throw new Error(
        `Missing tables: ${missing.join(", ")}. Run 'pnpm db:push' first.`,
      );
    }

    for (const [table, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
      const columns = sqlite
        .prepare(`PRAGMA table_info(${table})`)
        .all() as Array<{ name: string }>;
      const existingColumns = new Set(columns.map((column) => column.name));
      const missingColumns = requiredColumns.filter((column) => !existingColumns.has(column));
      if (missingColumns.length > 0) {
        throw new Error(
          `Missing columns on ${table}: ${missingColumns.join(", ")}. Run the database migration before starting OpenHub.`,
        );
      }
    }
  } finally {
    sqlite.close();
  }
}

/**
 * 启动时若目录为空，触发一次目录同步（不阻塞主流程）
 *
 * 离线环境下静默失败；online 环境下后台拿到 ~500 条目录。
 */
export async function bootstrapCatalogIfEmpty(): Promise<void> {
  const sqlite = new Database(DB_URL, { readonly: true });
  let count = 0;
  try {
    const row = sqlite
      .prepare("SELECT COUNT(*) AS c FROM model_catalog")
      .get() as { c: number } | undefined;
    count = row?.c ?? 0;
  } finally {
    sqlite.close();
  }
  if (count > 0) return;

  // 动态导入避免循环依赖
  const { performSync } = await import("@openhub/catalog/sync");
  const { syncDb } = await import("../engine/catalog/db-adapter");
  try {
    const result = await performSync(syncDb);
    if (result.status === "success") {
      console.log(
        `[openhub] catalog bootstrapped: total=${result.total} added=${result.added} duration=${result.durationMs}ms`,
      );
    } else {
      console.warn(
        `[openhub] catalog bootstrap skipped (${result.errorMessage ?? "unknown"}). Run 'POST /admin/catalog/sync' later.`,
      );
    }
  } catch (err) {
    console.warn(`[openhub] catalog bootstrap skipped: ${err instanceof Error ? err.message : err}`);
  }
}

export async function initApp(): Promise<void> {
  await ensureSchema();
  
  // Phase 2: 先加载内置快照，再尝试在线同步
  const { loadSnapshot } = await import("../engine/capability/load-snapshot.js");
  await loadSnapshot();
  
  // 后台跑：失败不阻塞监听
  bootstrapCatalogIfEmpty().catch((e) =>
    console.error("[openhub] bootstrap catalog failed:", e),
  );
}
