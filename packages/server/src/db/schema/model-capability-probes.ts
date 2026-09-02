import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { models } from "./models";

export const modelCapabilityProbes = sqliteTable(
  "model_capability_probes",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    capability: text("capability").notNull(),
    mode: text("mode", { enum: ["safe", "full"] }).notNull(),
    status: text("status", {
      enum: [
        "unknown",
        "available",
        "temporary_failure",
        "forbidden",
        "unsupported",
        "request_invalid",
        "contract_mismatch",
      ],
    }).notNull(),
    httpStatus: integer("http_status"),
    upstreamCode: text("upstream_code"),
    message: text("message"),
    requestId: text("request_id"),
    retryAfter: text("retry_after"),
    latencyMs: integer("latency_ms"),
    adapterId: text("adapter_id"),
    adapterVersion: text("adapter_version"),
    configRevision: integer("config_revision"),
    checkedAt: integer("checked_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    modelCapabilityIdx: index("idx_model_probes_model_capability").on(t.modelId, t.capability),
    checkedIdx: index("idx_model_probes_checked").on(t.checkedAt),
  }),
);

export type ModelCapabilityProbe = typeof modelCapabilityProbes.$inferSelect;
export type NewModelCapabilityProbe = typeof modelCapabilityProbes.$inferInsert;
