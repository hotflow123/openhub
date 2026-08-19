/**
 * 目录覆盖率分析工具
 *
 * 用法: pnpm --filter @openhub/server catalog:coverage
 * 实际执行文件位于 packages/server/tools/analyze-catalog-coverage.ts。
 *
 * 统计：
 *   - 总模型数
 *   - 已匹配目录的模型数 + 匹配率
 *   - 按匹配来源分组
 *   - 未匹配的 family 分布
 *   - 目录条目总数
 */

import { db } from "../packages/server/src/db/index.js";
import { models, modelCatalog } from "../packages/server/src/db/schema/index.js";
import { isNull, isNotNull, sql, desc } from "drizzle-orm";

async function analyze() {
  console.log("\n📊 OpenHub Catalog Coverage Report\n");

  // 总模型数
  const totalModels = await db
    .select({ count: sql<number>`count(*)` })
    .from(models);

  // 已匹配
  const matchedModels = await db
    .select({ count: sql<number>`count(*)` })
    .from(models)
    .where(isNotNull(models.catalogModelId));

  // 未匹配
  const unmatchedModels = await db
    .select({ count: sql<number>`count(*)` })
    .from(models)
    .where(isNull(models.catalogModelId));

  // 目录总条目
  const totalCatalog = await db
    .select({ count: sql<number>`count(*)` })
    .from(modelCatalog);

  const total = totalModels[0].count;
  const matched = matchedModels[0].count;
  const unmatched = unmatchedModels[0].count;
  const matchRate = total > 0 ? ((matched / total) * 100).toFixed(1) : "0.0";

  console.log(`Total Models: ${total}`);
  console.log(`Matched:      ${matched} (${matchRate}%)`);
  console.log(`Unmatched:    ${unmatched}`);
  console.log(`Catalog Entries: ${totalCatalog[0].count}`);

  // 按匹配来源分组
  console.log("\n📌 Match Sources:");
  const bySource = await db
    .select({
      source: models.catalogMatchSource,
      count: sql<number>`count(*)`,
    })
    .from(models)
    .where(isNotNull(models.catalogMatchSource))
    .groupBy(models.catalogMatchSource);

  if (bySource.length === 0) {
    console.log("  (no matches)");
  } else {
    for (const row of bySource) {
      console.log(`  ${row.source ?? "(null)"}: ${row.count}`);
    }
  }

  // 按 family 分组的未匹配模型数
  console.log("\n🔍 Top 15 Unmatched Families:");
  const unmatchedByFamily = await db
    .select({
      family: models.family,
      count: sql<number>`count(*)`,
    })
    .from(models)
    .where(isNull(models.catalogModelId))
    .groupBy(models.family)
    .orderBy(desc(sql`count(*)`))
    .limit(15);

  if (unmatchedByFamily.length === 0) {
    console.log("  (all matched!)");
  } else {
    for (const row of unmatchedByFamily) {
      console.log(`  ${row.family ?? "(null)"}: ${row.count}`);
    }
  }

  // 按厂商（lab）的目录分布
  console.log("\n🏢 Top 10 Catalog Labs:");
  const topLabs = await db
    .select({
      lab: modelCatalog.labId,
      count: sql<number>`count(*)`,
    })
    .from(modelCatalog)
    .groupBy(modelCatalog.labId)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  for (const row of topLabs) {
    console.log(`  ${row.lab}: ${row.count}`);
  }

  console.log("");
}

analyze()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Analysis failed:", err);
    process.exit(1);
  });
