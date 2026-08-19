ALTER TABLE `models` ADD `schema_match_status` text;--> statement-breakpoint
ALTER TABLE `models` ADD `schema_match_confidence` text;--> statement-breakpoint
ALTER TABLE `models` ADD `schema_match_reason` text;--> statement-breakpoint
ALTER TABLE `model_schema_alias` ADD `source` text DEFAULT 'fal-ai' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_schema_alias_source` ON `model_schema_alias` (`source`);--> statement-breakpoint
UPDATE `models`
SET
  `schema_match_status` = CASE
    WHEN `schema_endpoint_id` IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM `audit_log` AS `audit`
        WHERE `audit`.`action` = 'wizard.apply-schema'
          AND `audit`.`resource_type` = 'model'
          AND `audit`.`resource_id` = `models`.`id`
          AND json_valid(`audit`.`payload`)
          AND json_extract(`audit`.`payload`, '$.endpointId') = `models`.`schema_endpoint_id`
      ) THEN 'confirmed'
    WHEN `schema_endpoint_id` IS NOT NULL THEN 'candidate'
    ELSE 'unmatched'
  END,
  `schema_match_confidence` = CASE
    WHEN `schema_endpoint_id` IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM `audit_log` AS `audit`
        WHERE `audit`.`action` = 'wizard.apply-schema'
          AND `audit`.`resource_type` = 'model'
          AND `audit`.`resource_id` = `models`.`id`
          AND json_valid(`audit`.`payload`)
          AND json_extract(`audit`.`payload`, '$.endpointId') = `models`.`schema_endpoint_id`
      ) THEN 'high'
    WHEN `schema_endpoint_id` IS NOT NULL THEN 'low'
    ELSE NULL
  END,
  `schema_match_reason` = CASE
    WHEN `schema_endpoint_id` IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM `audit_log` AS `audit`
        WHERE `audit`.`action` = 'wizard.apply-schema'
          AND `audit`.`resource_type` = 'model'
          AND `audit`.`resource_id` = `models`.`id`
          AND json_valid(`audit`.`payload`)
          AND json_extract(`audit`.`payload`, '$.endpointId') = `models`.`schema_endpoint_id`
      ) THEN 'wizard_apply_schema'
    WHEN `schema_match_source` = 'manual' AND `schema_endpoint_id` IS NOT NULL THEN 'legacy_manual_unverified'
    WHEN `schema_endpoint_id` IS NOT NULL THEN 'legacy_auto_needs_review'
    ELSE 'no_schema_match'
  END;
--> statement-breakpoint
UPDATE `models`
SET
  `schema_synced_at` = NULL,
  `fal_parameters_snapshot` = NULL,
  `fal_input_schema_snapshot` = NULL,
  `fal_pricing` = NULL,
  `fal_description` = NULL,
  `fal_source` = NULL,
  `video_duration_enum` = NULL,
  `video_aspect_ratios` = NULL,
  `video_resolutions` = NULL,
  `video_required_params` = NULL,
  `video_optional_params` = NULL,
  `generate_audio_supported` = 0,
  `max_reference_images` = NULL,
  `max_reference_videos` = NULL,
  `max_reference_audios` = NULL
WHERE `schema_match_status` IS NULL OR `schema_match_status` != 'confirmed';
