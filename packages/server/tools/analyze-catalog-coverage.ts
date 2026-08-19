/**
 * 目录覆盖率分析工具
 *
 * 用法: pnpm --filter @openhub/server catalog:coverage
 */

import { db } from "../src/db/index.js";
import { models, modelCatalog } from "../src/db/schema/index.js";
import { isNull, isNotNull, sql, desc } from "drizzle-orm";

async function analyze() {
  console.log("\nOpenHub Catalog Coverage Report\n");

  const totalModels = await db
    .select({ count: sql<number>`count(*)` })
    .from(models);
  const matchedModels = await db
    .select({ count: sql<number>`count(*)` })
    .from(models)
    .where(isNotNull(models.catalogModelId));
  const unmatchedModels = await db
    .select({ count: sql<number>`count(*)` })
    .from(models)
    .where(isNull(models.catalogModelId));
  const totalCatalog = await db
    .select({ count: sql<number>`count(*)` })
    .from(modelCatalog);

  const total = totalModels[0]?.count ?? 0;
  const matched = matchedModels[0]?.count ?? 0;
  const unmatched = unmatchedModels[0]?.count ?? 0;
  const matchRate = total > 0 ? ((matched / total) * 100).toFixed(1) : "0.0";

  console.log(`Total Models: ${total}`);
  console.log(`Matched:      ${matched} (${matchRate}%)`);
  console.log(`Unmatched:    ${unmatched}`);
  console.log(`Catalog Entries: ${totalCatalog[0]?.count ?? 0}`);

  console.log("\nMatch Sources:");
  const bySource = await db
    .select({ source: models.catalogMatchSource, count: sql<number>`count(*)` })
    .from(models)
    .where(isNotNull(models.catalogMatchSource))
    .groupBy(models.catalogMatchSource);
  for (const row of bySource) {
    console.log(`  ${row.source ?? "(null)"}: ${row.count}`);
  }
  if (bySource.length === 0) console.log("  (no matches)");

  console.log("\nTop 15 Unmatched Families:");
  const unmatchedByFamily = await db
    .select({ family: models.family, count: sql<number>`count(*)` })
    .from(models)
    .where(isNull(models.catalogModelId))
    .groupBy(models.family)
    .orderBy(desc(sql`count(*)`))
    .limit(15);
  for (const row of unmatchedByFamily) {
    console.log(`  ${row.family ?? "(null)"}: ${row.count}`);
  }
  if (unmatchedByFamily.length === 0) console.log("  (all matched!)");

  console.log("\nTop 10 Catalog Labs:");
  const topLabs = await db
    .select({ lab: modelCatalog.labId, count: sql<number>`count(*)` })
    .from(modelCatalog)
    .groupBy(modelCatalog.labId)
    .orderBy(desc(sql`count(*)`))
    .limit(10);
  for (const row of topLabs) {
    console.log(`  ${row.lab}: ${row.count}`);
  }
}

analyze().catch((err) => {
  console.error("Analysis failed:", err);
  process.exitCode = 1;
});
