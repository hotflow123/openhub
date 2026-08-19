const testCases = [
  "doubao-seedance-2-5",
  "claude-opus-5",
  "gpt-5.5",
  "kling-video-v2",
  "flux-pro-1.1",
  "deepseek-v4-flash",
];

for (const modelName of testCases) {
  console.log(`\n========== Testing: ${modelName} ==========`);
  
  const resp = await fetch("http://localhost:3000/admin/catalog/infer", {
    method: "POST",
    headers: {
      Authorization: "Basic YWRtaW46YWRtaW4xMjM=",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ rawName: modelName }),
  });

  const json = await resp.json();
  const data = json.data;
  
  console.log(`Vendor: ${data.inferredVendor}`);
  console.log(`Family: ${data.inferredFamily}`);
  console.log(`Version: ${data.inferredVersion}`);
  console.log(`Modality: ${data.modality}`);
  console.log(`Confidence: ${data.confidence}`);
  console.log(`Reasoning: ${data.reasoning}`);
}
