import assert from "node:assert/strict";
import test from "node:test";
import { classifyProbeFailure, isProbeForCurrentConfig } from "./src/engine/capability/status";
import { summarizeProbe } from "./src/engine/capability/probes";

test("classifies provider failures without changing model identity", () => {
  assert.equal(classifyProbeFailure(429, "rate limit"), "temporary_failure");
  assert.equal(classifyProbeFailure(503, "overloaded"), "temporary_failure");
  assert.equal(classifyProbeFailure(401, "invalid key"), "forbidden");
  assert.equal(classifyProbeFailure(404, "model not found"), "unsupported");
  assert.equal(classifyProbeFailure(400, "invalid max_tokens"), "request_invalid");
});

test("ignores probes from another site configuration revision", () => {
  assert.equal(isProbeForCurrentConfig(3, 3), true);
  assert.equal(isProbeForCurrentConfig(2, 3), false);
  assert.equal(isProbeForCurrentConfig(null, 3), false);
  assert.equal(isProbeForCurrentConfig(3, null), false);
});

test("separates site health, model listing, and capability probing", () => {
  assert.deepEqual(summarizeProbe({ mode: "safe", status: "unknown", message: "listed_by_provider_not_callable" }), {
    siteHealth: "healthy",
    modelListed: "listed",
    capabilityProbe: "not_run",
  });
  assert.deepEqual(summarizeProbe({ mode: "full", status: "available", message: "chat_probe_succeeded" }), {
    siteHealth: "unknown",
    modelListed: "unknown",
    capabilityProbe: "available",
  });
});
