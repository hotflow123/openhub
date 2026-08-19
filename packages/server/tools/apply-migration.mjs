import Database from "better-sqlite3";
import { readFileSync, statSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const dbPath = resolve("./data/openhub.db");
console.log(`DB path: ${dbPath}, exists=${existsSync(dbPath)}`);

// 删除旧 DB（含 WAL/SHM）
for (const ext of ["", "-shm", "-wal"]) {
  const p = dbPath + ext;
  if (existsSync(p)) {
    unlinkSync(p);
    console.log(`  deleted ${p}`);
  }
}

// 重新建库
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// 验证是空 DB
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .all();
console.log("Pre-create tables:", tables.map((t) => t.name).join(", ") || "(empty)");

// 执行新 migration
const sql = readFileSync(resolve("./drizzle/0000_quiet_black_knight.sql"), "utf8");
const stmts = sql.split("--> statement-breakpoint");
let ok = 0;
let fail = 0;
for (const s of stmts) {
  const t = s.trim();
  if (!t) continue;
  try {
    db.exec(t);
    ok++;
  } catch (e) {
    console.error(`FAIL: ${t.slice(0, 80)}...\n${e.message}`);
    fail++;
  }
}
const newTables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all();
console.log(`OK ${ok} statements, FAIL ${fail}`);
console.log("TABLES:", newTables.map((t) => t.name).join(", "));

const m = db.prepare("PRAGMA table_info(models)").all();
console.log(`models has ${m.length} cols (expected 30)`);
const k = db.prepare("PRAGMA table_info(keys)").all();
console.log(`keys has ${k.length} cols (expected 11)`);
const v = db.prepare("PRAGMA table_info(variants)").all();
console.log(`variants has ${v.length} cols (expected 16)`);

db.close();