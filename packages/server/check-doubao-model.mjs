import { db } from "./src/db/index.js";
import { models } from "./src/db/schema/index.js";
import { eq } from "drizzle-orm";

const modelId = "tGUb5x6DWM4EvnO2zVfCK__doubao-seedance-2-0";

const [model] = await db
  .select()
  .from(models)
  .where(eq(models.id, modelId))
  .limit(1);

console.log("Model data:");
console.log(JSON.stringify(model, null, 2));
