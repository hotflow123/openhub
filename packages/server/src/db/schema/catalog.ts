import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * models.dev 官方模型目录镜像表
 *
 * 字段定义：DESIGN.md 第 7 章 "model_catalog"
 * 一次同步 = 一份完整快照；upsert 按 id。
 * raw_payload 保留上游完整 JSON。
 */
export const modelCatalog = sqliteTable(
  "model_catalog",
  {
    id: text("id").primaryKey(), // e.g. "openai/gpt-4o"
    labId: text("lab_id").notNull(),
    labName: text("lab_name"),
    name: text("name").notNull(),
    description: text("description"),
    family: text("family"),

    // 能力标志
    attachment: integer("attachment", { mode: "boolean" }),
    reasoning: integer("reasoning", { mode: "boolean" }),
    toolCall: integer("tool_call", { mode: "boolean" }),
    structuredOutput: integer("structured_output", { mode: "boolean" }),
    temperature: integer("temperature", { mode: "boolean" }),

    // 模态（JSON 数组）
    modalitiesIn: text("modalities_in"),
    modalitiesOut: text("modalities_out"),

    // 默认限制
    contextLimit: integer("context_limit"),
    inputLimit: integer("input_limit"),
    outputLimit: integer("output_limit"),

    // 推理选项（JSON）
    reasoningOptions: text("reasoning_options"),

    // 模型元数据
    openWeights: integer("open_weights", { mode: "boolean" }),
    license: text("license"),
    releaseDate: text("release_date"),
    lastUpdated: text("last_updated"),
    knowledgeDate: text("knowledge_date"),

    // 来源
    sourceUrl: text("source_url"),
    sourceVersion: text("source_version"),
    rawPayload: text("raw_payload").notNull(),

    fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    labIdx: index("idx_catalog_lab").on(t.labId),
    familyIdx: index("idx_catalog_family").on(t.family),
    updatedIdx: index("idx_catalog_updated").on(t.updatedAt),
  }),
);

export type CatalogRow = typeof modelCatalog.$inferSelect;

/**
 * 目录别名表 —— 第四层别名匹配
 *
 * 字段定义：DESIGN.md 第 7 章 "model_catalog_alias"
 */
export const modelCatalogAlias = sqliteTable(
  "model_catalog_alias",
  {
    id: text("id").primaryKey(),
    catalogId: text("catalog_id")
      .notNull()
      .references(() => modelCatalog.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    normalized: text("normalized").notNull(),
    aliasType: text("alias_type", {
      enum: ["exact", "provider_id", "slug", "legacy", "manual"],
    }).notNull(),
    priority: integer("priority").notNull().default(50),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    catalogIdx: index("idx_alias_catalog").on(t.catalogId),
    normalizedIdx: index("idx_alias_normalized").on(t.normalized),
  }),
);

/**
 * 目录同步运行记录表
 *
 * 字段定义：DESIGN.md 第 7 章 "catalog_sync_runs"
 */
export const catalogSyncRuns = sqliteTable(
  "catalog_sync_runs",
  {
    id: text("id").primaryKey(),
    sourceUrl: text("source_url").notNull(),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
    status: text("status", { enum: ["running", "success", "failed", "partial"] })
      .notNull(),
    recordCount: integer("record_count").default(0),
    changedCount: integer("changed_count").default(0),
    schemaVersion: text("schema_version"),
    errorMessage: text("error_message"),
    triggeredBy: text("triggered_by", { enum: ["auto", "manual"] }).notNull(),
  },
  (t) => ({
    statusIdx: index("idx_sync_runs_status").on(t.status),
    startedIdx: index("idx_sync_runs_started").on(t.startedAt),
  }),
);

export type CatalogSyncRun = typeof catalogSyncRuns.$inferSelect;
export type NewCatalogSyncRun = typeof catalogSyncRuns.$inferInsert;