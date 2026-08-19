import { db } from "./src/db/index.js";
import { models, sites } from "./src/db/schema/index.js";
import { eq } from "drizzle-orm";

// 找所有 LLM 模型及其站点
const rows = await db
  .select({
    modelId: models.id,
    modelName: models.rawName,
    siteId: models.siteId,
    siteName: sites.name,
    siteBaseUrl: sites.baseUrl,
    siteStatus: sites.status,
  })
  .from(models)
  .leftJoin(sites, eq(models.siteId, sites.id))
  .where(eq(models.modality, "llm"))
  .limit(20);

console.log("All LLM models:");
console.log(JSON.stringify(rows, null, 2));
