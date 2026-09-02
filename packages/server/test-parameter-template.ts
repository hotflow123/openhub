import assert from "node:assert/strict";
import test from "node:test";
import { evaluateParameterTemplateCompatibility } from "./src/engine/catalog/parameter-template-matcher";
import { builtinAdapterManifest, type AdapterRegistration } from "./src/engine/adapter-manifest";

const model = { rawName: "flux-dev", displayName: null, family: "flux", vendor: "blackforest", modality: "image" } as any;
const template = { sourceModelId: "flux-dev", sourceCollection: "t2iModels", sourceIndex: 0, operation: "image.text_to_image", modality: "image", provider: "blackforest", providerName: "Black Forest Labs", endpointHint: "flux-dev-image", inputs: { prompt: { type: "string", required: true }, aspect_ratio: { type: "string", default: "1:1" }, private_field: { type: "string" } }, required: ["prompt"], provenance: { sourceCommit: "c", file: "models.js", collection: "t2iModels", index: 0 } } as any;

test("keeps Open-Generative-AI templates advisory until confirmed", () => {
  const manifest = builtinAdapterManifest("openai");
  const registration = { adapter: {} as never, manifest, status: "ready", issues: [] } as AdapterRegistration;
  const result = evaluateParameterTemplateCompatibility({ model, template, registration, operation: template.operation, templateConfirmed: false });
  assert.equal(result.decision, "candidate");
  assert.deepEqual(result.fieldMapping, { prompt: "prompt", aspect_ratio: "aspect_ratio" });
  assert.deepEqual(result.unmappedRequiredFields, []);
  assert.ok(result.unsupportedFields.includes("private_field"));
});

test("selects the explicit MemeFast video protocol instead of guessing", () => {
  const manifest = builtinAdapterManifest("memefast");
  const registration = { adapter: {} as never, manifest, status: "ready", issues: [] } as AdapterRegistration;
  const result = evaluateParameterTemplateCompatibility({
    model: { rawName: "veo_3_1-fast", displayName: null, family: "veo", vendor: "Google", modality: "video" } as any,
    template: { sourceModelId: "veo", sourceCollection: "t2vModels", sourceIndex: 0, operation: "video.text_to_video", modality: "video", provider: "google", providerName: "Google", endpointHint: null, inputs: { prompt: { type: "string" }, duration: { type: "integer" } }, required: [], provenance: { sourceCommit: "c", file: "x", collection: "x", index: 0 } } as any,
    registration,
    operation: "video.text_to_video",
    templateConfirmed: true,
    adapterConfig: { video: { protocol: "veo" } },
  });
  assert.equal(result.decision, "confirmed");
  assert.deepEqual(result.fieldMapping, { prompt: "prompt", duration: "duration" });
});

test("does not turn an audio source template into speech", () => {
  const manifest = builtinAdapterManifest("memefast");
  const registration = { adapter: {} as never, manifest, status: "ready", issues: [] } as AdapterRegistration;
  const result = evaluateParameterTemplateCompatibility({
    model: { rawName: "audio-model", displayName: null, family: "audio", vendor: "x", modality: "audio" } as any,
    template: { sourceModelId: "audio-model", sourceCollection: "audio", sourceIndex: 0, operation: "audio.source", modality: "audio", provider: "x", providerName: "x", endpointHint: null, inputs: { input: { type: "string" } }, required: [], provenance: { sourceCommit: "c", file: "x", collection: "x", index: 0 } } as any,
    registration,
    operation: "audio.source",
    templateConfirmed: true,
  });
  assert.equal(result.decision, "incompatible");
  assert.ok(result.reasons.includes("audio_source_operation_requires_adapter"));
});
