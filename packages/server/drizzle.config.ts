import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "./src/db/schema/sites.ts",
    "./src/db/schema/models.ts",
    "./src/db/schema/keys.ts",
    "./src/db/schema/variants.ts",
    "./src/db/schema/catalog.ts",
    "./src/db/schema/schema-catalog.ts",
    "./src/db/schema/tasks.ts",
    "./src/db/schema/audit.ts",
    "./src/db/schema/users.ts",
    "./src/db/schema/variant_groups.ts",
  ],
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.OPENHUB_DB_URL ?? "./data/openhub.db",
  },
  verbose: true,
  strict: true,
});