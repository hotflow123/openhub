/**
 * OpenHub 自研：catalog item -> DB row 字段映射
 *
 * 与上游 generate.ts 的 inheritableModelMetadata 不同：
 * 本项目把完整上游 JSON 存入 raw_payload，需要展示的字段单独提取。
 *
 * 字段定义：DESIGN.md 第 7 章 "model_catalog"
 */

import type { CatalogItem } from "../upstream/schema.js";

export function catalogToFields(item: CatalogItem): {
  labId: string;
  labName: string | null;
  name: string;
  description: string | null;
  family: string | null;
  attachment: boolean | null;
  reasoning: boolean | null;
  toolCall: boolean | null;
  structuredOutput: boolean | null;
  temperature: boolean | null;
  modalitiesIn: string | null;
  modalitiesOut: string | null;
  contextLimit: number | null;
  inputLimit: number | null;
  outputLimit: number | null;
  reasoningOptions: string | null;
  openWeights: boolean | null;
  license: string | null;
  releaseDate: string | null;
  lastUpdated: string | null;
  knowledgeDate: string | null;
  sourceUrl: string | null;
  sourceVersion: string | null;
  fetchedAt: Date;
} {
  // id 格式 "lab/model" → 提取 lab 段
  const slashIdx = item.id.indexOf("/");
  const labId = slashIdx > 0 ? item.id.slice(0, slashIdx) : "unknown";

  // 提取 license/knowledge_date（如果上游有）
  const rawObj = item as unknown as Record<string, unknown>;
  const license = typeof rawObj.license === "string" ? rawObj.license : null;
  const knowledgeDate =
    typeof rawObj.knowledge_date === "string" ? rawObj.knowledge_date : null;

  return {
    labId,
    labName: null, // 上游 lab 名需查 separate provider 表；先置 null
    name: item.name,
    description: item.description ?? null,
    family: item.family ?? null,
    attachment: item.attachment ?? null,
    reasoning: item.reasoning ?? null,
    toolCall: item.tool_call ?? null,
    structuredOutput: item.structured_output ?? null,
    temperature: item.temperature ?? null,
    modalitiesIn: item.modalities?.input ? JSON.stringify(item.modalities.input) : null,
    modalitiesOut: item.modalities?.output ? JSON.stringify(item.modalities.output) : null,
    contextLimit: item.limit?.context ?? null,
    inputLimit: item.limit?.input ?? null,
    outputLimit: item.limit?.output ?? null,
    reasoningOptions: item.reasoning_options
      ? JSON.stringify(item.reasoning_options)
      : null,
    openWeights: item.open_weights ?? null,
    license,
    releaseDate: item.release_date ?? null,
    lastUpdated: item.last_updated ?? null,
    knowledgeDate,
    sourceUrl: "https://models.dev/models.json",
    sourceVersion: null, // 留空：可在 sync 完成后回填 etag/hash
    fetchedAt: new Date(),
  };
}