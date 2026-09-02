import assert from "node:assert/strict";
import test from "node:test";
import { getOpenGenerativeAiSnapshotPath, loadOpenGenerativeAiSnapshot } from "./src/engine/catalog/match-after-discover";
import { builtinAdapterManifest, type AdapterRegistration } from "./src/engine/adapter-manifest";
import { evaluateParameterTemplateCompatibility } from "./src/engine/catalog/parameter-template-matcher";
import { mapStoredVariantParams } from "./src/engine/param-mapper";

const registration = (id: string): AdapterRegistration => ({ adapter: {} as never, manifest: builtinAdapterManifest(id), status: "ready", issues: [] });

test("loads the parameter snapshot through a module-relative path", async () => {
  assert.match(getOpenGenerativeAiSnapshotPath(), /open-generative-ai\.snapshot\.json$/);
  const snapshot = await loadOpenGenerativeAiSnapshot();
  assert.ok(snapshot.records.length > 0);
  assert.equal(snapshot.source, "open-generative-ai");
});

test("selects and confirms a video template only with an explicit protocol", async () => {
  const snapshot = await loadOpenGenerativeAiSnapshot();
  const template = snapshot.records.find((item) => item.sourceModelId === "veo3.1-fast-text-to-video");
  assert.ok(template);
  const model = { rawName: "veo_3_1-fast", displayName: null, family: "veo", vendor: "Google", modality: "video" } as any;
  const withoutProtocol = evaluateParameterTemplateCompatibility({ model, template, registration: registration("memefast"), operation: template.operation, templateConfirmed: true });
  assert.equal(withoutProtocol.decision, "candidate");
  const withProtocol = evaluateParameterTemplateCompatibility({ model, template, registration: registration("memefast"), operation: template.operation, templateConfirmed: true, adapterConfig: { video: { protocol: "veo" } } });
  assert.equal(withProtocol.decision, "confirmed");
});

test("forwards defaults and two reference images through the mapper", () => {
  const result = mapStoredVariantParams(
    { model: "veo_3_1-fast", prompt: "x", image_urls: ["https://fixture.test/a.png", "https://fixture.test/b.png"], duration: 8 },
    { parameterTemplateSnapshot: JSON.stringify({ inputs: { resolution: { default: "720p" } } }), fieldMapping: JSON.stringify({ image_urls: "image_urls" }) },
    ["model", "prompt", "duration", "image_urls", "resolution"],
  );
  assert.equal(result.body.resolution, "720p");
  assert.deepEqual(result.body.image_urls, ["https://fixture.test/a.png", "https://fixture.test/b.png"]);
  assert.deepEqual(result.dropped, []);
});
