CREATE TABLE `model_schema_alias` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint_id` text NOT NULL,
	`alias` text NOT NULL,
	`normalized` text NOT NULL,
	`alias_type` text NOT NULL,
	`priority` integer DEFAULT 50 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`endpoint_id`) REFERENCES `model_schema_catalog`(`endpoint_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_schema_alias_endpoint` ON `model_schema_alias` (`endpoint_id`);--> statement-breakpoint
CREATE INDEX `idx_schema_alias_normalized` ON `model_schema_alias` (`normalized`);--> statement-breakpoint
CREATE INDEX `idx_schema_alias_type` ON `model_schema_alias` (`alias_type`);--> statement-breakpoint
CREATE TABLE `model_schema_catalog` (
	`endpoint_id` text PRIMARY KEY NOT NULL,
	`fal_model_id` text,
	`title` text NOT NULL,
	`modality` text NOT NULL,
	`fal_category` text,
	`fal_source` text,
	`description` text,
	`pricing` text,
	`input_schema` text,
	`output_schema` text,
	`parameters` text,
	`api_docs` text,
	`openapi_url` text,
	`status` text DEFAULT 'ok' NOT NULL,
	`source` text DEFAULT 'fal-ai' NOT NULL,
	`fetched_at` integer NOT NULL,
	`generated_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_schema_modality` ON `model_schema_catalog` (`modality`);--> statement-breakpoint
CREATE INDEX `idx_schema_fal_category` ON `model_schema_catalog` (`fal_category`);--> statement-breakpoint
CREATE INDEX `idx_schema_status` ON `model_schema_catalog` (`status`);--> statement-breakpoint
CREATE TABLE `schema_catalog_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_file` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`record_count` integer DEFAULT 0,
	`changed_count` integer DEFAULT 0,
	`alias_count` integer DEFAULT 0,
	`error_message` text,
	`triggered_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_schema_sync_runs_status` ON `schema_catalog_sync_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_schema_sync_runs_started` ON `schema_catalog_sync_runs` (`started_at`);--> statement-breakpoint
ALTER TABLE `models` ADD `schema_endpoint_id` text;--> statement-breakpoint
ALTER TABLE `models` ADD `schema_match_source` text;--> statement-breakpoint
ALTER TABLE `models` ADD `schema_synced_at` integer;--> statement-breakpoint
ALTER TABLE `models` ADD `fal_parameters_snapshot` text;--> statement-breakpoint
ALTER TABLE `models` ADD `fal_input_schema_snapshot` text;--> statement-breakpoint
ALTER TABLE `models` ADD `fal_pricing` text;--> statement-breakpoint
ALTER TABLE `models` ADD `fal_description` text;--> statement-breakpoint
ALTER TABLE `models` ADD `fal_source` text;--> statement-breakpoint
ALTER TABLE `models` ADD `video_duration_enum` text;--> statement-breakpoint
ALTER TABLE `models` ADD `video_aspect_ratios` text;--> statement-breakpoint
ALTER TABLE `models` ADD `video_resolutions` text;--> statement-breakpoint
ALTER TABLE `models` ADD `video_required_params` text;--> statement-breakpoint
ALTER TABLE `models` ADD `video_optional_params` text;--> statement-breakpoint
ALTER TABLE `models` ADD `generate_audio_supported` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `models` ADD `max_reference_images` integer;--> statement-breakpoint
ALTER TABLE `models` ADD `max_reference_videos` integer;--> statement-breakpoint
ALTER TABLE `models` ADD `max_reference_audios` integer;--> statement-breakpoint
ALTER TABLE `models` ADD `supports_function_calling` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `models` ADD `supports_vision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_models_schema` ON `models` (`schema_endpoint_id`);