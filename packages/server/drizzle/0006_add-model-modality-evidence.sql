ALTER TABLE models ADD COLUMN `modality_source` TEXT NOT NULL DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE models ADD COLUMN `modality_confidence` TEXT NOT NULL DEFAULT 'low';--> statement-breakpoint
ALTER TABLE models ADD COLUMN `modality_reason` TEXT;--> statement-breakpoint
UPDATE models
SET modality_source = CASE WHEN caps_overridden = 1 THEN 'manual' ELSE 'unknown' END,
    modality_confidence = CASE WHEN caps_overridden = 1 THEN 'high' ELSE 'low' END,
    modality_reason = CASE WHEN caps_overridden = 1 THEN 'legacy_manual_override' ELSE 'legacy_unverified' END;
