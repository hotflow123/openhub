ALTER TABLE models ADD COLUMN `capability_contract_snapshot` TEXT;
--> statement-breakpoint
ALTER TABLE models ADD COLUMN `capability_contract_source` TEXT;
--> statement-breakpoint
ALTER TABLE models ADD COLUMN `capability_contract_status` TEXT;
--> statement-breakpoint
ALTER TABLE models ADD COLUMN `capability_contract_reason` TEXT;
--> statement-breakpoint
ALTER TABLE models ADD COLUMN `capability_contract_synced_at` INTEGER;
--> statement-breakpoint
ALTER TABLE models ADD COLUMN `model_identity_status` TEXT;
--> statement-breakpoint
ALTER TABLE models ADD COLUMN `model_identity_source` TEXT;
--> statement-breakpoint
ALTER TABLE models ADD COLUMN `model_identity_reason` TEXT;
--> statement-breakpoint
ALTER TABLE models ADD COLUMN `adapter_version` TEXT;
--> statement-breakpoint
ALTER TABLE models ADD COLUMN `adapter_hash` TEXT;
--> statement-breakpoint
ALTER TABLE models ADD COLUMN `adapter_validation_status` TEXT;
--> statement-breakpoint
ALTER TABLE models ADD COLUMN `adapter_validation_reason` TEXT;
--> statement-breakpoint
ALTER TABLE variants ADD COLUMN `adapter_config_status` TEXT NOT NULL DEFAULT 'unvalidated';
--> statement-breakpoint
ALTER TABLE variants ADD COLUMN `adapter_config_reason` TEXT;
--> statement-breakpoint
ALTER TABLE variants ADD COLUMN `adapter_config_validated_at` INTEGER;
