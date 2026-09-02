CREATE TABLE model_parameter_templates (
  id TEXT PRIMARY KEY NOT NULL,
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_model_id TEXT NOT NULL,
  source_collection TEXT NOT NULL,
  operation TEXT NOT NULL,
  modality TEXT NOT NULL,
  template_snapshot TEXT NOT NULL,
  field_mapping TEXT,
  match_status TEXT NOT NULL,
  match_confidence TEXT NOT NULL,
  match_reason TEXT,
  source_commit TEXT,
  source_file_sha256 TEXT,
  snapshot_sha256 TEXT,
  synced_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(model_id, source, source_model_id, operation)
);
--> statement-breakpoint
ALTER TABLE variants ADD COLUMN parameter_template_id TEXT REFERENCES model_parameter_templates(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX idx_model_parameter_templates_model ON model_parameter_templates(model_id);
--> statement-breakpoint
CREATE INDEX idx_model_parameter_templates_source ON model_parameter_templates(source);
--> statement-breakpoint
CREATE INDEX idx_model_parameter_templates_operation ON model_parameter_templates(operation);
