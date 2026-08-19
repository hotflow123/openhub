-- OpenHub: 扩展 models 表以承载 fal.ai 百科的完整参数
-- 解决：discover 阶段将 fal schema 的 8+ 字段降维到 5 个粗字段的问题

-- 1) fal.ai Schema 关联字段（如已存在则跳过）
--> statement-breakpoint
ALTER TABLE `models` ADD COLUMN `schema_endpoint_id` text;--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE `models` ADD COLUMN `schema_match_source` text;--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE `models` ADD COLUMN `schema_synced_at` integer;--> statement-breakpoint

-- 2) fal.ai Schema 完整快照（保留原 schema 真实颗粒度）
--> statement-breakpoint
ALTER TABLE `models` ADD COLUMN `fal_parameters_snapshot` text;--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE `models` ADD COLUMN `fal_input_schema_snapshot` text;--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE `models` ADD COLUMN `fal_pricing` text;--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE `models` ADD COLUMN `fal_description` text;--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE `models` ADD COLUMN `fal_source` text;--> statement-breakpoint

-- 3) 解析后的视频参数（fal parameters 中的字段直接落库）
--> statement-breakpoint
ALTER TABLE `models` ADD COLUMN `video_duration_enum` text;--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE `models` ADD COLUMN `video_aspect_ratios` text;--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE `models` ADD COLUMN `video_resolutions` text;--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE `models` ADD COLUMN `video_required_params` text;--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE `models` ADD COLUMN `video_optional_params` text;--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE `models` ADD COLUMN `generate_audio_supported` integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- 4) LLM 细粒度能力（之前默认假数据，现与 fal 关联读取）
--> statement-breakpoint
ALTER TABLE `models` ADD COLUMN `supports_function_calling` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE `models` ADD COLUMN `supports_vision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- 5) schema_endpoint_id 索引（如不存在则跳过）
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_models_schema` ON `models` (`schema_endpoint_id`);