import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOpenGenerativeAiModels } from "./src/lib/open-generative-ai";

test("normalizes external model schemas and merges duplicate modes", () => {
  const models = normalizeOpenGenerativeAiModels({
    t2iModels: [{
      id: "demo", name: "Demo", provider: "demo", provider_name: "Demo",
      promptRequired: true, imageField: "image_url", maxImages: 3,
      inputs: { prompt: { type: "string" }, size: { type: "int", enum: [1, 2], default: 1 } },
    }],
    i2iModels: [{
      id: "demo", description: "Merged", required: ["mask"],
      inputs: { mask: { type: "string" }, size: { type: "int", enum: [1, 2, 3] } },
    }],
  });

  assert.equal(models.length, 1);
  assert.equal(models[0].endpointId, "open-generative-ai:demo");
  assert.equal(models[0].modality, "image");
  assert.equal(models[0].parameters.find(({ name }) => name === "size")?.type, "integer");
  assert.deepEqual(models[0].inputSchema.required.sort(), ["mask", "prompt"]);
  assert.equal(models[0].parameters.length, 3);
});
