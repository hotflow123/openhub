/**
 * 完整推理流程测试
 * 
 * 测试场景：
 * 1. fal.ai schema 数据是否正确加载
 * 2. 模型名称能否正确匹配到 fal.ai schema
 * 3. 推理引擎能否从 schema 提取完整能力参数
 */

import { db } from "../db/index.js";
import { modelSchemaCatalog, modelSchemaAlias } from "../db/schema/index.js";
import { sql, like } from "drizzle-orm";

// 测试模型列表
const TEST_MODELS = [
  "doubao-seedance-2-0",
  "doubao-seedance-2-5", 
  "seedance2.0",
  "grok-imagine-1.0-video",
  "sora-v3-933-pro",
  "veo31-fast",
  "sd-2.5-480p",
  "gemini-3-pro-image-preview",
];

async function main() {
  console.log("=== fal.ai Schema 推理测试 ===\n");

  // 1. 检查 schema 表状态
  const [catalogCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(modelSchemaCatalog);
  
  const [aliasCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(modelSchemaAlias);

  console.log(`✓ Schema Catalog: ${catalogCount.count} 条`);
  console.log(`✓ Schema Alias: ${aliasCount.count} 条\n`);

  // 2. 测试别名匹配
  console.log("=== 测试别名匹配 ===\n");
  
  for (const modelName of TEST_MODELS) {
    const normalized = modelName
      .toLowerCase()
      .trim()
      .replace(/[_\-\/]/g, " ")
      .replace(/\s+/g, " ");

    const matches = await db
      .select({
        alias: modelSchemaAlias.alias,
        normalized: modelSchemaAlias.normalized,
        endpointId: modelSchemaAlias.endpointId,
        aliasType: modelSchemaAlias.aliasType,
      })
      .from(modelSchemaAlias)
      .where(like(modelSchemaAlias.normalized, `%${normalized}%`))
      .limit(3);

    console.log(`模型: ${modelName}`);
    console.log(`  归一化: ${normalized}`);
    
    if (matches.length > 0) {
      console.log(`  ✅ 找到 ${matches.length} 个匹配:`);
      matches.forEach(m => {
        console.log(`     - ${m.endpointId} (${m.aliasType})`);
      });

      // 3. 查询完整 schema
      const [schema] = await db
        .select()
        .from(modelSchemaCatalog)
        .where(sql`${modelSchemaCatalog.endpointId} = ${matches[0].endpointId}`)
        .limit(1);

      if (schema) {
        console.log(`  📋 Schema 详情:`);
        console.log(`     title: ${schema.title}`);
        console.log(`     modality: ${schema.modality}`);
        console.log(`     category: ${schema.falCategory}`);
        console.log(`     source: ${schema.falSource}`);
        
        // 尝试解析 input schema
        if (schema.inputSchema) {
          try {
            const inputSchema = JSON.parse(schema.inputSchema);
            const props = inputSchema.properties || {};
            const propCount = Object.keys(props).length;
            console.log(`     输入参数: ${propCount} 个`);
            
            // 显示关键参数
            const keyParams = ['duration', 'width', 'height', 'aspect_ratio', 'resolution'];
            for (const key of keyParams) {
              if (props[key]) {
                console.log(`       - ${key}: ${JSON.stringify(props[key]).substring(0, 60)}...`);
              }
            }
          } catch (e) {
            console.log(`     ⚠️ input_schema 解析失败`);
          }
        }
      }
    } else {
      console.log(`  ❌ 未找到匹配`);
    }
    console.log("");
  }

  // 4. 统计各模态的 schema 数量
  console.log("\n=== Schema 模态分布 ===");
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

  process.exit(0);
}

main();
