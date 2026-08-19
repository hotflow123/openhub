import assert from "node:assert/strict";
import test from "node:test";
import {
  validateModelRequest,
  validateVariantLimits,
  validateParameterLimitsAgainstModel,
  readModelInputContract,
} from "./src/lib/model-contract";

const model = {
  schemaMatchStatus: "confirmed",
  falParametersSnapshot: JSON.stringify([
    { name: "prompt", required: true },
    { name: "duration", enum: ["5", "10"] },
    { name: "audio_urls", description: "At least one reference image or video is required when audio is supplied." },
  ]),
  falInputSchemaSnapshot: JSON.stringify({
    type: "object",
    properties: {
      image_urls: { type: "array", maxItems: 9 },
      video_urls: { type: "array", maxItems: 3 },
      audio_urls: { type: "array", maxItems: 3, description: "Total files across all modalities must not exceed 12. At least one reference image or video is required when audio is supplied." },
    },
    required: ["prompt"],
  }),
  videoRequiredParams: null,
  videoOptionalParams: null,
  maxReferenceImages: 9,
  maxReferenceVideos: 3,
  maxReferenceAudios: 3,
  maxDurationSec: 10,
};

test("reads Fal fields, per-modality limits, total limit, and dependency", () => {
  const contract = readModelInputContract(model);
  assert.deepEqual(contract.fields.sort(), ["audio_urls", "duration", "image_urls", "prompt", "video_urls"].sort());
  assert.equal(contract.maxReferenceImages, 9);
  assert.equal(contract.maxReferenceVideos, 3);
  assert.equal(contract.maxReferenceAudios, 3);
  assert.equal(contract.totalReferenceFiles, 12);
  assert.equal(contract.audioRequiresImageOrVideo, true);
});

test("enforces model limits when the variant has no override", () => {
  assert.match(
    validateModelRequest(
      { model: "variant", prompt: "x", image_urls: Array(10).fill("i") },
      model,
      {},
    ) ?? "",
    /received 10, limit is 9/,
  );
  assert.match(
    validateModelRequest(
      { model: "variant", prompt: "x", image_urls: Array(9).fill("i"), video_urls: Array(3).fill("v"), audio_urls: ["a"] },
      model,
      {},
    ) ?? "",
    /received 13, limit is 12/,
  );
});

test("validates required, enum, and audio dependency rules before forwarding", () => {
  assert.match(validateModelRequest({ model: "variant" }, model, {}) ?? "", /Missing required model parameter: prompt/);
  assert.match(validateModelRequest({ model: "variant", prompt: "x", duration: "7" }, model, {}) ?? "", /Invalid duration/);
  assert.match(validateModelRequest({ model: "variant", prompt: "x", audio_urls: ["a"] }, model, {}) ?? "", /requires at least one/);
  assert.equal(validateModelRequest({ model: "variant", prompt: "x", duration: "5" }, model, {}), null);
});

test("keeps allowed-value limits separate from forced overrides", () => {
  const widerDurationModel = {
    ...model,
    falParametersSnapshot: JSON.stringify([
      { name: "prompt", required: true },
      { name: "duration", enum: ["4", "5", "10"] },
    ]),
  };
  assert.equal(validateParameterLimitsAgainstModel({ duration: ["5", "10"] }, widerDurationModel), null);
  assert.match(
    validateModelRequest({ model: "variant", prompt: "x", duration: "4" }, widerDurationModel, {}, {}, { duration: ["5", "10"] }) ?? "",
    /Invalid duration for this variant/,
  );
  assert.equal(
    validateModelRequest({ model: "variant", prompt: "x", duration: "5" }, widerDurationModel, {}, {}, { duration: ["5", "10"] }),
    null,
  );
});

test("rejects a variant limit above the model contract", () => {
  assert.match(
    validateVariantLimits({ maxReferenceImages: 10, maxReferenceVideos: null, maxReferenceAudios: null, maxDurationSec: null }, model) ?? "",
    /limit 10 exceeds this model's limit 9/,
  );
  assert.equal(
    validateVariantLimits({ maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, maxDurationSec: null }, model),
    null,
  );
});

test("does not treat a candidate Schema as a provider contract", () => {
  const candidate = { ...model, schemaMatchStatus: "candidate" };
  const contract = readModelInputContract(candidate);

  assert.deepEqual(contract.fields, []);
  assert.equal(contract.maxReferenceImages, null);
  assert.equal(contract.maxReferenceVideos, null);
  assert.equal(contract.maxReferenceAudios, null);
  assert.equal(
    validateModelRequest(
      { model: "variant", image_urls: Array(10).fill("i") },
      candidate,
      {},
    ),
    null,
  );
});
