import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * fal.ai 模型参数百科表
 *
 * 存储 fal.ai 百科（fal_model_encyclopedia.json）的完整 API Schema 数据，
 * 为视频/图像/音频模型的参数标准化提供来源。
 *
 * 与 model_catalog 的关系：
 *   - model_catalog：模型身份（名称/厂商/家族/能力标志）
 *   - model_schema_catalog：模型调用（参数结构/default/enum/类型）
 *   - 两者通过 model_schema_alias 表（跨源别名）关联
 *
 * 数据来源：f:\code\测试\model\data\fal_model_encyclopedia.json
 *
 * fal.ai category -> OpenHub modality 映射：
 *   text-to-video, image-to-video, video-to-video -> video
 *   text-to-image, image-to-image                   -> image
 *   text-to-speech, speech-to-speech, audio-to-audio, audio-to-text -> audio
 *   llm, text-to-text                               -> llm
 *   (其他)                                          -> embedding
 */
export const modelSchemaCatalog = sqliteTable(
  "model_schema_catalog",
  {
    // 主键：fal.ai 验证后的 endpoint_id（如 "bytedance/seedance-2.5/text-to-video"）
    endpointId: text("endpoint_id").primaryKey(),

    // fal.ai 原始 model_id（可能与 endpoint_id 不同）
    falModelId: text("fal_model_id"),

    // 显示名称
    title: text("title").notNull(),

    // fal category -> OpenHub modality
    modality: text("modality", {
      enum: ["llm", "image", "video", "audio", "embedding", "unknown"],
    }).notNull(),

    // 分类来源
    falCategory: text("fal_category"),
    falSource: text("fal_source", { enum: ["queue", "realtime"] }),

    // 基础描述
    description: text("description"),
    pricing: text("pricing"),

    // 完整 JSON Schema（JSON 字符串）
    inputSchema: text("input_schema"),
    outputSchema: text("output_schema"),

    // 扁平化参数列表（JSON 数组，供表单/校验直接消费）
    parameters: text("parameters"),

    // API 文档
    apiDocs: text("api_docs"),
    openapiUrl: text("openapi_url"),

    // 状态
    status: text("status", { enum: ["ok", "no_schema", "error"] }).notNull().default("ok"),

    // 数据来源和时间
    source: text("source").notNull().default("fal-ai"),
    fetchedAt: integer("fetched_at").notNull(),
    generatedAt: text("generated_at"), // encyclopedia.json 的 meta.generated_at
  },
  (t) => ({
    modalityIdx: index("idx_schema_modality").on(t.modality),
    falCategoryIdx: index("idx_schema_fal_category").on(t.falCategory),
    statusIdx: index("idx_schema_status").on(t.status),
  }),
);

export type SchemaCatalogRow = typeof modelSchemaCatalog.$inferSelect;

/**
 * 跨源别名表 —— 将各 New API 站点的模型名映射到 fal.ai schema
 *
 * 例如：
 *   "doubao-seedance-2-0"    -> endpointId "bytedance/seedance-2.5/text-to-video"
 *   "openaa-seedance-1-0"    -> endpointId "bytedance/seedance-1.0/text-to-video"
 *   "wanx-video-pro"          -> endpointId "fal-ai/wan/v2.7/text-to-video"
 */
export const modelSchemaAlias = sqliteTable(
  "model_schema_alias",
  {
    id: text("id").primaryKey(),
    // 关联的 schema 条目（允许 null 表示待确认）
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => modelSchemaCatalog.endpointId, { onDelete: "cascade" }),
    // 别名（站点原始模型名，归一化后存储）
    alias: text("alias").notNull(),
    normalized: text("normalized").notNull(),
    // 来源
    aliasType: text("alias_type", {
      enum: [
        "bytedance",   // ByteDance/Doubao/Seedance 跨源映射（自动生成）
        "kling",       // 快手 Kling 系列（自动生成）
        "wan",         // 阿里 Wan 系列（自动生成）
        "hailuo",      // MiniMax/Hailuo 系列（自动生成）
        "manual",      // 管理员手动指定
        "auto",        // model_id 前缀自动提取
      ],
    }).notNull(),
    priority: integer("priority").notNull().default(50),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    endpointIdx: index("idx_schema_alias_endpoint").on(t.endpointId),
    normalizedIdx: index("idx_schema_alias_normalized").on(t.normalized),
    aliasTypeIdx: index("idx_schema_alias_type").on(t.aliasType),
  }),
);

export type SchemaAliasRow = typeof modelSchemaAlias.$inferSelect;

/**
 * fal.ai 同步运行记录表
 */
export const schemaCatalogSyncRuns = sqliteTable(
  "schema_catalog_sync_runs",
  {
    id: text("id").primaryKey(),
    sourceFile: text("source_file").notNull(),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
    status: text("status", { enum: ["running", "success", "failed", "partial"] })
      .notNull(),
    recordCount: integer("record_count").default(0),
    changedCount: integer("changed_count").default(0),
    aliasCount: integer("alias_count").default(0),
    errorMessage: text("error_message"),
    triggeredBy: text("triggered_by", { enum: ["auto", "manual"] }).notNull(),
  },
  (t) => ({
    statusIdx: index("idx_schema_sync_runs_status").on(t.status),
    startedIdx: index("idx_schema_sync_runs_started").on(t.startedAt),
  }),
);

export type SchemaCatalogSyncRun = typeof schemaCatalogSyncRuns.$inferSelect;
