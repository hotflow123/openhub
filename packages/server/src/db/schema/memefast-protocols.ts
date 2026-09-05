import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { models } from "./models";
import { modelSchemaCatalog } from "./schema-catalog";

export const protocolCatalog = sqliteTable(
  "protocol_catalog",
  {
    recordId: text("record_id").primaryKey(),
    protocolId: text("protocol_id").notNull(),
    version: text("version").notNull(),
    name: text("name").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceDocs: text("source_docs").notNull().default("[]"),
    sourceVersion: text("source_version"),
    modality: text("modality", {
      enum: ["llm", "image", "audio", "video", "embedding", "unknown"],
    }).notNull(),
    operations: text("operations").notNull().default("[]"),
    requestContract: text("request_contract").notNull().default("{}"),
    responseContract: text("response_contract").notNull().default("{}"),
    statusMapping: text("status_mapping").notNull().default("{}"),
    parameterMapping: text("parameter_mapping").notNull().default("{}"),
    evidenceStatus: text("evidence_status", {
      enum: ["documented", "imported", "fixture_verified", "runtime_verified", "enabled"],
    }).notNull().default("imported"),
    status: text("status", {
      enum: ["imported", "active", "changed", "deprecated"],
    }).notNull().default("imported"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
    contentHash: text("content_hash").notNull(),
    previousHash: text("previous_hash"),
    diffStatus: text("diff_status", {
      enum: ["added", "changed", "unchanged"],
    }).notNull(),
    rawDocument: text("raw_document").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    identityIdx: index("idx_protocol_catalog_identity").on(t.protocolId, t.version),
    sourceIdx: index("idx_protocol_catalog_source").on(t.sourceUrl),
    hashIdx: index("idx_protocol_catalog_hash").on(t.contentHash),
    statusIdx: index("idx_protocol_catalog_status").on(t.status, t.enabled),
  }),
);

export const modelProtocolBindings = sqliteTable(
  "model_protocol_bindings",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    protocolRecordId: text("protocol_record_id")
      .notNull()
      .references(() => protocolCatalog.recordId, { onDelete: "restrict" }),
    protocolId: text("protocol_id").notNull(),
    protocolVersion: text("protocol_version").notNull(),
    parameterTemplateId: text("parameter_template_id")
      .references(() => modelSchemaCatalog.endpointId, { onDelete: "set null" }),
    fieldMapping: text("field_mapping").notNull().default("{}"),
    capabilityOverrides: text("capability_overrides").notNull().default("{}"),
    evidenceStatus: text("evidence_status", {
      enum: ["documented", "imported", "fixture_verified", "runtime_verified", "enabled"],
    }).notNull().default("imported"),
    bindingReason: text("binding_reason"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    modelIdx: index("idx_model_protocol_bindings_model").on(t.modelId),
    protocolIdx: index("idx_model_protocol_bindings_protocol").on(t.protocolId, t.protocolVersion),
    recordIdx: index("idx_model_protocol_bindings_record").on(t.protocolRecordId),
  }),
);

export const protocolSyncRuns = sqliteTable(
  "protocol_sync_runs",
  {
    id: text("id").primaryKey(),
    sourceUrl: text("source_url").notNull(),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
    fetchedAt: integer("fetched_at"),
    contentHash: text("content_hash"),
    sourceVersion: text("source_version"),
    status: text("status", { enum: ["running", "success", "failed", "partial"] }).notNull(),
    addedCount: integer("added_count").notNull().default(0),
    changedCount: integer("changed_count").notNull().default(0),
    deprecatedCount: integer("deprecated_count").notNull().default(0),
    unparsedCount: integer("unparsed_count").notNull().default(0),
    diff: text("diff").notNull().default("{}"),
    errorMessage: text("error_message"),
    triggeredBy: text("triggered_by", { enum: ["auto", "manual"] }).notNull(),
  },
  (t) => ({
    statusIdx: index("idx_protocol_sync_runs_status").on(t.status),
    startedIdx: index("idx_protocol_sync_runs_started").on(t.startedAt),
  }),
);

export type ProtocolCatalogRow = typeof protocolCatalog.$inferSelect;
export type ModelProtocolBindingRow = typeof modelProtocolBindings.$inferSelect;
export type ProtocolSyncRunRow = typeof protocolSyncRuns.$inferSelect;
