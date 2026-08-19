import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema/index";

const DB_URL = process.env.OPENHUB_DB_URL ?? "./data/openhub.db";

mkdirSync(dirname(DB_URL), { recursive: true });

const sqlite = new Database(DB_URL);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { schema };
export type DB = typeof db;
