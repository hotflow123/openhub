// P0-1 migration: 给 keys 表加 status / revoked_at
const Database = require("better-sqlite3");
const db = new Database("data/openhub.db");

const has = db
  .prepare("SELECT name FROM pragma_table_info('keys') WHERE name IN ('status', 'revoked_at')")
  .all();
console.log("before:", JSON.stringify(has));

if (!has.find((r) => r.name === "status")) {
  db.exec("ALTER TABLE keys ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  console.log("added status");
}
if (!has.find((r) => r.name === "revoked_at")) {
  db.exec("ALTER TABLE keys ADD COLUMN revoked_at INTEGER");
  console.log("added revoked_at");
}

const cols = db
  .prepare("SELECT name FROM pragma_table_info('keys') WHERE name IN ('status', 'revoked_at')")
  .all();
console.log("after:", JSON.stringify(cols));
