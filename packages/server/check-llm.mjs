import { db } from "./src/db/index.js";
import { models } from "./src/db/schema/index.js";
import { eq } from "drizzle-orm";

const rows = await db
  .select({
    id: models.id,
    rawName: models.rawName,
    modality: models.modality,
  })
  .from(models)
  .where(eq(models.modality, "llm"))
  .limit(5);

console.log(JSON.stringify(rows, null, 2));
