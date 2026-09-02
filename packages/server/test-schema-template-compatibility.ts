import assert from "node:assert/strict";
import test from "node:test";
import { builtinAdapterManifest } from "./src/engine/adapter-manifest";
import { evaluateSchemaTemplateCompatibility, type SchemaCatalogCandidate } from "./src/engine/catalog/schema-matcher";
import type { AdapterRegistration } from "./src/engine/adapter-manifest";

const model = { modality: "video" } as never;
const schema: SchemaCatalogCandidate = {
  endpointId: "google/veo-3.1",
  title: "Veo",
  modality: "video",
  pricing: null,
  parameters: JSON.stringify([
    { name: "prompt", type: "string", required: true },
    { name: "duration", type: "integer", required: false },
    { name: "aspect_ratio", type: "string", required: false },
  ]),
  inputSchema: null,
  outputSchema: null,
  description: null,
  falCategory: "video",
  falSource: "queue",
};

function registration(id: string): AdapterRegistration {
  const manifest = builtinAdapterManifest(id);
  return { adapter: {} as never, manifest, status: "ready", issues: [] };
}

test("requires an explicit protocol when an adapter has multiple video bindings", () => {
  const result = evaluateSchemaTemplateCompatibility({ model, schema, registration: registration("memefast") });
  assert.equal(result.decision, "candidate");
  assert.ok(result.reasons.includes("video_protocol_binding_required"));
});

test("confirms a compatible video template after protocol selection", () => {
  const result = evaluateSchemaTemplateCompatibility({
    model,
    schema,
    registration: registration("memefast"),
    protocolId: "veo",
    schemaConfirmed: true,
  });
  assert.equal(result.decision, "confirmed");
  assert.equal(result.templateId, "veo");
  assert.deepEqual(result.fieldMapping, { prompt: "prompt", duration: "duration", aspect_ratio: "aspect_ratio" });
});

test("rejects modality mismatch and unmapped required fields", () => {
  const mismatch = evaluateSchemaTemplateCompatibility({
    model: { modality: "image" } as never,
    schema,
    registration: registration("memefast"),
    protocolId: "veo",
    schemaConfirmed: true,
  });
  assert.equal(mismatch.decision, "incompatible");

  const required = evaluateSchemaTemplateCompatibility({
    model,
    schema: { ...schema, parameters: JSON.stringify([{ name: "private_vendor_field", required: true }]) },
    registration: registration("memefast"),
    protocolId: "veo",
    schemaConfirmed: true,
  });
  assert.equal(required.decision, "incompatible");
  assert.deepEqual(required.unmappedRequiredFields, ["private_vendor_field"]);
});
