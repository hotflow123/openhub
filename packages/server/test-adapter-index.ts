import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapAdapters } from "./src/engine/index";
import { buildAdapterIndex, validateAdapterIndex } from "./src/engine/adapter-index";

test("builds a deterministic index with a SHA256 for every built-in source", async () => {
  bootstrapAdapters();
  const index = await buildAdapterIndex();
  assert.equal(index.formatVersion, 1);
  assert.equal(index.adapters.length, 6);
  assert.ok(index.adapters.every((entry) => /^[a-f0-9]{64}$/.test(entry.artifactSha256 ?? "")));
  assert.equal(validateAdapterIndex(index, index).ok, true);
});

test("detects same-version source drift and duplicate adapter IDs", async () => {
  bootstrapAdapters();
  const index = await buildAdapterIndex();
  const changed = {
    ...index,
    adapters: index.adapters.map((entry, index) => index === 0
      ? { ...entry, artifactSha256: "0".repeat(64) }
      : entry),
  };
  const drift = validateAdapterIndex(changed, index);
  assert.equal(drift.ok, false);
  assert.ok(drift.issues.some((issue) => issue.includes("differs")));

  const duplicate = {
    ...index,
    adapters: [...index.adapters, index.adapters[0]],
  };
  const duplicateResult = validateAdapterIndex(duplicate);
  assert.equal(duplicateResult.ok, false);
  assert.ok(duplicateResult.issues.some((issue) => issue.includes("duplicate")));
});
