import assert from "node:assert/strict";
import test from "node:test";
import { extractInputSchemaCapabilities } from "./src/lib/fal-input-schema";
import {
  validateReferenceLimitsAgainstModel,
  validateReferenceMediaLimits,
} from "./src/lib/reference-media";

test("extracts reference fields and maxItems from a Fal input schema", () => {
  const capabilities = extractInputSchemaCapabilities(JSON.stringify({
    type: "object",
    properties: {
      image_urls: { type: "array", maxItems: 9 },
      video_urls: { type: "array", maxItems: 3 },
      audio_urls: { type: "array", maxItems: 3 },
    },
  }), null);

  assert.deepEqual(capabilities.referenceImageFields, ["image_urls"]);
  assert.deepEqual(capabilities.referenceVideoFields, ["video_urls"]);
  assert.deepEqual(capabilities.referenceAudioFields, ["audio_urls"]);
  assert.equal(capabilities.maxReferenceImages, 9);
  assert.equal(capabilities.maxReferenceVideos, 3);
  assert.equal(capabilities.maxReferenceAudios, 3);
});

test("rejects requests that exceed a variant reference-media limit", () => {
  assert.equal(
    validateReferenceMediaLimits({ image_urls: Array(9).fill("https://example.test/image") }, { maxReferenceImages: 9 }),
    null,
  );
  assert.match(
    validateReferenceMediaLimits({ reference_video_urls: Array(4).fill("https://example.test/video") }, { maxReferenceVideos: 3 }) ?? "",
    /received 4, limit is 3/,
  );
});

test("does not permit a variant limit to exceed its selected model", () => {
  assert.match(
    validateReferenceLimitsAgainstModel({ maxReferenceImages: 10 }, { maxReferenceImages: 9 }) ?? "",
    /limit 10 exceeds this model's limit 9/,
  );
  assert.equal(
    validateReferenceLimitsAgainstModel({ maxReferenceImages: 0 }, { maxReferenceImages: 9 }),
    null,
  );
});
