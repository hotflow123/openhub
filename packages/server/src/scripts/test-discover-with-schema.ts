/**
 * 测试模型发现+Schema匹配的完整流程
 */

import { db } from "../db/index.js";
import { sites, models } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import { discoverModels } from "../engine/discover.js";
import { decrypt, getMasterKey } from "../lib/crypto.js";

// 手动加载 .env
import { resolve } from "path";
import { readFileSync } from "fs";

const envPath = resolve(process.cwd(), ".env");
try {
  const envContent = readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
} catch (e) {
  console.warn("⚠️ 无法加载 .env 文件");
}

async function main() {
  console.log("=== 测试完整发现+Schema匹配流程 ===\n");

  // 1. 查找测试站点
  const [site] = await db
    .select()
    .from(sites)
    .where(eq(sites.name, "openaa"))
    .limit(1);

  if (!site) {
    console.error("❌ 未找到 openaa 站点");
    process.exit(1);
  }

  console.log(`✓ 找到站点: ${site.name} (${site.baseUrl})`);

  // 2. 解密 API key
  if (!site.apiKeyEnc || !site.apiKeyIv) {
    console.error("❌ 站点缺少加密的 API key");
    process.exit(1);
  }

  const masterKey = getMasterKey();
  const apiKey = decrypt(site.apiKeyEnc, site.apiKeyIv, masterKey);
  console.log(`✓ API Key 解密成功: ${apiKey.substring(0, 10)}...\n`);

  // 3. 清空该站点的现有模型
  const deleted = await db
    .delete(models)
    .where(eq(models.siteId, site.id));
  
  console.log(`✓ 清空现有模型记录\n`);

  // 4. 执行模型发现
  console.log("⏳ 开始模型发现...");
  try {
    const discovered = await discoverModels(site.id, site.baseUrl, apiKey);
    console.log(`✅ 发现 ${discovered.length} 个模型\n`);

    // 5. 查询发现的模型详情
    const foundModels = await db
      .select({
        name: models.name,
        modality: models.modality,
        endpointCaps: models.endpointCaps,
        contextWindow: models.contextWindow,
        maxOutputTokens: models.maxOutputTokens,
        maxDurationSec: models.maxDurationSec,
        supportedSizes: models.supportedSizes,
        schemaEndpointId: models.schemaEndpointId,
        schemaMatchSource: models.schemaMatchSource,
      })
      .from(models)
      .where(eq(models.siteId, site.id));

    console.log("=== 发现的模型详情 ===\n");

    // 按模态分组显示
    const videoModels = foundModels.filter(m => m.modality === "video");
    const imageModels = foundModels.filter(m => m.modality === "image");
    const llmModels = foundModels.filter(m => m.modality === "llm");

    if (videoModels.length > 0) {
      console.log("📹 视频模型:");
      videoModels.forEach(m => {
        console.log(`  ${m.name}`);
        console.log(`    modality: ${m.modality}`);
        console.log(`    capabilities: ${m.endpointCaps}`);
        console.log(`    maxDurationSec: ${m.maxDurationSec || "N/A"}`);
        console.log(`    supportedSizes: ${m.supportedSizes || "N/A"}`);
        console.log(`    schemaEndpointId: ${m.schemaEndpointId || "N/A"}`);
        console.log(`    schemaMatchSource: ${m.schemaMatchSource || "N/A"}`);
        console.log("");
      });
    }

    if (imageModels.length > 0) {
      console.log("🖼️ 图像模型:");
      imageModels.slice(0, 3).forEach(m => {
        console.log(`  ${m.name}`);
        console.log(`    modality: ${m.modality}`);
        console.log(`    capabilities: ${m.endpointCaps}`);
        console.log(`    supportedSizes: ${m.supportedSizes || "N/A"}`);
        console.log(`    schemaEndpointId: ${m.schemaEndpointId || "N/A"}`);
        console.log("");
      });
    }

    if (llmModels.length > 0) {
      console.log(`💬 LLM 模型: ${llmModels.length} 个`);
      console.log(`  (示例: ${llmModels.slice(0, 3).map(m => m.name).join(", ")})\n`);
    }

    // 6. 统计 Schema 匹配情况
    const withSchema = foundModels.filter(m => m.schemaEndpointId);
    const withoutSchema = foundModels.filter(m => !m.schemaEndpointId);

    console.log("=== Schema 匹配统计 ===");
    console.log(`✅ 已匹配 Schema: ${withSchema.length} 个`);
    console.log(`❌ 未匹配 Schema: ${withoutSchema.length} 个`);
    
    if (withSchema.length > 0) {
      console.log(`\n已匹配模型示例:`);
      withSchema.slice(0, 5).forEach(m => {
        console.log(`  - ${m.name} → ${m.schemaEndpointId}`);
      });
    }

    if (withoutSchema.length > 0) {
      console.log(`\n未匹配模型示例:`);
      withoutSchema.slice(0, 5).forEach(m => {
        console.log(`  - ${m.name} (${m.modality})`);
      });
    }

  } catch (error) {
    console.error("❌ 模型发现失败:", error);
    if (error instanceof Error) {
      console.error("错误详情:", error.message);
    }
  }

  process.exit(0);
}

main();
