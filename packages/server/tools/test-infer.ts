/**
 * 内部 LLM 推断测试 — 通过任意 chat 变体调用 LLM
 *
 * 用法: node tools/test-infer.ts <variantName>
 */
import { inferFromVariant } from "../src/engine/infer";

const variantName = process.argv[2];
if (!variantName) {
  console.error("Usage: node tools/test-infer.ts <variantName>");
  process.exit(1);
}

inferFromVariant(
  variantName,
  [
    { role: "system", content: "You are a helpful assistant. Reply in JSON." },
    { role: "user", content: 'Return {"ok":true} as JSON.' },
  ],
  { maxTokens: 32, temperature: 0 },
)
  .then((r) => {
    console.log("text:", r.text);
    console.log("usage:", r.usage);
  })
  .catch((e) => {
    console.error("infer failed:", e.message);
    process.exit(1);
  });
