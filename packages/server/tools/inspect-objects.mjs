import Database from "better-sqlite3";

const db = new Database("./data/openhub.db", { readonly: true });
const tables = db
  .prepare("SELECT name, type FROM sqlite_master ORDER BY name")
  .all();
console.log("ALL_OBJECTS:");
for (const t of tables) console.log(`  ${t.type}: ${t.name}`);
db.close();