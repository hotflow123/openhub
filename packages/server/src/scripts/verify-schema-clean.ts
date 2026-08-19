/**
 * 验证 fal.ai schema 数据同步结果
 */

import { db } from "../db/index.js";
import { modelSchemaCatalog, modelSchemaAlias } from "../db/schema/index.js";
import { sql, like } from "drizzle-orm";

async function main() {
  console.log("=== fal.ai Schema 数据验证 ===\n");

  // 1. 统计 model_schema_catalog 总数
  const [catalogCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(modelSchemaCatalog);
  console.log(`✓ model_schema_catalog 表记录数: ${catalogCount.count}`);

  // 2. 统计 model_schema_alias 总数
  const [aliasCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(modelSchemaAlias);
  console.log(`✓ model_schema_alias 表记录数: ${aliasCount.count}\n`);

  // 3. Schema 模态分布
  console.log("=== Schema 模态分布 ===");
  const modalityStats = await db
    .select({
      modality: modelSchemaCatalog.modality,
      count: sql<number>`count(*)`,
    })
    .from(modelSchemaCatalog)
    .groupBy(modelSchemaCatalog.modality);

  modalityStats.forEach(stat => {
    console.log(`  ${stat.modality}: ${stat.count} 个`);
  });

  // 4. 示例视频模型（检查是否正确）
  console.log("\n=== 视频模型示例 (fal-ai/ 开头) ===");
  const videoSamples = await db
    .select({
      endpointId: modelSchemaCatalog.endpointId,
      title: modelSchemaCatalog.title,
      modality: modelSchemaCatalog.modality,
      falCategory: modelSchemaCatalog.falCategory,
    })
    .from(modelSchemaCatalog)
    .where(like(modelSchemaCatalog.endpointId, "fal-ai/%"))
    .limit(5);

  videoSamples.forEach(s => {
    console.log(`  ${s.endpointId}`);
    console.log(`    title: ${s.title}`);
    console.log(`    modality: ${s.modality}`);
    console.log(`    falCategory: ${s.falCategory}`);
  });

  // 5. 验证别名生成规则（只应该有 fal-ai/ 前缀相关的别名）
  console.log("\n=== 别名生成验证 ===");
  const aliasSamples = await db
    .select({
      alias: modelSchemaAlias.alias,
      normalized: modelSchemaAlias.normalized,
      aliasType: modelSchemaAlias.aliasType,
    })
    .from(modelSchemaAlias)
    .limit(10);

  console.log("示例别名:");
  aliasSamples.forEach(a => {
    console.log(`  "${a.alias}" (${a.aliasType}) -> ${a.normalized.substring(0, 40)}...`);
  });

  // 6. 检查是否还有跨源硬编码别名（不应该有）
  console.log("\n=== 检查硬编码别名（应该为空） ===");
  const hardcodedPatterns = [
    "doubao-seedance",
    "doubao-seedream",
    "seedance2.0",
    "seedance2-0",
    "doubao-video",
  ];

  for (const pattern of hardcodedPatterns) {
    const [count] = await db
      .select({ count: sql<number>`count(*)` })
      .from(modelSchemaAlias)
      .where(like(modelSchemaAlias.normalized, `%${pattern}%`));
    
    if (count.count > 0) {
      console.log(`  ⚠️ 发现硬编码别名 "${pattern}": ${count.count} 条`);
    } else {
      console.log(`  ✅ "${pattern}": 无匹配`);
    }
  }

  console.log("\n✅ 验证完成！");
  process.exit(0);
}

main();
