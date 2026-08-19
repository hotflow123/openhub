import { db } from "./src/db/index.js";
import { models, sites } from "./src/db/schema/index.js";
import { eq } from "drizzle-orm";

// 找第一个 LLM 模型
const [model] = await db
  .select({
    id: models.id,
    rawName: models.rawName,
    displayName: models.displayName,
    siteId: models.siteId,
    adapterId: models.adapterId,
  })
  .from(models)
  .where(eq(models.modality, "llm"))
  .limit(1);

if (!model) {
  console.log("No LLM model found");
  process.exit(1);
}

const [site] = await db
  .select({ id: sites.id, name: sites.name, adapterId: sites.adapterId })
  .from(sites)
  .where(eq(sites.id, model.siteId))
  .limit(1);

console.log("Model:", JSON.stringify(model, null, 2));
console.log("Site:", JSON.stringify(site, null, 2));

// 构造向导确认请求
const wizardPayload = {
  step2: {
    modality: "llm",
    catalogId: null,
    endpointCaps: ["chat"],
    paramCaps: ["temperature", "max_tokens", "top_p"],
  },
  step3: {
    adapterId: model.adapterId || site?.adapterId || "openai",
    variantName: `${model.rawName}-infer`,
    description: "首个 LLM variant，用于推理引擎",
    paramOverrides: {},
    paramBlocked: [],
    fieldMapping: {},
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsReasoning: false,
    supportsStream: true,
    requiresAsync: false,
    isPublic: true,
  },
};

console.log("\nWizard payload:");
console.log(JSON.stringify(wizardPayload, null, 2));

// 调用向导 confirm
const resp = await fetch(`http://localhost:3000/admin/wizard/${model.id}/confirm`, {
  method: "POST",
  headers: {
    Authorization: "Basic YWRtaW46YWRtaW4xMjM=",
    "Content-Type": "application/json",
  },
  body: JSON.stringify(wizardPayload),
});

const result = await resp.json();
console.log("\nResult:", JSON.stringify(result, null, 2));
