import { db } from "./index";
import { sql } from "drizzle-orm";

const REQUIRED_TABLES = [
  "sites", "models", "keys", "variants",
  "model_catalog", "model_catalog_alias", "catalog_sync_runs", "tasks",
  "protocol_catalog", "model_protocol_bindings", "protocol_sync_runs",
];

const DB_URL = process.env.OPENHUB_DB_URL ?? "./data/openhub.db";

export async function ensureSchema(): Promise<void> {
  const result = await db.run(sql`SELECT name FROM sqlite_master WHERE type='table'`);
  const existing = new Set(result.rows.map((r: any) => String(r.name)));
  const missing = REQUIRED_TABLES.filter(t => !existing.has(t));
  if (missing.length > 0) {
    throw new Error(`Missing tables: ${missing.join(", ")}. Run migrations first.`);
  }
}

export async function bootstrapCatalogIfEmpty(): Promise<void> {
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(
    (await import("./schema/index")).modelCatalog
  );
  if (Number(row?.count ?? 0) > 0) return;

  const { performSync } = await import("@openhub/catalog/sync");
  const { syncDb } = await import("../engine/catalog/db-adapter");
  try {
    const result = await performSync(syncDb);
    if (result.status === "success") {
      console.log(`[openhub] catalog bootstrapped: total=${result.total} added=${result.added}`);
    } else {
      console.warn(`[openhub] catalog bootstrap skipped (${result.errorMessage}).`);
    }
  } catch (err) {
    console.warn(`[openhub] catalog bootstrap skipped: ${err instanceof Error ? err.message : err}`);
  }
}

export async function initApp(): Promise<void> {
  await ensureSchema();
  const { loadSnapshot } = await import("../engine/capability/load-snapshot.js");
  await loadSnapshot();
  bootstrapCatalogIfEmpty().catch(e =>
    console.error("[openhub] bootstrap catalog failed:", e),
  );
}
