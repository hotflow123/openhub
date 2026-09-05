CREATE TABLE `protocol_catalog` (
  `record_id` text PRIMARY KEY NOT NULL,
  `protocol_id` text NOT NULL,
  `version` text NOT NULL,
  `name` text NOT NULL,
  `source_url` text NOT NULL,
  `source_docs` text DEFAULT '[]' NOT NULL,
  `source_version` text,
  `modality` text NOT NULL,
  `operations` text DEFAULT '[]' NOT NULL,
  `request_contract` text DEFAULT '{}' NOT NULL,
  `response_contract` text DEFAULT '{}' NOT NULL,
  `status_mapping` text DEFAULT '{}' NOT NULL,
  `parameter_mapping` text DEFAULT '{}' NOT NULL,
  `evidence_status` text DEFAULT 'imported' NOT NULL,
  `status` text DEFAULT 'imported' NOT NULL,
  `enabled` integer DEFAULT 0 NOT NULL,
  `fetched_at` integer NOT NULL,
  `content_hash` text NOT NULL,
  `previous_hash` text,
  `diff_status` text NOT NULL,
  `raw_document` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_protocol_catalog_identity` ON `protocol_catalog` (`protocol_id`,`version`);
--> statement-breakpoint
CREATE INDEX `idx_protocol_catalog_source` ON `protocol_catalog` (`source_url`);
--> statement-breakpoint
CREATE INDEX `idx_protocol_catalog_hash` ON `protocol_catalog` (`content_hash`);
--> statement-breakpoint
CREATE INDEX `idx_protocol_catalog_status` ON `protocol_catalog` (`status`,`enabled`);
--> statement-breakpoint
CREATE TABLE `model_protocol_bindings` (
  `id` text PRIMARY KEY NOT NULL,
  `model_id` text NOT NULL REFERENCES `models`(`id`) ON DELETE cascade,
  `protocol_record_id` text NOT NULL REFERENCES `protocol_catalog`(`record_id`) ON DELETE restrict,
  `protocol_id` text NOT NULL,
  `protocol_version` text NOT NULL,
  `parameter_template_id` text REFERENCES `model_schema_catalog`(`endpoint_id`) ON DELETE set null,
  `field_mapping` text DEFAULT '{}' NOT NULL,
  `capability_overrides` text DEFAULT '{}' NOT NULL,
  `evidence_status` text DEFAULT 'imported' NOT NULL,
  `binding_reason` text,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_model_protocol_bindings_model` ON `model_protocol_bindings` (`model_id`);
--> statement-breakpoint
CREATE INDEX `idx_model_protocol_bindings_protocol` ON `model_protocol_bindings` (`protocol_id`,`protocol_version`);
--> statement-breakpoint
CREATE INDEX `idx_model_protocol_bindings_record` ON `model_protocol_bindings` (`protocol_record_id`);
--> statement-breakpoint
CREATE TABLE `protocol_sync_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `source_url` text NOT NULL,
  `started_at` integer NOT NULL,
  `finished_at` integer,
  `fetched_at` integer,
  `content_hash` text,
  `source_version` text,
  `status` text NOT NULL,
  `added_count` integer DEFAULT 0 NOT NULL,
  `changed_count` integer DEFAULT 0 NOT NULL,
  `deprecated_count` integer DEFAULT 0 NOT NULL,
  `unparsed_count` integer DEFAULT 0 NOT NULL,
  `diff` text DEFAULT '{}' NOT NULL,
  `error_message` text,
  `triggered_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_protocol_sync_runs_status` ON `protocol_sync_runs` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_protocol_sync_runs_started` ON `protocol_sync_runs` (`started_at`);
