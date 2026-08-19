import { db } from "../db/index.js";
import { sites } from "../db/schema/index.js";

async function main() {
  const allSites = await db.select().from(sites);
  
  console.log("=== Sites in Database ===\n");
  for (const s of allSites) {
    console.log({
      id: s.id,
      name: s.name,
      baseUrl: s.baseUrl,
      hasApiKey: !!s.apiKey,
      createdAt: s.createdAt,
    });
  }
  
  console.log(`\nTotal: ${allSites.length} sites`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
