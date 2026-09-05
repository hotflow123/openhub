import assert from "node:assert/strict";
import test from "node:test";
import { assessPublication } from "./src/engine/publication-policy";

test("unknown modality is never public", () => {
  assert.deepEqual(
    assessPublication({
      siteActive: true,
      modelStatus: "active",
      modality: "unknown",
      adapterCapabilities: ["chat"],
      protocolReady: false,
    }),
    { public: false, reason: "unknown_modality" },
  );
});

test("video needs both adapter and protocol readiness", () => {
  assert.deepEqual(
    assessPublication({
      siteActive: true,
      modelStatus: "active",
      modality: "video",
      adapterCapabilities: ["video.submit", "video.query"],
      protocolReady: false,
    }),
    { public: false, reason: "video_protocol_missing" },
  );
});

test("standard LLM is public when the standard adapter exists", () => {
  assert.deepEqual(
    assessPublication({
      siteActive: true,
      modelStatus: "active",
      modality: "llm",
      adapterCapabilities: ["chat"],
      protocolReady: false,
    }),
    { public: true, reason: "ready" },
  );
});
