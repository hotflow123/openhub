/**
 * 模型发现后批量匹配目录
 *
 * DESIGN 第 7 章：
 *   catalog_match_confidence 字段是 high | medium | low 字符串
 *   catalog_match_source 可以是 exact | normalized | alias | keyword | null
 */

import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { modelCatalog, models } from "../../db/schema/index";
import { matchModel } from "@openhub/catalog/matcher";
import { matcherDb } from "./db-adapter";
import { buildCatalogProfileUpdate, clearCatalogProfileUpdate } from "./profile";

export async function matchModelsForSite(siteId: string): Promise<{
  matched: number;
  unmatched: number;
}> {
  const rows = await db
    .select()
    .from(models)
    .where(eq(models.siteId, siteId));

  let matched = 0;
  let unmatched = 0;

  for (const row of rows) {
    if (row.catalogMatchSource === "admin" && row.catalogModelId) {
      matched++;
      continue;
    }

    const result = await matchModel(matcherDb, row.rawName, {
      modality: row.modality,
    });

    if (result.catalogModelId && result.confidence >= 0.9) {
      const confidence =
        result.confidence >= 0.9 ? "high" : result.confidence >= 0.6 ? "medium" : "low";
      const [catalog] = await db
        .select({
          labName: modelCatalog.labName,
          family: modelCatalog.family,
          contextLimit: modelCatalog.contextLimit,
          outputLimit: modelCatalog.outputLimit,
          reasoning: modelCatalog.reasoning,
          toolCall: modelCatalog.toolCall,
          modalitiesIn: modelCatalog.modalitiesIn,
          modalitiesOut: modelCatalog.modalitiesOut,
        })
        .from(modelCatalog)
        .where(eq(modelCatalog.id, result.catalogModelId))
        .limit(1);
      const profileUpdate = catalog
        ? buildCatalogProfileUpdate(row, catalog, confidence)
        : {};
      await db
        .update(models)
        .set({
          catalogModelId: result.catalogModelId,
          catalogMatchSource: result.source,
          catalogMatchConfidence: confidence,
          catalogSyncedAt: new Date(),
          ...profileUpdate,
          updatedAt: new Date(),
        })
        .where(eq(models.id, row.id));
      matched++;
    } else {
      await db
        .update(models)
        .set({
          catalogModelId: null,
          catalogMatchSource: "none",
          catalogMatchConfidence: null,
          catalogSyncedAt: new Date(),
          ...clearCatalogProfileUpdate(row),
          updatedAt: new Date(),
        })
        .where(eq(models.id, row.id));
      unmatched++;
    }
  }

  return { matched, unmatched };
}
