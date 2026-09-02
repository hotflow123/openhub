ALTER TABLE `variants` ADD `param_defaults` text;
--> statement-breakpoint
ALTER TABLE `sites` ADD `config_revision` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `model_capability_probes` ADD `config_revision` integer;
