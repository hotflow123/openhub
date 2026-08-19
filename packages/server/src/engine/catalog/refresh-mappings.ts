import { generateAliases } from "@openhub/catalog/sync";
import { db } from "../../db/index.js";
import { modelCatalog, sites } from "../../db/schema/index.js";
import { aliasDb } from "./db-adapter.js";
import { matchModelsForSite } from "./match-after-discover.js";
import { matchSchemasForSite } from "./schema-matcher.js";

export interface CatalogRefreshResult {
  aliases: number;
  sites: number;
  matched: number;
  unmatched: number;
  schemaMatched: number;
}

export async function refreshCatalogMappings(): Promise<CatalogRefreshResult> {
  const catalogs = await db.select({ id: modelCatalog.id }).from(modelCatalog);
  const aliases = await generateAliases(aliasDb, catalogs);
  const allSites = await db.select({ id: sites.id }).from(sites);

  let matched = 0;
  let unmatched = 0;
  let schemaMatched = 0;

  for (const site of allSites) {
    // 1. 匹配 model_catalog（身份目录）
    const matchResult = await matchModelsForSite(site.id);
    matched += matchResult.matched;
    unmatched += matchResult.unmatched;

    // 2. 匹配 fal.ai Schema（参数结构）
    const schemaResult = await matchSchemasForSite(site.id);
    schemaMatched += schemaResult.matched;
  }

  return { aliases, sites: allSites.length, matched, unmatched, schemaMatched };
}
