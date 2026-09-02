import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../src/db/index.js";
import { sites } from "../src/db/schema/index.js";
import { decrypt, getMasterKey } from "../src/lib/crypto.js";
import { createMemeFastConnector } from "@openhub/memefast";

const site = (await db.select().from(sites).limit(1))[0];
if (!site) throw new Error("No configured site");

const apiKey = await decrypt(site.apiKeyEnc, site.apiKeyIv, getMasterKey());
const connector = createMemeFastConnector({ baseUrl: site.baseUrl, apiKey });
const verification = await connector.verify();
const models = verification.ok ? await connector.discover() : [];
const summary = {
  checkedAt: new Date().toISOString(),
  site: site.name,
  baseUrl: site.baseUrl,
  verify: verification.ok ? { ok: true, modelCount: verification.modelCount } : { ok: false, code: verification.error.code },
  discoveredModels: models.length,
  metadataVideoModels: models.filter((model) => {
    const raw = model.raw && typeof model.raw === "object" ? model.raw as Record<string, unknown> : {};
    return Array.isArray(raw.supported_endpoint_types) && raw.supported_endpoint_types.some((value) => /video|视频/i.test(String(value)));
  }).length,
  billableVideoSmoke: "not_run",
};

mkdirSync(resolve("../../docs"), { recursive: true });
writeFileSync(resolve("../../docs/memefast-readonly-evidence.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary));
