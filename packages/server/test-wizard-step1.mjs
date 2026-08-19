// 测试向导 step1（会触发推理）
const modelId = "tGUb5x6DWM4EvnO2zVfCK__doubao-seedance-2-0";

console.log(`Testing wizard step1 for: ${modelId}\n`);

const resp = await fetch(`http://localhost:3000/admin/wizard/${modelId}/step1`, {
  method: "GET",
  headers: {
    Authorization: "Basic YWRtaW46YWRtaW4xMjM=",
  },
});

const json = await resp.json();

console.log("Response:");
console.log(JSON.stringify(json, null, 2));

if (json.data?.inferredCapability) {
  const cap = json.data.inferredCapability;
  console.log("\n=== Inferred Capability ===");
  console.log(`Vendor: ${cap.inferredVendor}`);
  console.log(`Family: ${cap.inferredFamily}`);
  console.log(`Version: ${cap.inferredVersion}`);
  console.log(`Modality: ${cap.modality}`);
  console.log(`Confidence: ${cap.confidence}`);
  console.log(`Reasoning: ${cap.reasoning}`);
}
