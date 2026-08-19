/**
 * 加载内置目录快照到数据库
 * 
 * 启动时自动导入（INSERT OR IGNORE），不覆盖在线同步的新数据
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../../db/index.js";
import { modelCatalog } from "../../db/schema/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

interface SnapshotModel {
  id: string;
  name: string;
  lab: string;
  lab_name: string;
  family?: string | null;
  modalities?: { input: string[]; output: string[] };
  limit?: { context?: number; input?: number; output?: number };
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
}

interface Snapshot {
  version: string;
  source: string;
  models: SnapshotModel[];
}

export async function loadSnapshot(): Promise<{ loaded: number; skipped: number }> {
  const snapshotPath = join(__dirname, "catalog-snapshot.json");
  
  let snapshot: Snapshot;
  try {
    const raw = readFileSync(snapshotPath, "utf-8");
    snapshot = JSON.parse(raw);
  } catch (err) {
    console.warn("[catalog] snapshot file not found or invalid, skipping import");
    return { loaded: 0, skipped: 0 };
  }

  let loaded = 0;
  let skipped = 0;

  for (const model of snapshot.models) {
    try {
      // INSERT OR IGNORE：如果 id 已存在（在线同步写入的），不覆盖
      await db
        .insert(modelCatalog)
        .values({
          id: model.id,
          name: model.name,
          labId: model.lab,
          labName: model.lab_name,
          family: model.family ?? null,
          modalitiesIn: model.modalities?.input ? JSON.stringify(model.modalities.input) : null,
          modalitiesOut: model.modalities?.output ? JSON.stringify(model.modalities.output) : null,
          contextLimit: model.limit?.context ?? null,
          inputLimit: model.limit?.input ?? null,
          outputLimit: model.limit?.output ?? null,
          reasoning: model.reasoning ?? null,
          toolCall: model.tool_call ?? null,
          structuredOutput: model.structured_output ?? null,
          rawPayload: JSON.stringify(model),
          sourceUrl: snapshot.source,
          fetchedAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing();
      loaded++;
    } catch (err) {
      // 已存在或其他错误，跳过
      skipped++;
    }
  }

  console.log(`[catalog] snapshot loaded: ${loaded} new, ${skipped} skipped`);
  return { loaded, skipped };
}
