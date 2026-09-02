import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapAdapters } from "./src/engine/index";
import {
  listProviderAdapterRegistrations,
  registerProviderAdapter,
} from "./src/engine/adapter-manifest";

test("registers every built-in adapter with a ready diagnostic", () => {
  bootstrapAdapters();
  const registrations = listProviderAdapterRegistrations();
  assert.deepEqual(
    registrations.map((registration) => registration.manifest.id).sort(),
    ["grok", "kling", "memefast", "openai", "seedance", "wan"],
  );
  assert.ok(registrations.every((registration) => registration.status === "ready"));
  assert.ok(registrations.every((registration) => registration.issues.length === 0));
});

test("quarantines a duplicate canonical adapter ID instead of replacing the executable one", () => {
  bootstrapAdapters();
  const first = listProviderAdapterRegistrations().find((registration) => registration.manifest.id === "memefast");
  assert.ok(first);
  const duplicate = registerProviderAdapter(first.adapter, { sourcePath: "test/duplicate.ts" });
  assert.equal(duplicate.status, "quarantined");
  assert.ok(duplicate.issues.some((issue) => issue.path === "manifest.id"));
  const diagnostics = listProviderAdapterRegistrations().filter((registration) => registration.manifest.id === "memefast");
  assert.equal(diagnostics.length, 2);
  assert.equal(diagnostics[0].status, "ready");
  assert.equal(diagnostics[1].status, "quarantined");
});

test("does not expose adapter context or credentials in diagnostics", () => {
  bootstrapAdapters();
  const payload = listProviderAdapterRegistrations().map((registration) => JSON.stringify(registration));
  assert.ok(payload.every((entry) => !entry.includes("apiKey")));
  assert.ok(payload.every((entry) => !entry.includes("targetUrl")));
});
