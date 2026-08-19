import { db } from "../db/index.js";
import { models, modelSchemaAlias } from "../db/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
  console.log("检查模型实例的 schema 关联情况...\n");

  // 检查几个关键的视频模型
  const testModels = [
    "doubao-seedance-2-0",
    "seedance2.0",
    "grok-imagine-1.0-video",
    "veo31-fast",
    "H3video-2k",
    "sora-v3-933-pro"
  ];

  for (const modelName of testModels) {
    const [model] = await db
      .select()
      .from(models)
      .where(eq(models.rawName, modelName))
      .limit(1);

    if (model) {
      console.log(`\n模型: ${model.rawName}`);
      console.log(`  模态: ${model.modality}`);
      console.log(`  能力: ${model.endpointCaps}`);
      console.log(`  Schema ID: ${model.schemaEndpointId || "未关联"}`);
      console.log(`  Schema 匹配源: ${model.schemaMatchSource || "N/A"}`);
      
      if (model.schemaEndpointId) {
        const [alias] = await db
          .select()
          .from(modelSchemaAlias)
          .where(eq(modelSchemaAlias.endpointId, model.schemaEndpointId))
          .limit(1);
        if (alias) {
          console.log(`  Schema Alias: ${alias.originalName}`);
        }
      }
      
      if (model.modality === "video") {
        console.log(`  最大时长: ${model.maxDurationSec || "未设置"}秒`);
        console.log(`  需要异步: ${model.requiresAsync ? "是" : "否"}`);
      } else if (model.modality === "image") {
        console.log(`  支持尺寸: ${model.supportedSizes || "未设置"}`);
      }
    } else {
      console.log(`\n模型 ${modelName} 未找到`);
    }
  }

  // 统计关联情况
  console.log("\n\n=== 整体统计 ===");
  const allModels = await db.select().from(models);
  const linked = allModels.filter(m => m.schemaEndpointId);
  const videoModels = allModels.filter(m => m.modality === "video");
  const videoLinked = videoModels.filter(m => m.schemaEndpointId);
  
  console.log(`总模型数: ${allModels.length}`);
  console.log(`已关联 schema: ${linked.length} (${((linked.length / allModels.length) * 100).toFixed(1)}%)`);
  console.log(`视频模型数: ${videoModels.length}`);
  console.log(`视频模型已关联: ${videoLinked.length} (${((videoLinked.length / videoModels.length) * 100).toFixed(1)}%)`);
}

main().catch(console.error);
