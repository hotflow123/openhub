// Idempotent live-database migration for Fal Schema mapping evidence.
// Existing OpenHub databases were commonly created with db:push, so replaying
// the complete Drizzle journal is unsafe. This script makes only additive,
// repeatable changes and classifies legacy links conservatively.
const Database = require("better-sqlite3");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const packageRoot = resolve(__dirname, "..");

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}

loadDotEnv(resolve(packageRoot, ".env"));
const dbPath = resolve(packageRoot, process.env.OPENHUB_DB_URL ?? "data/openhub.db");
if (!existsSync(dbPath)) {
  throw new Error(`Database file does not exist: ${dbPath}`);
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

function hasTable(name) {
  return Boolean(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name),
  );
}

function hasColumn(table, column) {
  return db
    .prepare(`SELECT name FROM pragma_table_info('${table}') WHERE name = ?`)
    .get(column) != null;
}

const EVIDENCE_UPDATE = `
UPDATE models
SET
  schema_match_status = CASE
    WHEN schema_endpoint_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM audit_log AS audit
        WHERE audit.action = 'wizard.apply-schema'
          AND audit.resource_type = 'model'
          AND audit.resource_id = models.id
          AND json_valid(audit.payload)
          AND json_extract(audit.payload, '$.endpointId') = models.schema_endpoint_id
      ) THEN 'confirmed'
    WHEN schema_endpoint_id IS NOT NULL THEN 'candidate'
    ELSE 'unmatched'
  END,
  schema_match_confidence = CASE
    WHEN schema_endpoint_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM audit_log AS audit
        WHERE audit.action = 'wizard.apply-schema'
          AND audit.resource_type = 'model'
          AND audit.resource_id = models.id
          AND json_valid(audit.payload)
          AND json_extract(audit.payload, '$.endpointId') = models.schema_endpoint_id
      ) THEN 'high'
    WHEN schema_endpoint_id IS NOT NULL THEN 'low'
    ELSE NULL
  END,
  schema_match_reason = CASE
    WHEN schema_endpoint_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM audit_log AS audit
        WHERE audit.action = 'wizard.apply-schema'
          AND audit.resource_type = 'model'
          AND audit.resource_id = models.id
          AND json_valid(audit.payload)
          AND json_extract(audit.payload, '$.endpointId') = models.schema_endpoint_id
      ) THEN 'wizard_apply_schema'
    WHEN schema_match_source = 'manual' AND schema_endpoint_id IS NOT NULL THEN 'legacy_manual_unverified'
    WHEN schema_endpoint_id IS NOT NULL THEN 'legacy_auto_needs_review'
    ELSE 'no_schema_match'
  END;
`;

// A candidate endpoint is useful only as a review hint. It must not retain a
// previous endpoint's snapshot or reference limits, otherwise the UI and
// request validator would present unsupported capabilities as facts.
const CLEAR_UNCONFIRMED_SCHEMA_CAPABILITIES = `
UPDATE models
SET
  schema_synced_at = NULL,
  fal_parameters_snapshot = NULL,
  fal_input_schema_snapshot = NULL,
  fal_pricing = NULL,
  fal_description = NULL,
  fal_source = NULL,
  video_duration_enum = NULL,
  video_aspect_ratios = NULL,
  video_resolutions = NULL,
  video_required_params = NULL,
  video_optional_params = NULL,
  generate_audio_supported = 0,
  max_reference_images = NULL,
  max_reference_videos = NULL,
  max_reference_audios = NULL
WHERE schema_match_status IS NULL OR schema_match_status != 'confirmed';
`;

try {
  for (const table of ["models", "model_schema_alias", "audit_log"]) {
    if (!hasTable(table)) {
      throw new Error(`Required table ${table} does not exist; refusing migration`);
    }
  }

  const before = {
    status: hasColumn("models", "schema_match_status"),
    confidence: hasColumn("models", "schema_match_confidence"),
    reason: hasColumn("models", "schema_match_reason"),
    aliasSource: hasColumn("model_schema_alias", "source"),
  };

  db.transaction(() => {
    if (!before.status) db.exec("ALTER TABLE models ADD COLUMN schema_match_status text");
    if (!before.confidence) db.exec("ALTER TABLE models ADD COLUMN schema_match_confidence text");
    if (!before.reason) db.exec("ALTER TABLE models ADD COLUMN schema_match_reason text");
    if (!before.aliasSource) {
      db.exec("ALTER TABLE model_schema_alias ADD COLUMN source text NOT NULL DEFAULT 'fal-ai'");
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_schema_alias_source ON model_schema_alias(source)");
    db.exec(EVIDENCE_UPDATE);
    db.exec(CLEAR_UNCONFIRMED_SCHEMA_CAPABILITIES);
  })();

  const statuses = db
    .prepare("SELECT schema_match_status AS status, COUNT(*) AS count FROM models GROUP BY schema_match_status")
    .all();
  const sources = db
    .prepare("SELECT source, COUNT(*) AS count FROM model_schema_alias GROUP BY source")
    .all();
  console.log(JSON.stringify({
    database: dbPath,
    changed: Object.values(before).some((value) => !value),
    columns: {
      schemaMatchStatus: hasColumn("models", "schema_match_status"),
      schemaMatchConfidence: hasColumn("models", "schema_match_confidence"),
      schemaMatchReason: hasColumn("models", "schema_match_reason"),
      aliasSource: hasColumn("model_schema_alias", "source"),
    },
    statuses,
    aliasSources: sources,
  }, null, 2));
} finally {
  db.close();
}
