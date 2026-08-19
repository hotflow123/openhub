import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { sites } from "./sites";

/**
 * 站点模型实例表
 *
 * 字段定义：DESIGN.md 第 7 章 "models"
 * 同一个供应商模型在不同站点是独立记录。
 */
export const models = sqliteTable(
  "models",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),

    // 命名
    rawName: text("raw_name").notNull(),
    displayName: text("display_name"),

    // 供应商溯源
    vendor: text("vendor"),
    family: text("family"),
    modelVersion: text("model_version"),

    // 适配器
    adapterId: text("adapter_id").notNull().default("openai-compatible"),

    // 模态与能力
    modality: text("modality", {
      enum: ["llm", "image", "audio", "video", "embedding"],
    }).notNull(),
    endpointCaps: text("endpoint_caps").notNull().default("[]"),
    paramCaps: text("param_caps").notNull().default("[]"),

    // 人工修正标志
    capsOverridden: integer("caps_overridden").notNull().default(0),

    // 外部目录关联
    catalogModelId: text("catalog_model_id"),
    catalogMatchSource: text("catalog_match_source"),
    catalogMatchConfidence: text("catalog_match_confidence"), // high | medium | low
    catalogSyncedAt: integer("catalog_synced_at", { mode: "timestamp" }),

    // fal.ai Schema 关联（参数结构）
    schemaEndpointId: text("schema_endpoint_id"),
    schemaMatchSource: text("schema_match_source"), // bytedance | kling | wan | hailuo | manual | null
    schemaSyncedAt: integer("schema_synced_at", { mode: "timestamp" }),

    // fal.ai Schema 完整数据快照（来自 model_schema_catalog）
    // JSON 字符串，存储 { parameters, inputSchema, outputSchema, falSource, pricing, description }
    falParametersSnapshot: text("fal_parameters_snapshot"),
    falInputSchemaSnapshot: text("fal_input_schema_snapshot"),
    falPricing: text("fal_pricing"),
    falDescription: text("fal_description"),
    falSource: text("fal_source"),

    // 解析后的视频参数（来自 fal parameters）
    videoDurationEnum: text("video_duration_enum"),  // JSON array, e.g. ["auto","4","5",...,"30"]
    videoAspectRatios: text("video_aspect_ratios"), // JSON array, e.g. ["16:9","9:16","1:1",...]
    videoResolutions: text("video_resolutions"),    // JSON array, e.g. ["480p","720p","1080p"]
    videoRequiredParams: text("video_required_params"), // JSON array
    videoOptionalParams: text("video_optional_params"), // JSON array
    generateAudioSupported: integer("generate_audio_supported").notNull().default(0),

    // LLM 限制
    contextWindow: integer("context_window"),
    maxOutputTokens: integer("max_output_tokens"),
    supportsReasoning: integer("supports_reasoning").notNull().default(0),
    supportsFunctionCalling: integer("supports_function_calling").notNull().default(0),
    supportsVision: integer("supports_vision").notNull().default(0),

    // 图片限制
    supportedSizes: text("supported_sizes"),

    // 视频限制
    maxDurationSec: integer("max_duration_sec"),
    maxReferenceImages: integer("max_reference_images"),
    maxReferenceVideos: integer("max_reference_videos"),
    maxReferenceAudios: integer("max_reference_audios"),

    // 调用方式
    supportsStream: integer("supports_stream").notNull().default(1),
    requiresAsync: integer("requires_async").notNull().default(0),

    // 运行时指标
    lastLatencyMs: integer("last_latency_ms"),
    avgLatencyMs: integer("avg_latency_ms"),

    // 状态
    status: text("status", {
      enum: ["active", "degraded", "offline", "unknown"],
    })
      .notNull()
      .default("active"),
    statusReason: text("status_reason"),

    // 同步
    syncedAt: integer("synced_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    siteIdx: index("idx_models_site").on(t.siteId),
    modalityIdx: index("idx_models_modality").on(t.modality),
    statusIdx: index("idx_models_status").on(t.status),
    vendorFamilyIdx: index("idx_models_vendor_family").on(t.vendor, t.family),
    catalogIdx: index("idx_models_catalog").on(t.catalogModelId),
    schemaIdx: index("idx_models_schema").on(t.schemaEndpointId),
    // UNIQUE(site_id, raw_name) - drizzle uniqueIndex
    siteRawNameIdx: index("idx_models_site_raw_name").on(t.siteId, t.rawName),
  }),
);

export type ModelRow = typeof models.$inferSelect;
export type NewModelRow = typeof models.$inferInsert;

/** 类型守卫：合法的 match source */
export const CATALOG_MATCH_SOURCES = [
  "exact",
  "normalized",
  "alias",
  "keyword",
  "admin",
  "probe",
  "none",
] as const;
export type CatalogMatchSource = (typeof CATALOG_MATCH_SOURCES)[number];

export function isCatalogMatchSource(s: unknown): s is CatalogMatchSource {
  return (
    s === "exact" ||
    s === "normalized" ||
    s === "alias" ||
    s === "keyword" ||
    s === "admin" ||
    s === "probe" ||
    s === "none"
  );
}

export const CATALOG_MATCH_CONFIDENCES = ["high", "medium", "low"] as const;
export type CatalogMatchConfidence = (typeof CATALOG_MATCH_CONFIDENCES)[number];
