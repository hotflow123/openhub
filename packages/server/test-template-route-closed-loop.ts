import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(new URL("./data/openhub.db", import.meta.url));
const tempDir = await mkdtemp(join(tmpdir(), "openhub-template-"));
const databasePath = join(tempDir, "fixture.db");
const source = new Database(sourcePath, { readonly: true });
await source.backup(databasePath);
source.close();
process.env.OPENHUB_DB_URL = databasePath;

const { default: variantsRoute } = await import("./src/routes/admin/variants.ts");
const { bootstrapAdapters } = await import("./src/engine/index.ts");
bootstrapAdapters();

test("binds a compatible template atomically through the admin route", async () => {
  const fixture = new Database(databasePath);
  fixture.pragma("foreign_keys = ON");
  const snapshot = JSON.parse(await readFile(fileURLToPath(new URL("../catalog/data/open-generative-ai.snapshot.json", import.meta.url)), "utf8")) as { records: any[] };
  const template = snapshot.records.find((item) => item.sourceModelId === "veo3.1-fast-text-to-video");
  assert.ok(template);
  fixture.prepare("INSERT OR IGNORE INTO sites (id, name, base_url, api_key_enc, api_key_iv, adapter_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)").run("fixture_site", "Fixture", "https://fixture.test", "", "", "memefast", "active");
  fixture.prepare("INSERT INTO models (id, site_id, raw_name, display_name, vendor, family, adapter_id, adapter_source, modality, modality_source, modality_confidence, endpoint_caps, param_caps, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("fixture_model", "fixture_site", "veo_3_1-fast", "veo_3_1-fast", "Google", "veo", "memefast", "manual", "video", "manual", "high", '["video_generation"]', "[]", "active");
  fixture.prepare("INSERT INTO model_parameter_templates (id, model_id, source, source_model_id, source_collection, operation, modality, template_snapshot, field_mapping, match_status, match_confidence, match_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("fixture_template", "fixture_model", "open_generative_ai", template.sourceModelId, template.sourceCollection, template.operation, template.modality, JSON.stringify(template), "{}", "candidate", "high", "fixture");
  fixture.prepare("INSERT INTO variants (id, name, model_id, adapter_config_status, is_public) VALUES (?, ?, ?, ?, ?)").run("fixture_variant", "fixture-variant", "fixture_model", "valid", 1);
  fixture.close();

  const request = (body: unknown) => variantsRoute.request("http://localhost/variants/fixture_variant/parameter-template", { method: "POST", headers: { authorization: "Basic YWRtaW46YWRtaW4xMjM=", "content-type": "application/json" }, body: JSON.stringify(body) });
  const review = await request({ templateId: "fixture_template" });
  assert.equal(review.status, 409);
  assert.equal((await review.json() as { error?: { code?: string } }).error?.code, "parameter_template_requires_review");

  const configured = new Database(databasePath);
  configured.prepare("UPDATE variants SET adapter_config = ? WHERE id = ?").run(JSON.stringify({ video: { protocol: "veo" } }), "fixture_variant");
  configured.close();
  const applied = await request({ templateId: "fixture_template" });
  assert.equal(applied.status, 200);
  const body = await applied.json() as { data?: { status?: string; variant?: { parameterTemplateId?: string } } };
  assert.equal(body.data?.status, "applied");
  assert.equal(body.data?.variant?.parameterTemplateId, "fixture_template");
});
