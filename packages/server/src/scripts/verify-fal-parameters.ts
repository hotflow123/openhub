/**
 * 验证 fal.ai 完整参数是否被 infer.ts 正确提取
 *
 * 选取 Seedance 2.5 三个变体（reference-to-video / image-to-video / text-to-video），
 * 验证：
 *   - parameters[] 完整数组是否被提取（9 / 8 / 6 个参数）
 *   - duration enum、resolution enum、aspect_ratio 是否来自 fal 真实值
 *   - falSource / pricing / description 是否被保留
 */

import { db } from "../db/index.js";
import { modelSchemaCatalog } from "../db/schema/index.js";
import { inferModelCapability } from "../engine/infer.js";
import { eq } from "drizzle-orm";

async function main() {
  console.log("=== 验证 fal.ai 完整参数提取 ===\n");

  const targets = [
    "bytedance/seedance-2.5/reference-to-video",
    "bytedance/seedance-2.5/image-to-video",
    "bytedance/seedance-2.5/text-to-video",
  ];

  for (const endpointId of targets) {
    console.log(`\n────────────────────────────────────────────`);
    console.log(`📦 ${endpointId}`);
    console.log(`────────────────────────────────────────────`);

    const [row] = await db
      .select()
      .from(modelSchemaCatalog)
      .where(eq(modelSchemaCatalog.endpointId, endpointId))
      .limit(1);

    if (!row) {
      console.log("❌ schema not in DB (请先跑 sync:fal)");
      continue;
    }

    console.log(`category: ${row.falCategory}`);
    console.log(`source:   ${row.falSource}`);
    console.log(`title:    ${row.title}`);

    const inferred = await inferModelCapability(endpointId, { schemaEndpointId: endpointId });

    console.log(`\n[推理结果]`);
    console.log(`  modality:    ${inferred.modality}`);
    console.log(`  confidence:  ${inferred.confidence}`);
    console.log(`  falSource:   ${inferred.falSource}`);
    console.log(`  has pricing: ${inferred.pricing ? "✅" : "❌"}`);
    console.log(`  has desc:    ${inferred.description ? "✅" : "❌"}`);

    console.log(`\n[完整 parameters 数组] (${inferred.parameters?.length ?? 0} 条)`);
    if (inferred.parameters) {
      for (const p of inferred.parameters) {
        const required = p.required ? "✅必填" : "  可选";
        const enumStr =
          p.enum && Array.isArray(p.enum) && p.enum.length <= 8
            ? ` enum=${JSON.stringify(p.enum)}`
            : p.enum && Array.isArray(p.enum)
              ? ` enum=[${p.enum.length} values]`
              : "";
        const defaultStr = p.default !== undefined && p.default !== null ? ` default=${JSON.stringify(p.default)}` : "";
        console.log(`  ${required} ${p.name}:${p.type}${defaultStr}${enumStr}`);
      }
    }

    if (inferred.video) {
      console.log(`\n[video 能力]`);
      console.log(`  maxDurationSec:    ${inferred.video.maxDurationSec}`);
      console.log(`  durationEnum:      ${JSON.stringify(inferred.video.durationEnum)}`);
      console.log(`  supportedResolutions: ${JSON.stringify(inferred.video.supportedResolutions)}`);
      console.log(`  aspectRatios:      ${JSON.stringify(inferred.video.aspectRatios)}`);
      console.log(`  requiresAsync:     ${inferred.video.requiresAsync} (从 falSource=queue 推导)`);
      console.log(`  generateAudio:     ${inferred.video.generateAudio}`);
      console.log(`  requiredParams:    ${JSON.stringify(inferred.video.requiredParams)}`);
      console.log(`  optionalParams:    ${JSON.stringify(inferred.video.optionalParams)}`);
    }

    // 断言：参数个数是否符合预期
    const expectedCount = endpointId.includes("reference") ? 9 : endpointId.includes("image-to-video") ? 8 : 6;
    const actualCount = inferred.parameters?.length ?? 0;
    const ok = actualCount === expectedCount;
    console.log(`\n  ${ok ? "✅" : "❌"} 参数个数: ${actualCount}/${expectedCount}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});