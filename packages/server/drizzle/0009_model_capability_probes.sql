CREATE TABLE `model_capability_probes` (
	`id` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL REFERENCES `models`(`id`) ON UPDATE no action ON DELETE cascade,
	`capability` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`http_status` integer,
	`upstream_code` text,
	`message` text,
	`request_id` text,
	`retry_after` text,
	`latency_ms` integer,
	`adapter_id` text,
	`adapter_version` text,
	`checked_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_model_probes_model_capability` ON `model_capability_probes` (`model_id`,`capability`);
--> statement-breakpoint
CREATE INDEX `idx_model_probes_checked` ON `model_capability_probes` (`checked_at`);
