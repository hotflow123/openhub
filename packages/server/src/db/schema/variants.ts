import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { models } from "./models";

/**
 * 变体表
 *
 * 字段定义：DESIGN.md 第 7 章 "variants"
 * 一个变体绑定一个 model 实例。
 */
export const variants = sqliteTable(
  "variants",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    description: text("description"),

    // 参数配置（DESIGN 拆三字段而非 JSON）
    paramOverrides: text("param_overrides"),
    paramBlocked: text("param_blocked"),
    fieldMapping: text("field_mapping"),
    // 允许值限制（与 param_overrides 的强制覆盖语义分离）
    paramLimits: text("param_limits"),

    // 业务适配器配置（adapter 私有配置，仍走 JSON）
    adapterConfig: text("adapter_config"),

    // 能力限制
    maxContext: integer("max_context"),
    maxOutput: integer("max_output"),
    maxImages: integer("max_images"),
    maxReferenceImages: integer("max_reference_images"),
    maxReferenceVideos: integer("max_reference_videos"),
    maxReferenceAudios: integer("max_reference_audios"),
    maxDuration: integer("max_duration"),
    maxAudioLen: integer("max_audio_len"),

    // 可见性
    isPublic: integer("is_public").notNull().default(1),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    modelIdx: index("idx_variants_model").on(t.modelId),
    nameIdx: index("idx_variants_name").on(t.name),
  }),
);

export type Variant = typeof variants.$inferSelect;
export type NewVariant = typeof variants.$inferInsert;
