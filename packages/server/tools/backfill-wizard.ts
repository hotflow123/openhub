/**
 * wizard backfill — 把历史已存在的 models 数据回填到向导内一致的字段
 *
 * 设计意图:
 *  - 早期发现阶段只写入 rawName / siteId，modality 默认是 "llm"。
 *  - 一旦 sync catalog 成功，catalogMatchSource 从 'none' → 'exact'/'alias'/'fuzzy' 等
 *  - 缺少 catalogMatchSource 但 modality='llm' 的模型 — 用 vendor/family 再次匹配
 *  - 缺少 capsOverridden 但 endpointCaps=[] 的 — 根据 rawName 关键字做第三层匹配
 *
 * 不要重复在 wizard 提交流程中执行（避免死循环）
 */
import { db } from "../src/db/index";
import { models } from "../src/db/schema/index";
import { eq, isNull, sql } from "drizzle-orm";

const BACKFILL_VENDOR_KEYWORDS: Array<{ pattern: RegExp; vendor: string }> = [
  { pattern: /gpt/i, vendor: "openai" },
  { pattern: /^claude/i, vendor: "anthropic" },
  { pattern: /gemini/i, vendor: "google" },
  { pattern: /deepseek/i, vendor: "deepseek" },
  { pattern: /qwen/i, vendor: "alibaba" },
  { pattern: /llama/i, vendor: "meta" },
  { pattern: /mistral|mixtral/i, vendor: "mistral" },
];

function inferVendor(rawName: string): string | null {
  for (const { pattern, vendor } of BACKFILL_VENDOR_KEYWORDS) {
    if (pattern.test(rawName)) return vendor;
  }
  return null;
}

async function backfillModels() {
  console.log("[backfill] starting wizard data backfill");

  // 1. 补 vendor 字段
  const allModels = await db.select().from(models);
  let vendorFilled = 0;
  for (const m of allModels) {
    if (m.vendor) continue;
    const v = inferVendor(m.rawName);
    if (v) {
      await db
        .update(models)
        .set({ vendor: v, updatedAt: new Date() })
        .where(eq(models.id, m.id));
      vendorFilled++;
    }
  }
  console.log(`[backfill] vendor filled: ${vendorFilled}`);

  // 2. 对 modality='llm' 且 endpointCaps=[] 的模型，按关键字补 endpointCaps
  const needCaps = await db
    .select()
    .from(models)
    .where(eq(models.modality, "llm"));
  let capsFilled = 0;
  for (const m of needCaps) {
    const caps = JSON.parse(m.endpointCaps || "[]") as string[];
    if (caps.length > 0) continue;
    const newCaps: string[] = ["chat"];
    if (/embed/i.test(m.rawName)) {
      // modality 应该是 embedding 不是 llm
      await db
        .update(models)
        .set({
          modality: "embedding",
          endpointCaps: JSON.stringify(["embed"]),
          updatedAt: new Date(),
        })
        .where(eq(models.id, m.id));
      capsFilled++;
      continue;
    }
    if (/vision|gpt-4o|claude-3|gpt-4-vision/i.test(m.rawName)) {
      newCaps.push("vision");
    }
    if (/tts/i.test(m.rawName)) {
      await db
        .update(models)
        .set({
          modality: "audio",
          endpointCaps: JSON.stringify(["tts"]),
          updatedAt: new Date(),
        })
        .where(eq(models.id, m.id));
      capsFilled++;
      continue;
    }
    if (/dall-e|sd-|imagen/i.test(m.rawName)) {
      await db
        .update(models)
        .set({
          modality: "image",
          endpointCaps: JSON.stringify(["image"]),
          updatedAt: new Date(),
        })
        .where(eq(models.id, m.id));
      capsFilled++;
      continue;
    }
    if (newCaps.length > 1 || caps.length === 0) {
      await db
        .update(models)
        .set({ endpointCaps: JSON.stringify(newCaps), updatedAt: new Date() })
        .where(eq(models.id, m.id));
      capsFilled++;
    }
  }
  console.log(`[backfill] caps/modality filled: ${capsFilled}`);

  console.log("[backfill] done");
}

backfillModels()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
