import { sqliteTable, text, integer, index, unique } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { models } from "./models";

export const modelParameterTemplates = sqliteTable(
  "model_parameter_templates",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id").notNull().references(() => models.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["fal_schema", "open_generative_ai"] }).notNull(),
    sourceModelId: text("source_model_id").notNull(),
    sourceCollection: text("source_collection").notNull(),
    operation: text("operation").notNull(),
    modality: text("modality", { enum: ["image", "video", "audio", "llm", "embedding"] }).notNull(),
    templateSnapshot: text("template_snapshot").notNull(),
    fieldMapping: text("field_mapping"),
    matchStatus: text("match_status", { enum: ["candidate", "confirmed", "applied", "incompatible", "conflict"] }).notNull(),
    matchConfidence: text("match_confidence", { enum: ["high", "medium", "low"] }).notNull(),
    matchReason: text("match_reason"),
    sourceCommit: text("source_commit"),
    sourceFileSha256: text("source_file_sha256"),
    snapshotSha256: text("snapshot_sha256"),
    syncedAt: integer("synced_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    modelIdx: index("idx_model_parameter_templates_model").on(t.modelId),
    sourceIdx: index("idx_model_parameter_templates_source").on(t.source),
    operationIdx: index("idx_model_parameter_templates_operation").on(t.operation),
    uniqueTemplate: unique("uq_model_parameter_templates_identity").on(t.modelId, t.source, t.sourceModelId, t.operation),
  }),
);

export type ModelParameterTemplate = typeof modelParameterTemplates.$inferSelect;
export type NewModelParameterTemplate = typeof modelParameterTemplates.$inferInsert;
