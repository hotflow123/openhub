import { db } from "../db/index.js";
import { models, sites } from "../db/schema/index.js";
import { eq, desc } from "drizzle-orm";
import { discoverModels } from "../engine/discover.js";

async function main() {
  console.log("=== Testing Model Discovery Flow ===\n");

  // 1. 查找一个测试站点
  const testSites = await db
    .select()
    .from(sites)
    .where(eq(sites.name, "openaa"))
    .limit(1);

  if (testSites.length === 0) {
    console.log("❌ No test site found (openaa)");
    console.log("Please add a site first using the web UI");
    return;
  }

  const testSite = testSites[0];
  console.log("✅ Found test site:", {
    id: testSite.id,
    name: testSite.name,
    baseUrl: testSite.baseUrl,
  });

  // 2. 清除该站点的旧模型（可选）
  console.log("\n🗑️  Clearing old models for this site...");
  const deleted = await db
    .delete(models)
    .where(eq(models.siteId, testSite.id!))
    .returning({ id: models.id });
  console.log(`   Deleted ${deleted.length} old models`);

  // 3. 运行发现流程
  console.log("\n🔍 Running discovery...");
  
  if (!testSite.baseUrl || !testSite.apiKey) {
    console.log("❌ Site missing baseUrl or apiKey");
    return;
  }
  
  const startTime = Date.now();
  
  try {
    const result = await discoverModels(testSite.id!, testSite.baseUrl, testSite.apiKey);
    const elapsed = Date.now() - startTime;
    
    console.log(`✅ Discovery completed in ${elapsed}ms`);
    console.log(`   Discovered ${result.discovered} models`);
    console.log(`   Skipped ${result.skipped} models\n`);

    // 4. 检查结果
    console.log("=== Sample Discovered Models ===\n");
    
    const newModels = await db
      .select({
        id: models.id,
        remoteId: models.remoteId,
        modality: models.modality,
        vendor: models.vendor,
        family: models.family,
        maxDurationSec: models.maxDurationSec,
        supportedSizes: models.supportedSizes,
        schemaEndpointId: models.schemaEndpointId,
        schemaMatchSource: models.schemaMatchSource,
      })
      .from(models)
      .where(eq(models.siteId, testSite.id!))
      .orderBy(desc(models.createdAt))
      .limit(10);

    for (const m of newModels) {
      console.log({
        id: m.id,
        remoteId: m.remoteId,
        modality: m.modality,
        vendor: m.vendor,
        family: m.family,
        maxDuration: m.maxDurationSec,
        supportedSizes: m.supportedSizes ? JSON.parse(m.supportedSizes).length : 0,
        schemaEndpointId: m.schemaEndpointId,
        schemaMatchSource: m.schemaMatchSource,
      });
    }

    // 5. 统计信息
    console.log("\n=== Statistics ===");
    
    const videoModels = newModels.filter((m) => m.modality === "video");
    const imageModels = newModels.filter((m) => m.modality === "image");
    const llmModels = newModels.filter((m) => m.modality === "llm");
    const withSchema = newModels.filter((m) => m.schemaEndpointId);

    console.log({
      total: newModels.length,
      video: videoModels.length,
      image: imageModels.length,
      llm: llmModels.length,
      withSchema: withSchema.length,
    });

    // 6. 检查 Seedance 模型
    const seedanceModels = newModels.filter((m) =>
      m.remoteId?.toLowerCase().includes("seedance")
    );
    
    if (seedanceModels.length > 0) {
      console.log("\n=== Seedance Models ===");
      for (const m of seedanceModels) {
        console.log({
          remoteId: m.remoteId,
          schemaEndpointId: m.schemaEndpointId,
          matchSource: m.schemaMatchSource,
        });
      }
    }

  } catch (error) {
    console.error("❌ Discovery failed:", error);
    throw error;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
