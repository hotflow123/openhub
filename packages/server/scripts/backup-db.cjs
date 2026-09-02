const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

function readOutputPath() {
  const outputArg = process.argv.find((value) => value.startsWith("--output="));
  if (outputArg) return outputArg.slice("--output=".length);

  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  return path.join("data", "backups", `openhub-${stamp}.db`);
}

async function main() {
  const sourcePath = path.resolve(process.env.OPENHUB_DB_URL ?? "./data/openhub.db");
  const outputPath = path.resolve(readOutputPath());

  if (sourcePath === outputPath) {
    throw new Error("Backup output must differ from OPENHUB_DB_URL");
  }
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Database not found: ${sourcePath}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const database = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await database.backup(outputPath);
  } finally {
    database.close();
  }

  const size = fs.statSync(outputPath).size;
  console.log(`[openhub] database backup created: ${outputPath} (${size} bytes)`);
}

main().catch((error) => {
  console.error(`[openhub] database backup failed: ${error.message}`);
  process.exitCode = 1;
});
