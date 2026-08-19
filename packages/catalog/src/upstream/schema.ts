/**
 * models.dev 上游 Zod schema 字段定义
 *
 * Adapted from anomalyco/models.dev (MIT License).
 * https://github.com/anomalyco/models.dev/blob/dev/packages/core/src/schema.ts
 */

import { z } from "zod";

const Modality = z.enum(["text", "audio", "image", "video", "pdf"]);

export const ModalitiesSchema = z.object({
  input: z.array(Modality),
  output: z.array(Modality),
});

export const LimitSchema = z.object({
  context: z.number().int().min(0).optional(),
  input: z.number().int().min(0).optional(),
  output: z.number().int().min(0).optional(),
});

export const ReasoningOptionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("toggle") }),
  z.object({
    type: z.literal("effort"),
    values: z.array(
      z
        .enum(["none", "minimal", "low", "medium", "high", "xhigh", "max", "default"])
        .or(z.null()),
    ),
  }),
  z.object({
    type: z.literal("budget_tokens"),
    min: z.number().int().min(0).optional(),
    max: z.number().int().min(0).optional(),
  }),
]);

export const DateStringSchema = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/);

export const ModelLinkSchema = z.object({
  name: z.string().optional(),
  url: z.string().url(),
  suggested: z.boolean().optional(),
});

export const ModelWeightsSchema = z.object({
  label: z.string().optional(),
  url: z.string().url(),
  format: z.string().optional(),
  quantization: z.string().optional(),
});

export const BenchmarkResultSchema = z.object({
  benchmark: z.string(),
  score: z.union([z.number(), z.string()]),
  rank: z.number().optional(),
  url: z.string().url().optional(),
});

/** 单个模型目录条目 —— passthrough 允许未知字段 */
export const CatalogItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    family: z.string().optional(),
    attachment: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    tool_call: z.boolean().optional(),
    structured_output: z.boolean().optional(),
    temperature: z.boolean().optional(),
    knowledge: z.string().optional(),
    release_date: DateStringSchema.optional(),
    last_updated: DateStringSchema.optional(),
    open_weights: z.boolean().optional(),
    limit: LimitSchema.optional(),
    modalities: ModalitiesSchema.optional(),
    reasoning_options: z.array(ReasoningOptionSchema).optional(),
  })
  .passthrough();

export type CatalogItem = z.infer<typeof CatalogItemSchema>;

/** 目录响应 */
export const CatalogResponseSchema = z.object({
  data: z.array(CatalogItemSchema),
});