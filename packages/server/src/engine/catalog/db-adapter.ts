/**
 * server 包 ↔ catalog 包之间的 DB 适配层
 *
 * 把 catalog 包定义的抽象 DB 操作（SyncDb / MatcherDb）映射到具体的
 * drizzle/better-sqlite3 调用，避免 catalog 包反向依赖 server 包。
 */

import { and, asc, desc, eq, like } from "drizzle-orm";
import { db } from "../../db/index";
import { modelCatalog, modelCatalogAlias, catalogSyncRuns } from "../../db/schema/index";
import type { SyncDb } from "@openhub/catalog/sync";
import type { AliasDb, AliasEntry } from "@openhub/catalog/sync";
import type { MatcherDb } from "@openhub/catalog/matcher";

/**
 * Date 对象转秒级时间戳（数据库存储格式）
 */
function toSeconds(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n / 1000) : null;
}

/**
 * 秒级时间戳转毫秒（供前端显示）
 */
function toMs(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n * 1000;
}

export const syncDb: SyncDb = {
  async insertRun(values) {
    const adapted = {
      ...values,
      startedAt: toSeconds(values.startedAt),
    };
    await db.insert(catalogSyncRuns).values(adapted as any);
  },
  async updateRun(id, values) {
    const adapted = { ...values };
    if ("finishedAt" in adapted) {
      (adapted as any).finishedAt = toSeconds((adapted as any).finishedAt);
    }
    await db.update(catalogSyncRuns).set(adapted as any).where(eq(catalogSyncRuns.id, id));
  },
  async selectAllCatalog() {
    return db
      .select({ id: modelCatalog.id, rawPayload: modelCatalog.rawPayload })
      .from(modelCatalog);
  },
  async insertCatalog(values) {
    await db.insert(modelCatalog).values(values as any);
  },
  async updateCatalog(id, values) {
    await db.update(modelCatalog).set(values as any).where(eq(modelCatalog.id, id));
  },
};

export const aliasDb: AliasDb = {
  async replaceAliases(rows) {
    await db.delete(modelCatalogAlias);
    const batchSize = 200;
    for (let start = 0; start < rows.length; start += batchSize) {
      await db.insert(modelCatalogAlias).values(rows.slice(start, start + batchSize) as AliasEntry[]);
    }
  },
};

export const matcherDb: MatcherDb = {
  async findCatalogById(id) {
    const [row] = await db
      .select({ id: modelCatalog.id })
      .from(modelCatalog)
      .where(eq(modelCatalog.id, id))
      .limit(1);
    return row;
  },
  async findCatalogByNormalized(normalized) {
    const [row] = await db
      .select({ id: modelCatalogAlias.catalogId })
      .from(modelCatalogAlias)
      .where(
        and(
          eq(modelCatalogAlias.normalized, normalized),
          eq(modelCatalogAlias.aliasType, "exact"),
        ),
      )
      .limit(1);
    return row;
  },
  async findCatalogAlias(normalized) {
    const [row] = await db
      .select({ catalogId: modelCatalogAlias.catalogId })
      .from(modelCatalogAlias)
      .where(eq(modelCatalogAlias.normalized, normalized))
      .orderBy(modelCatalogAlias.priority, modelCatalogAlias.catalogId)
      .limit(1);
    return row;
  },
  async findCatalogByFamily(family) {
    const [row] = await db
      .select({ id: modelCatalog.id })
      .from(modelCatalog)
      .where(eq(modelCatalog.family, family))
      .limit(1);
    return row;
  },
  async findCatalogByIdPrefix(prefix) {
    // 将 "jimeng/" 转换为 "jimeng/%" 以匹配任意后缀
    // catalog 包传入的前缀是 "jimeng/" 形式，需要添加通配符
    const pattern = prefix.endsWith("/") ? prefix + "%" : prefix;
    const [row] = await db
      .select({ id: modelCatalog.id })
      .from(modelCatalog)
      .where(like(modelCatalog.id, pattern))
      .limit(1);
    return row;
  },
};
