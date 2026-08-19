/**
 * 模型发现后批量匹配目录
 *
 * DESIGN 第 7 章：
 *   catalog_match_confidence 字段是 high | medium | low 字符串
 *   catalog_match_source 可以是 exact | normalized | alias | keyword | null
 */

import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { models } from "../../db/schema/index";
import { matchModel } from "@openhub/catalog/matcher";
import { inferKimiFamily } from "@openhub/catalog/upstream/family";
import { matcherDb } from "./db-adapter";

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
    const result = await matchModel(matcherDb, row.rawName, {
      customInferrers: [(name) => inferKimiFamily(name)],
      allowKeywordFallback: true, // 允许通过关键词匹配
    });

    if (result.catalogModelId) {
      const confidence =
        result.confidence >= 0.9 ? "high" : result.confidence >= 0.6 ? "medium" : "low";
      await db
        .update(models)
        .set({
          catalogModelId: result.catalogModelId,
          catalogMatchSource: result.source,
          catalogMatchConfidence: confidence,
          catalogSyncedAt: new Date(),
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
          updatedAt: new Date(),
        })
        .where(eq(models.id, row.id));
      unmatched++;
    }
  }

  return { matched, unmatched };
}