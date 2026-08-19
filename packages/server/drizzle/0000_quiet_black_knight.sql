CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`api_key_enc` text NOT NULL,
	`api_key_iv` text NOT NULL,
	`adapter_id` text DEFAULT 'openai' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`last_check` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sites_status` ON `sites` (`status`);--> statement-breakpoint
CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`raw_name` text NOT NULL,
	`display_name` text,
	`vendor` text,
	`family` text,
	`model_version` text,
	`adapter_id` text DEFAULT 'openai-compatible' NOT NULL,
	`modality` text NOT NULL,
	`endpoint_caps` text DEFAULT '[]' NOT NULL,
	`param_caps` text DEFAULT '[]' NOT NULL,
	`caps_overridden` integer DEFAULT 0 NOT NULL,
	`catalog_model_id` text,
	`catalog_match_source` text,
	`catalog_match_confidence` text,
	`catalog_synced_at` integer,
	`context_window` integer,
	`max_output_tokens` integer,
	`supports_reasoning` integer DEFAULT 0 NOT NULL,
	`supported_sizes` text,
	`max_duration_sec` integer,
	`supports_stream` integer DEFAULT 1 NOT NULL,
	`requires_async` integer DEFAULT 0 NOT NULL,
	`last_latency_ms` integer,
	`avg_latency_ms` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`status_reason` text,
	`synced_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_models_site` ON `models` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_models_modality` ON `models` (`modality`);--> statement-breakpoint
CREATE INDEX `idx_models_status` ON `models` (`status`);--> statement-breakpoint
CREATE INDEX `idx_models_vendor_family` ON `models` (`vendor`,`family`);--> statement-breakpoint
CREATE INDEX `idx_models_catalog` ON `models` (`catalog_model_id`);--> statement-breakpoint
CREATE INDEX `idx_models_site_raw_name` ON `models` (`site_id`,`raw_name`);--> statement-breakpoint
CREATE TABLE `keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_suffix` text NOT NULL,
	`allowed_variant_ids` text,
	`status` text DEFAULT 'active' NOT NULL,
	`revoked_at` integer,
	`last_used` integer,
	`use_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keys_key_hash_unique` ON `keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_hash` ON `keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_status` ON `keys` (`status`);--> statement-breakpoint
CREATE TABLE `variants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`model_id` text NOT NULL,
	`description` text,
	`param_overrides` text,
	`param_blocked` text,
	`field_mapping` text,
	`adapter_config` text,
	`max_context` integer,
	`max_output` integer,
	`max_images` integer,
	`max_duration` integer,
	`max_audio_len` integer,
	`is_public` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variants_name_unique` ON `variants` (`name`);--> statement-breakpoint
CREATE INDEX `idx_variants_model` ON `variants` (`model_id`);--> statement-breakpoint
CREATE INDEX `idx_variants_name` ON `variants` (`name`);--> statement-breakpoint
CREATE TABLE `catalog_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_url` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`record_count` integer DEFAULT 0,
	`changed_count` integer DEFAULT 0,
	`schema_version` text,
	`error_message` text,
	`triggered_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sync_runs_status` ON `catalog_sync_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sync_runs_started` ON `catalog_sync_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `model_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`lab_id` text NOT NULL,
	`lab_name` text,
	`name` text NOT NULL,
	`description` text,
	`family` text,
	`attachment` integer,
	`reasoning` integer,
	`tool_call` integer,
	`structured_output` integer,
	`temperature` integer,
	`modalities_in` text,
	`modalities_out` text,
	`context_limit` integer,
	`input_limit` integer,
	`output_limit` integer,
	`reasoning_options` text,
	`open_weights` integer,
	`license` text,
	`release_date` text,
	`last_updated` text,
	`knowledge_date` text,
	`source_url` text,
	`source_version` text,
	`raw_payload` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_catalog_lab` ON `model_catalog` (`lab_id`);--> statement-breakpoint
CREATE INDEX `idx_catalog_family` ON `model_catalog` (`family`);--> statement-breakpoint
CREATE INDEX `idx_catalog_updated` ON `model_catalog` (`updated_at`);--> statement-breakpoint
CREATE TABLE `model_catalog_alias` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog_id` text NOT NULL,
	`alias` text NOT NULL,
	`normalized` text NOT NULL,
	`alias_type` text NOT NULL,
	`priority` integer DEFAULT 50 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`catalog_id`) REFERENCES `model_catalog`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_alias_catalog` ON `model_catalog_alias` (`catalog_id`);--> statement-breakpoint
CREATE INDEX `idx_alias_normalized` ON `model_catalog_alias` (`normalized`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`model_id` text NOT NULL,
	`created_by_key_id` text NOT NULL,
	`idempotency_key` text,
	`site_task_id` text,
	`type` text NOT NULL,
	`task_meta` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`result_expires_at` integer,
	`error` text,
	`callback_url` text,
	`callback_secret` text,
	`callback_attempts` integer DEFAULT 0 NOT NULL,
	`callback_next_at` integer,
	`callback_done` integer DEFAULT 0 NOT NULL,
	`max_polling_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`poll_count` integer DEFAULT 0 NOT NULL,
	`last_poll_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_key_id`) REFERENCES `keys`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_status` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_key` ON `tasks` (`created_by_key_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_site` ON `tasks` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_max_polling` ON `tasks` (`max_polling_at`);--> statement-breakpoint
CREATE INDEX `idx_tasks_callback` ON `tasks` (`callback_done`,`callback_next_at`);--> statement-breakpoint
CREATE INDEX `idx_tasks_idempotency` ON `tasks` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text,
	`resource_id` text,
	`payload` text,
	`ip` text,
	`user_agent` text,
	`status` text DEFAULT 'success' NOT NULL,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_actor` ON `audit_log` (`actor`);--> statement-breakpoint
CREATE INDEX `idx_audit_action` ON `audit_log` (`action`);--> statement-breakpoint
CREATE INDEX `idx_audit_resource` ON `audit_log` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_created` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`email` text,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_login_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE INDEX `idx_users_username` ON `users` (`username`);--> statement-breakpoint
CREATE INDEX `idx_users_status` ON `users` (`status`);--> statement-breakpoint
CREATE TABLE `variant_group_members` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`site_id` text NOT NULL,
	`priority` integer DEFAULT 50 NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `variant_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_vgm_group` ON `variant_group_members` (`group_id`);--> statement-breakpoint
CREATE INDEX `idx_vgm_variant` ON `variant_group_members` (`variant_id`);--> statement-breakpoint
CREATE TABLE `variant_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`strategy` text DEFAULT 'priority' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variant_groups_name_unique` ON `variant_groups` (`name`);