import { db } from "./src/db/index.js";
import { variants, models } from "./src/db/schema/index.js";
import { eq } from "drizzle-orm";

const rows = await db
  .select({
    variantName: variants.name,
    modelId: variants.modelId,
    modality: models.modality,
  })
  .from(variants)
  .leftJoin(models, eq(variants.modelId, models.id))
  .limit(10);

console.log(JSON.stringify(rows, null, 2));
