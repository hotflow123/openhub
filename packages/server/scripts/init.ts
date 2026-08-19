import { count, isNotNull, isNull } from "drizzle-orm";
import { performSync } from "@openhub/catalog/sync";
import { db } from "../src/db/index.js";
import { modelCatalog, models, modelSchemaCatalog } from "../src/db/schema/index.js";
import { syncDb } from "../src/engine/catalog/db-adapter.js";
import { refreshCatalogMappings } from "../src/engine/catalog/refresh-mappings.js";

async function main(): Promise<void> {
  console.log("OpenHub catalog initialization");

  const synced = await performSync(syncDb);
  if (synced.status !== "success") {
    throw new Error(`Catalog sync failed: ${synced.errorMessage ?? "unknown error"}`);
  }

  const refreshed = await refreshCatalogMappings();
  const [catalogTotal] = await db.select({ value: count() }).from(modelCatalog);
  const [schemaTotal] = await db.select({ value: count() }).from(modelSchemaCatalog);
  const [matchedTotal] = await db
    .select({ value: count() })
    .from(models)
    .where(isNotNull(models.catalogModelId));
  const [unmatchedTotal] = await db
    .select({ value: count() })
    .from(models)
    .where(isNull(models.catalogModelId));
  const matched = matchedTotal?.value ?? 0;
  const unmatched = unmatchedTotal?.value ?? 0;
  const total = matched + unmatched;
  const matchRate = total > 0 ? ((matched / total) * 100).toFixed(1) : "0.0";

  console.log(`Catalog records (models.dev): ${catalogTotal?.value ?? 0}`);
  console.log(`Schema records (fal.ai): ${schemaTotal?.value ?? 0}`);
  console.log(`Aliases generated: ${refreshed.aliases}`);
  console.log(`Models matched: ${matched}/${total} (${matchRate}%)`);
  console.log(`Models unmatched: ${unmatched}`);
  console.log(`Schema matched: ${refreshed.schemaMatched}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
