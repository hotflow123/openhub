import assert from "node:assert/strict";
import test from "node:test";
import {
  assertValidProviderAdapter,
  validateProviderAdapter,
  type AdapterContext,
  type AdapterManifest,
  type ProviderAdapter,
} from "@openhub/adapter-sdk";
import { wrapLegacyAdapter, type Adapter, type ForwardContext } from "./src/engine/adapter";

const context: AdapterContext = { targetUrl: "https://provider.test", apiKey: "test-key" };

function manifest(overrides: Partial<AdapterManifest> = {}): AdapterManifest {
  return {
    id: "fixture",
    version: "1.0.0",
    displayName: "Fixture adapter",
    modalities: ["llm"],
    capabilities: ["chat", "chat.stream"],
    modelBindings: [
      {
        match: "exact",
        values: ["fixture-model"],
        evidence: [{ kind: "fixture", ref: "fixture/manifest", verifiedAt: "2026-08-30" }],
      },
    ],
    protocolBindings: ["openai-compatible"],
    configSchema: { type: "object", properties: {} },
    auth: "api_key",
    evidence: [{ kind: "fixture", ref: "fixture/manifest", verifiedAt: "2026-08-30" }],
    ...overrides,
  };
}

function llmHandler() {
  return {
    complete: async () => ({
      id: "response-1",
      object: "chat.completion",
      created: 0,
      model: "fixture-model",
      choices: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }),
    stream: async () => new Response("data: [DONE]\n\n"),
  };
}

function validAdapter(): ProviderAdapter {
  return {
    manifest: manifest(),
    handlers: [{ modality: "llm", handler: llmHandler() }],
    healthCheck: async () => true,
    discoverModels: async () => [{ id: "fixture-model", ownedBy: "fixture" }],
    validateConfig: () => null,
  };
}

test("accepts an adapter whose declared capabilities have implementations", () => {
  const adapter = validAdapter();
  assert.deepEqual(validateProviderAdapter(adapter), { ok: true, status: "ready", issues: [] });
  assert.doesNotThrow(() => assertValidProviderAdapter(adapter));
  assert.equal(context.targetUrl, "https://provider.test");
});

test("rejects a declared stream capability without a stream method", () => {
  const handler = llmHandler();
  delete (handler as Partial<typeof handler>).stream;
  const result = validateProviderAdapter({
    ...validAdapter(),
    handlers: [{ modality: "llm", handler }],
  });
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((issue) => issue.path === "capabilities.chat.stream"));
});

test("rejects unknown modalities and unsupported model binding rules", () => {
  const result = validateProviderAdapter({
    ...validAdapter(),
    manifest: manifest({
      modalities: ["llm", "unknown"] as never,
      modelBindings: [{ match: "regex", values: [".*"], evidence: [] }] as never,
    }),
  });
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((issue) => issue.path === "manifest.modalities[1]"));
  assert.ok(result.issues.some((issue) => issue.path === "manifest.modelBindings[0].match"));
  assert.ok(result.issues.some((issue) => issue.path === "manifest.modelBindings[0].evidence"));
});

test("requires both submit and query for video capabilities", () => {
  const result = validateProviderAdapter({
    ...validAdapter(),
    manifest: manifest({
      modalities: ["video"],
      capabilities: ["video.submit", "video.query"],
      taskStrategy: { queryMode: "per_task" },
    }),
    handlers: [{ modality: "video", handler: { submit: async () => ({ siteTaskId: "task-1", initialStatus: "pending" }) } }],
  });
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((issue) => issue.path === "capabilities.video.query"));
  assert.ok(result.issues.some((issue) => issue.path === "manifest.taskStrategy"));
});

test("marks batch and dynamic task declarations as extension-required in P0", () => {
  const result = validateProviderAdapter({
    ...validAdapter(),
    manifest: manifest({ taskStrategy: { queryMode: "batch" } }),
    handlers: [
      { modality: "llm", handler: llmHandler() },
      { modality: "async-task", handler: { queryMode: "batch", submit: async () => ({ siteTaskId: "task-1", initialStatus: "pending" }) } as never },
    ],
  });
  assert.equal(result.status, "extension_required");
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.path === "manifest.taskStrategy"));
});

test("wraps legacy LLM methods without changing the target context", async () => {
  let received: ForwardContext | undefined;
  const legacy: Adapter = {
    id: "legacy-llm",
    capabilities: ["chat", "chat.stream"],
    forwardChat: async (_input, context) => {
      received = context;
      return {
        id: "response-1",
        object: "chat.completion",
        created: 0,
        model: "fixture-model",
        choices: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    },
    forwardChatStream: async (_input, context) => {
      received = context;
      return new Response("data: [DONE]\n\n");
    },
    healthCheck: async () => true,
  };
  const wrapped = wrapLegacyAdapter(legacy, manifest());
  assert.equal(validateProviderAdapter(wrapped).status, "ready");
  const handler = wrapped.handlers.find((entry) => entry.modality === "llm");
  assert.ok(handler && handler.modality === "llm");
  await handler.handler.complete!({ model: "fixture-model", messages: [] }, context);
  assert.deepEqual(received, context);
});

test("wraps a legacy per-task video adapter with submit and query", async () => {
  const legacy: Adapter = {
    id: "legacy-video",
    capabilities: ["video.submit", "video.query"],
    forwardChat: async () => { throw new Error("not supported"); },
    forwardChatStream: async () => { throw new Error("not supported"); },
    submitVideoTask: async () => ({ siteTaskId: "task-1", initialStatus: "pending" }),
    queryVideoTask: async () => ({
      status: "completed",
      result: { video_url: "https://example.test/video.mp4" },
    }),
    healthCheck: async () => true,
  };
  const videoManifest = manifest({
    id: "legacy-video",
    modalities: ["video"],
    capabilities: ["video.submit", "video.query"],
    taskStrategy: { queryMode: "per_task" },
  });
  const wrapped = wrapLegacyAdapter(legacy, videoManifest);
  assert.equal(validateProviderAdapter(wrapped).status, "ready");
  const handler = wrapped.handlers.find((entry) => entry.modality === "video");
  assert.ok(handler && handler.modality === "video");
  const submitted = await handler.handler.submit({ model: "fixture-model", prompt: "x" }, context);
  const queried = await handler.handler.query(submitted.siteTaskId, context);
  assert.equal(submitted.siteTaskId, "task-1");
  assert.equal(queried.status, "completed");
});
