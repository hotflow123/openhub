// Idempotent live-database migration for the model wizard contract.
// This database was historically created with `db:push`, so Drizzle's
// migration journal is empty and `db:migrate` cannot safely replay 0000-0002.
const Database = require("better-sqlite3");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const dbPath = resolve(process.env.OPENHUB_DB_URL ?? "data/openhub.db");
if (!existsSync(dbPath)) {
  throw new Error(`Database file does not exist: ${dbPath}`);
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

try {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'variants'")
    .get();
  if (!table) {
    throw new Error("Required table variants does not exist; refusing migration");
  }

  const before = db
    .prepare("SELECT name FROM pragma_table_info('variants') WHERE name = 'param_limits'")
    .get();

  const apply = db.transaction(() => {
    if (!before) {
      db.exec("ALTER TABLE `variants` ADD `param_limits` text");
    }
  });
  apply();

  const after = db
    .prepare("SELECT name FROM pragma_table_info('variants') WHERE name = 'param_limits'")
    .get();
  if (!after) {
    throw new Error("Migration finished without creating variants.param_limits");
  }

  const variantCount = db.prepare("SELECT COUNT(*) AS count FROM variants").get().count;
  console.log(JSON.stringify({
    database: dbPath,
    changed: !before,
    column: "variants.param_limits",
    variantCount,
  }, null, 2));
} finally {
  db.close();
}
