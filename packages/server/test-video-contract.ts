import assert from "node:assert/strict";
import test from "node:test";
import { validateVideoContractRequest } from "./src/engine/video/contract";
import { normalizeVideoQuery } from "./src/engine/video/normalize";
import { readModelInputContract, validateModelRequest } from "./src/lib/model-contract";

const contentContract = {
  version: 1 as const,
  required: ["content", "duration"],
  fields: {
    content: {
      type: "array" as const,
      minItems: 1,
      items: {
        type: "object" as const,
        requiredProperties: ["type"],
        properties: {
          type: { type: "string" as const, enum: ["text", "image", "video", "audio"] },
          text: { type: "string" as const },
          url: { type: "string" as const },
        },
      },
    },
    duration: { type: "integer" as const, enum: [5, 10] },
  },
};

test("validates nested content and enums", () => {
  assert.equal(validateVideoContractRequest({
    content: [{ type: "text", text: "make a video" }],
    duration: 5,
  }, contentContract), null);
  assert.match(validateVideoContractRequest({
    content: [{ type: "unknown" }],
    duration: 5,
  }, contentContract) ?? "", /one of/);
  assert.match(validateVideoContractRequest({
    content: [{ type: "text", text: "make a video" }],
    duration: 7,
  }, contentContract) ?? "", /one of/);
});

test("content text satisfies a legacy prompt requirement", () => {
  const model = {
    schemaMatchStatus: "confirmed",
    falParametersSnapshot: JSON.stringify([{ name: "prompt", required: true }]),
    falInputSchemaSnapshot: null,
    videoRequiredParams: null,
    videoOptionalParams: null,
    maxReferenceImages: null,
    maxReferenceVideos: null,
    maxReferenceAudios: null,
    maxDurationSec: null,
  };
  assert.equal(validateModelRequest({
    model: "variant",
    content: [{ type: "text", text: "make a video" }],
  }, model, {}), null);
  assert.equal(validateModelRequest({ model: "variant" }, model, {}), "Missing required model parameter: prompt");
  assert.deepEqual(readModelInputContract(model).videoContract, null);
});

test("completed without a video URL is failed", () => {
  assert.deepEqual(normalizeVideoQuery("completed", undefined), {
    status: "failed",
    error: "missing_video_result",
  });
  assert.deepEqual(normalizeVideoQuery("completed", { url: "https://example.test/video.mp4", duration: 5 }), {
    status: "completed",
    result: { video_url: "https://example.test/video.mp4", duration: 5 },
    error: undefined,
  });
});
