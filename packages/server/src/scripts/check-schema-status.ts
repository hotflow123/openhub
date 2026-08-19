import { db } from "../db/index.js";
import { modelSchemaCatalog, modelSchemaAlias } from "../db/schema/index.js";
import { count, sql } from "drizzle-orm";

async function checkSchemaStatus() {
  console.log("=== Schema Catalog Status ===\n");
  
  // 统计总数
  const [catalogCount] = await db
    .select({ count: count() })
    .from(modelSchemaCatalog);
  
  const [aliasCount] = await db
    .select({ count: count() })
    .from(modelSchemaAlias);
  
  console.log(`Total schema catalog entries: ${catalogCount.count}`);
  console.log(`Total schema aliases: ${aliasCount.count}\n`);
  
  // 按 modality 统计
  const byModality = await db
    .select({
      modality: modelSchemaCatalog.modality,
      count: count(),
    })
    .from(modelSchemaCatalog)
    .groupBy(modelSchemaCatalog.modality);
  
  console.log("By modality:");
  for (const row of byModality) {
    console.log(`  ${row.modality}: ${row.count}`);
  }
  
  // 显示一些示例
  console.log("\n=== Sample Entries ===\n");
  
  const samples = await db
    .select()
    .from(modelSchemaCatalog)
    .limit(10);
  
  for (const s of samples) {
    console.log(`${s.endpointId} | ${s.modality} | ${s.vendor}/${s.family}`);
  }
  
  // 检查视频模型
  console.log("\n=== Video Models ===\n");
  
  const videoModels = await db
    .select()
    .from(modelSchemaCatalog)
    .where(sql`${modelSchemaCatalog.modality} = 'video'`)
    .limit(20);
  
  for (const v of videoModels) {
    console.log(`${v.endpointId} | ${v.vendor}/${v.family}`);
  }
}

checkSchemaStatus().catch(console.error);
