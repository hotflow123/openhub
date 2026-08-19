import Database from "better-sqlite3";

const db = new Database("./data/openhub.db", { readonly: true });
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all();
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
  console.log(`\n== ${t.name} (${ cols.length} cols) ==`);
  const nameWidth = Math.max(...cols.map((c) => c.name.length), 12);
  for (const c of cols) {
    console.log(`  ${c.name.padEnd(nameWidth)}  ${c.type}${c.notnull ? " NOT NULL" : ""}${c.dflt_value !== null ? ` DEFAULT ${c.dflt_value}` : ""}`);
  }
}
db.close();