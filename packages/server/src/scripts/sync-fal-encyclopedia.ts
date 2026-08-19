/**
 * fal.ai 百科同步脚本
 *
 * 从本地 fal_model_encyclopedia.json 读取数据，写入 model_schema_catalog 表，
 * 并自动生成通用别名映射（只使用 fal.ai 的 endpoint_id 生成别名）。
 *
 * 用法：
 *   pnpm --filter @openhub/server sync:fal
 *   FAL_ENCYCLOPEDIA_FILE=./model/data/fal_model_encyclopedia.json pnpm --filter @openhub/server sync:fal
 */

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { db } from "../db/index.js";
import {
  modelSchemaCatalog,
  modelSchemaAlias,
  schemaCatalogSyncRuns,
  type SchemaCatalogRow,
  type SchemaAliasRow,
} from "../db/schema/index.js";

interface EncyclopediaMeta {
  generated_at: string;
  source: string;
  total_models: number;
  with_schema: number;
  without_schema: number;
}

interface EncyclopediaEntry {
  title: string;
  category: string;
  description?: string;
  pricing?: string;
  tags?: string[];
  api_docs?: string;
  endpoint_id?: string;
  source?: string;
  openapi_url?: string;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  parameters?: ParameterEntry[];
  status?: string;
  fetched_at?: string;
}

interface ParameterEntry {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

interface EncyclopediaJson {
  meta: EncyclopediaMeta;
  models: Record<string, EncyclopediaEntry>;
}

// fal category -> OpenHub modality
function falCategoryToModality(
  category: string,
): SchemaCatalogRow["modality"] {
  if (
    category === "text-to-video" ||
    category === "image-to-video" ||
    category === "video-to-video"
  ) {
    return "video";
  }
  if (category === "text-to-image" || category === "image-to-image") {
    return "image";
  }
  if (
    category === "text-to-speech" ||
    category === "speech-to-speech" ||
    category === "audio-to-audio" ||
    category === "audio-to-text" ||
    category === "speech-to-text"
  ) {
    return "audio";
  }
  if (category === "llm" || category === "text-to-text") {
    return "llm";
  }
  return "unknown";
}

// 生成稳定的别名 ID（使用 nanoid，避免哈希碰撞）
function makeAliasId(endpointId: string, alias: string): string {
  return `${endpointId.slice(0, 16)}__${alias.slice(0, 24)}__${nanoid(8)}`;
}

// 归一化别名
function normalizeAlias(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[_\-\/]/g, " ")
    .replace(/\s+/g, " ");
}

// 构建通用别名
function buildGenericAliases(endpointId: string): Array<{
  alias: string;
  aliasType: SchemaAliasRow["aliasType"];
}> {
  const result: Array<{ alias: string; aliasType: SchemaAliasRow["aliasType"] }> = [];

  // 通用：去掉 fal-ai/ 前缀
  if (endpointId.toLowerCase().startsWith("fal-ai/")) {
    const stripped = endpointId.slice("fal-ai/".length);
    result.push({ alias: stripped, aliasType: "auto" });
    result.push({ alias: stripped.replace(/\//g, "-"), aliasType: "auto" });
  }

  // 完整 endpoint_id 作为别名
  result.push({ alias: endpointId, aliasType: "auto" });

  return result;
}

export interface SyncResult {
  status: "success" | "failed";
  total: number;
  added: number;
  updated: number;
  aliases: number;
  errorMessage?: string;
  durationMs: number;
}

export async function syncFalEncyclopedia(options: {
  filePath?: string;
  triggeredBy?: "auto" | "manual";
} = {}): Promise<SyncResult> {
  const start = Date.now();
  const runId = nanoid();
  const sourceFile =
    options.filePath ??
    process.env.FAL_ENCYCLOPEDIA_FILE ??
    resolve(process.cwd(), "../../model/data/fal_model_encyclopedia.json");

    await db.insert(schemaCatalogSyncRuns).values({
      id: runId,
      sourceFile,
      startedAt: Math.floor(Date.now() / 1000) as any,
      status: "running",
      triggeredBy: options.triggeredBy ?? "manual",
    });

  try {
    const raw = readFileSync(sourceFile, "utf-8");
    const data: EncyclopediaJson = JSON.parse(raw);
    const fetchedAt = new Date(data.meta.generated_at);

    const seenEndpoints = new Set<string>();
    const schemaEntries: (typeof modelSchemaCatalog.$inferInsert)[] = [];
    const aliasEntries: (typeof modelSchemaAlias.$inferInsert)[] = [];

    for (const [endpointId, entry] of Object.entries(data.models)) {
      if (seenEndpoints.has(endpointId)) continue;
      seenEndpoints.add(endpointId);

      schemaEntries.push({
        endpointId,
        falModelId: endpointId,
        title: entry.title ?? endpointId,
        modality: falCategoryToModality(entry.category ?? "unknown"),
        falCategory: entry.category ?? null,
        falSource: (entry.source as "queue" | "realtime") ?? null,
        description: entry.description ?? null,
        pricing: entry.pricing ?? null,
        inputSchema: entry.input_schema ? JSON.stringify(entry.input_schema) : null,
        outputSchema: entry.output_schema ? JSON.stringify(entry.output_schema) : null,
        parameters: entry.parameters ? JSON.stringify(entry.parameters) : null,
        apiDocs: entry.api_docs ?? null,
        openapiUrl: entry.openapi_url ?? null,
        status: (entry.status as "ok" | "no_schema" | "error") ?? "ok",
        source: "fal-ai",
        fetchedAt: Math.floor(fetchedAt.getTime() / 1000),
        generatedAt: data.meta.generated_at,
      });

      // 构建通用别名
      const aliases = buildGenericAliases(endpointId);
      for (const { alias, aliasType } of aliases) {
        const normalized = normalizeAlias(alias);
        if (!normalized) continue;
        aliasEntries.push({
          id: makeAliasId(endpointId, normalized),
          endpointId,
          alias,
          normalized,
          aliasType,
          priority: 20,
        });
      }
    }

    let added = 0;
    let updated = 0;

    for (const entry of schemaEntries) {
      const [existing] = await db
        .select({ endpointId: modelSchemaCatalog.endpointId })
        .from(modelSchemaCatalog)
        .where(eq(modelSchemaCatalog.endpointId, entry.endpointId))
        .limit(1);

      if (!existing) {
        await db.insert(modelSchemaCatalog).values(entry as SchemaCatalogRow);
        added++;
      } else {
        await db
          .update(modelSchemaCatalog)
          .set(entry as any)
          .where(eq(modelSchemaCatalog.endpointId, entry.endpointId));
        updated++;
      }
    }

    // 重建别名表
    await db.delete(modelSchemaAlias);
    for (let i = 0; i < aliasEntries.length; i += 200) {
      await db
        .insert(modelSchemaAlias)
        .values(aliasEntries.slice(i, i + 200) as SchemaAliasRow[]);
    }

    const completedAt = new Date();
    await db
      .update(schemaCatalogSyncRuns)
      .set({
        status: "success",
        recordCount: schemaEntries.length,
        changedCount: added + updated,
        aliasCount: aliasEntries.length,
        finishedAt: Math.floor(completedAt.getTime() / 1000) as any,
      })
      .where(eq(schemaCatalogSyncRuns.id, runId));

    const result: SyncResult = {
      status: "success",
      total: schemaEntries.length,
      added,
      updated,
      aliases: aliasEntries.length,
      durationMs: completedAt.getTime() - start,
    };
    console.log(
      `[fal-sync] ok: total=${result.total} added=${result.added} updated=${result.updated} aliases=${result.aliases} (${result.durationMs}ms)`,
    );
    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db
      .update(schemaCatalogSyncRuns)
      .set({
        status: "failed",
        errorMessage,
        finishedAt: Math.floor(Date.now() / 1000) as any,
      })
      .where(eq(schemaCatalogSyncRuns.id, runId));
    console.error(`[fal-sync] failed: ${errorMessage}`);
    return {
      status: "failed",
      total: 0,
      added: 0,
      updated: 0,
      aliases: 0,
      errorMessage,
      durationMs: Date.now() - start,
    };
  }
}

// CLI 入口
void syncFalEncyclopedia().then((r) => {
  if (r.status !== "success") process.exit(1);
});
