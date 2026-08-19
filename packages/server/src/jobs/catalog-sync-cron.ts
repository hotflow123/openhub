import { performSync } from "@openhub/catalog/sync";
import { syncDb } from "../engine/catalog/db-adapter.js";
import { refreshCatalogMappings } from "../engine/catalog/refresh-mappings.js";

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 5_000;

let timer: NodeJS.Timeout | null = null;
let initialTimer: NodeJS.Timeout | null = null;
let isSyncRunning = false;

async function runCatalogSync(): Promise<void> {
  if (isSyncRunning) {
    console.warn("[cron] catalog sync skipped because another run is active");
    return;
  }

  isSyncRunning = true;
  try {
    const result = await performSync(syncDb, { url: process.env.MODELS_DEV_URL });
    if (result.status !== "success") {
      console.error(`[cron] catalog sync failed: ${result.errorMessage}`);
      return;
    }

    const refreshed = await refreshCatalogMappings();
    console.log(
      `[cron] catalog sync ok: total=${result.total} added=${result.added} updated=${result.updated} aliases=${refreshed.aliases} matched=${refreshed.matched} unmatched=${refreshed.unmatched} schemaMatched=${refreshed.schemaMatched}`,
    );
  } catch (error) {
    console.error("[cron] catalog sync error:", error);
  } finally {
    isSyncRunning = false;
  }
}

export function startCatalogSyncCron(): void {
  initialTimer = setTimeout(() => {
    initialTimer = null;
    void runCatalogSync();
  }, INITIAL_DELAY_MS);

  if (process.env.NODE_ENV !== "production") {
    console.log("[cron] catalog sync scheduled once for non-production");
    return;
  }

  const intervalMs = Number(process.env.CATALOG_SYNC_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(intervalMs) || intervalMs < 60_000) {
    throw new Error("CATALOG_SYNC_INTERVAL_MS must be at least 60000 milliseconds");
  }

  timer = setInterval(() => void runCatalogSync(), intervalMs);
  console.log(`[cron] catalog sync scheduled every ${intervalMs / 1000}s`);
}

export function stopCatalogSyncCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
}

export { runCatalogSync };
