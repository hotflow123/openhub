import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema/index";

const DB_URL = process.env.OPENHUB_DB_URL ?? "./data/openhub.db";

mkdirSync(dirname(DB_URL), { recursive: true });

const client = createClient({ url: `file:${DB_URL}` });

export const db = drizzle(client, { schema });
export { schema };
export type DB = typeof db;