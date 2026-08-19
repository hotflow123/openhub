import { db } from "../db/index.js";
import { modelSchemaCatalog } from "../db/schema/index.js";

async function checkSingle() {
  const rows = await db.select().from(modelSchemaCatalog).limit(3);
  
  for (const row of rows) {
    console.log("\n=== Schema Entry ===");
    console.log(JSON.stringify(row, null, 2));
  }
}

checkSingle().catch(console.error);
