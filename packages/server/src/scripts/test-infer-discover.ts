#!/usr/bin/env tsx
/**
 * 测试：discover 阶段自动推理模型能力
 */
import { db } from "../db/index.js";
import { models } from "../db/schema/models.js";
import { eq } from "drizzle-orm";
import { discoverModels } from "../engine/discover.js";
import { decrypt, getMasterKey } from "../lib/crypto.js";

const SITE_ID = "n6jathGQxTayE05XJJiRU"; // openaa 站点

async function main() {
  // 设置环境变量（开发环境）
  if (!process.env.OPENHUB_MASTER_KEY) {
    process.env.OPENHUB_MASTER_KEY = "dev-master-key-please-change-in-production";
  }

  console.log("=== 测试 discover 自动推理 ===\n");

  // 0. 获取站点信息
  console.log("0. 获取站点信息...");
  const site = await db.query.sites.findFirst({
    where: (sites, { eq }) => eq(sites.id, SITE_ID),
  });
  if (!site) {
    throw new Error(`站点 ${SITE_ID} 不存在`);
  }
  console.log(`   站点: ${site.name}`);
  console.log(`   URL: ${site.baseUrl}\n`);

  // 解密 API Key
  const apiKey = await decrypt(site.apiKeyEnc, site.apiKeyIv, getMasterKey());

  // 1. 清理旧数据
  console.log("1. 清理旧数据...");
  await db.delete(models).where(eq(models.siteId, SITE_ID));
  console.log("   ✓ 已清理\n");

  // 2. 重新发现模型（会自动调用推理引擎）
  console.log("2. 重新发现模型（自动推理 modality）...");
  const result = await discoverModels(SITE_ID, site.baseUrl, apiKey);
  console.log(`   ✓ 发现: ${result.discovered}, 跳过: ${result.skipped}\n`);

  // 3. 执行目录匹配
  console.log("3. 执行目录匹配...");
  const { matchModelsForSite } = await import("../engine/catalog/match-after-discover.js");
  const matchResult = await matchModelsForSite(SITE_ID);
  console.log(`   ✓ 匹配成功: ${matchResult.matched}, 未匹配: ${matchResult.unmatched}\n`);

  // 4. 检查 doubao-seedance-2-0 的 modality
  console.log("4. 检查 doubao-seedance-2-0 的 modality:");
  const model = await db.query.models.findFirst({
    where: eq(models.rawName, "doubao-seedance-2-0"),
  });

  if (model) {
    console.log(`   rawName: ${model.rawName}`);
    console.log(`   modality: ${model.modality}`);
    console.log(`   catalogMatchSource: ${model.catalogMatchSource}`);
    console.log(`   catalogModelId: ${model.catalogModelId}`);
    console.log(`   expected: video`);
    console.log(`   result: ${model.modality === "video" ? "✅ PASS" : "❌ FAIL"}\n`);
  } else {
    console.log("   ❌ 模型不存在\n");
  }

  // 5. 显示所有模型的 modality 分布
  console.log("5. 所有模型的 modality 分布:");
  const allModels = await db.query.models.findMany({
    where: eq(models.siteId, SITE_ID),
  });

  const distribution: Record<string, number> = {};
  for (const m of allModels) {
    distribution[m.modality] = (distribution[m.modality] || 0) + 1;
  }

  for (const [mod, count] of Object.entries(distribution)) {
    console.log(`   ${mod}: ${count}`);
  }

  // 6. 显示目录匹配状态
  console.log("\n6. 目录匹配状态:");
  let matched = 0;
  let unmatched = 0;
  for (const m of allModels) {
    if (m.catalogModelId) {
      matched++;
      if (matched <= 5) {
        console.log(`   ✅ ${m.rawName} → ${m.catalogModelId} (${m.catalogMatchSource})`);
      }
    } else {
      unmatched++;
    }
  }
  console.log(`   匹配成功: ${matched}, 未匹配: ${unmatched}`);
}

main().catch(console.error);
