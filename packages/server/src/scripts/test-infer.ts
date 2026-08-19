#!/usr/bin/env tsx
import { inferModelCapability } from "../engine/llm-infer.js";

const testCases = [
  "doubao-seedance-2-0",
  "kling-v1-5",
  "claude-3-5-sonnet-20241022",
  "gpt-4o",
  "flux-1-1-pro",
  "deepseek-chat",
];

async function main() {
  console.log("🧪 Testing LLM Inference Engine\n");
  
  for (const modelId of testCases) {
    try {
      const result = await inferModelCapability(modelId);
      console.log(`✅ ${modelId}`);
      console.log(`   Modality: ${result.modality}`);
      console.log(`   Vendor: ${result.inferredVendor || "N/A"}`);
      console.log(`   Confidence: ${result.confidence}`);
      console.log("");
    } catch (err) {
      console.error(`❌ ${modelId}: ${err}`);
    }
  }
}

main().catch(console.error);
