import { matchModel } from "@openhub/catalog/matcher";
import type { MatchResult as CatalogMatchResult } from "@openhub/catalog/sync";
import { matcherDb } from "./db-adapter.js";
import { matchModelsForSite as refreshModelsForSite } from "./match-after-discover.js";

export type MatchResult = {
  catalogModelId: string | null;
  matchSource: CatalogMatchResult["source"];
  confidence: number;
};

export async function matchModelName(rawName: string): Promise<MatchResult> {
  const result = await matchModel(matcherDb, rawName);
  return {
    catalogModelId: result.catalogModelId,
    matchSource: result.source,
    confidence: result.confidence,
  };
}

export async function matchModelsForSite(siteId: string): Promise<{ matched: number; total: number }> {
  const result = await refreshModelsForSite(siteId);
  return { matched: result.matched, total: result.matched + result.unmatched };
}
