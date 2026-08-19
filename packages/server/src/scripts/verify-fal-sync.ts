import { db } from "../db/index.js";
import { modelSchemaCatalog, modelSchemaAlias } from "../db/schema/index.js";
import { sql } from "drizzle-orm";

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

  // 3. 查看几个示例记录
  console.log("=== 示例 Schema Catalog 记录 (前 5 条) ===");
  const samples = await db
    .select()
    .from(modelSchemaCatalog)
    .limit(5);

  samples.forEach(s => {
    console.log(`  ${s.endpointId}`);
    console.log(`    vendor: ${s.vendor}, family: ${s.family}, modality: ${s.modality}`);
  });

  // 4. 查看视频模型的 alias
  console.log("\n=== 视频模型 Alias 示例 ===");
  const videoAliases = await db
    .select()
    .from(modelSchemaAlias)
    .where(sql`${modelSchemaAlias.normalized} LIKE '%seedance%' OR ${modelSchemaAlias.normalized} LIKE '%grok%video%' OR ${modelSchemaAlias.normalized} LIKE '%veo%'`)
    .limit(10);

  videoAliases.forEach(a => {
    console.log(`  ${a.alias} -> ${a.endpointId}`);
    console.log(`    normalized: ${a.normalized}`);
  });

  process.exit(0);
}

main();
