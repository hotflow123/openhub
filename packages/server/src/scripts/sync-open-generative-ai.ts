import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import {
  modelSchemaAlias,
  modelSchemaCatalog,
  schemaCatalogSyncRuns,
} from "../db/schema/index.js";
import {
  normalizeOpenGenerativeAiModels,
  type ExternalModelRecord,
} from "../lib/open-generative-ai.js";

const SOURCE = "open-generative-ai";

function aliasId(endpointId: string, normalized: string): string {
  return createHash("sha256").update(`${endpointId}\0${normalized}`).digest("hex").slice(0, 32);
}

function normalizedAlias(value: string): string {
  return value.toLowerCase().trim().replace(/[_\-/:]+/g, " ").replace(/\s+/g, " ");
}

export async function syncOpenGenerativeAi(options: { sourceFile?: string } = {}) {
  const startedAt = Date.now();
  const runId = nanoid();
  const sourceFile = options.sourceFile ??
    process.env.OPEN_GENERATIVE_AI_MODELS_FILE ??
    resolve(process.cwd(), "../../../Open-Generative-AI/packages/studio/src/models.js");

  await db.insert(schemaCatalogSyncRuns).values({
    id: runId,
    sourceFile,
    startedAt: Math.floor(startedAt / 1000),
    status: "running",
    triggeredBy: "manual",
  });

  try {
    const module = await import(pathToFileURL(sourceFile).href);
    const records: Record<string, ExternalModelRecord[]> = {};
    for (const [key, value] of Object.entries(module)) {
      if (Array.isArray(value)) records[key] = value as ExternalModelRecord[];
    }

    const models = normalizeOpenGenerativeAiModels(records);
    const endpointIds = models.map((model) => model.endpointId);
    const existingIds = endpointIds.length
      ? new Set((await db.select({ id: modelSchemaCatalog.endpointId })
          .from(modelSchemaCatalog)
          .where(inArray(modelSchemaCatalog.endpointId, endpointIds)))
          .map((row) => row.id))
      : new Set<string>();

    for (const model of models) {
      await db.insert(modelSchemaCatalog).values({
        endpointId: model.endpointId,
        falModelId: model.sourceModelId,
        title: model.title,
        modality: model.modality,
        falCategory: [...new Set(model.categories)].join(","),
        description: model.description,
        inputSchema: JSON.stringify(model.inputSchema),
        parameters: JSON.stringify(model.parameters),
        status: "ok",
        source: SOURCE,
        fetchedAt: Math.floor(Date.now() / 1000),
        generatedAt: new Date().toISOString(),
      }).onConflictDoUpdate({
        target: modelSchemaCatalog.endpointId,
        set: {
          falModelId: sql`excluded.fal_model_id`,
          title: sql`excluded.title`,
          modality: sql`excluded.modality`,
          falCategory: sql`excluded.fal_category`,
          description: sql`excluded.description`,
          inputSchema: sql`excluded.input_schema`,
          parameters: sql`excluded.parameters`,
          status: sql`excluded.status`,
          source: sql`excluded.source`,
          fetchedAt: sql`excluded.fetched_at`,
          generatedAt: sql`excluded.generated_at`,
        },
      });
    }

    const aliases = models.flatMap((model) => [
      model.sourceModelId,
      model.endpointId,
    ].map((value) => ({
      id: aliasId(model.endpointId, normalizedAlias(value)),
      endpointId: model.endpointId,
      alias: value,
      normalized: normalizedAlias(value),
      aliasType: "auto" as const,
      priority: 20,
      source: SOURCE,
    })));

    for (let index = 0; index < aliases.length; index += 200) {
      await db.insert(modelSchemaAlias).values(aliases.slice(index, index + 200))
        .onConflictDoUpdate({
          target: modelSchemaAlias.id,
          set: {
            endpointId: sql`excluded.endpoint_id`,
            alias: sql`excluded.alias`,
            normalized: sql`excluded.normalized`,
            aliasType: sql`excluded.alias_type`,
            priority: sql`excluded.priority`,
            source: sql`excluded.source`,
          },
        });
    }

    const currentAliasIds = new Set(aliases.map((alias) => alias.id));
    const staleAliases = (await db.select({ id: modelSchemaAlias.id })
      .from(modelSchemaAlias)
      .where(eq(modelSchemaAlias.source, SOURCE)))
      .map((row) => row.id)
      .filter((id) => !currentAliasIds.has(id));

    for (let index = 0; index < staleAliases.length; index += 200) {
      await db.delete(modelSchemaAlias)
        .where(inArray(modelSchemaAlias.id, staleAliases.slice(index, index + 200)));
    }

    await db.update(schemaCatalogSyncRuns).set({
      status: "success",
      recordCount: models.length,
      changedCount: models.length - existingIds.size,
      aliasCount: aliases.length,
      finishedAt: Math.floor(Date.now() / 1000),
    }).where(eq(schemaCatalogSyncRuns.id, runId));

    return {
      status: "success" as const,
      total: models.length,
      added: models.length - existingIds.size,
      updated: existingIds.size,
      aliases: aliases.length,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await db.update(schemaCatalogSyncRuns).set({
      status: "failed",
      errorMessage,
      finishedAt: Math.floor(Date.now() / 1000),
    }).where(eq(schemaCatalogSyncRuns.id, runId));
    return {
      status: "failed" as const,
      total: 0, added: 0, updated: 0, aliases: 0,
      durationMs: Date.now() - startedAt,
      errorMessage,
    };
  }
}

void syncOpenGenerativeAi().then((result) => {
  console.log(`[oga-sync] ${result.status}: total=${result.total} added=${result.added} updated=${result.updated} aliases=${result.aliases} (${result.durationMs}ms)`);
  if (result.errorMessage) console.error(result.errorMessage);
  if (result.status !== "success") process.exit(1);
});

