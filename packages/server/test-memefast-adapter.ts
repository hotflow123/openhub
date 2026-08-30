import assert from "node:assert/strict";
import test from "node:test";
import { memefastAdapter } from "./src/engine/adapters/memefast";
import { bootstrapAdapters } from "./src/engine/index";
import { resolveAdapterForModel, validateAdapterCapability } from "./src/engine/adapter";

test("site adapter wins unless a model has a manual adapter override", () => {
  bootstrapAdapters();
  assert.equal(resolveAdapterForModel("openai", "site", "memefast")?.adapterId, "memefast");
  assert.equal(resolveAdapterForModel("openai", "manual", "memefast")?.adapterId, "openai");
  assert.equal(resolveAdapterForModel("openai-compatible", null, "openai")?.adapterId, "openai");
});

test("unknown modality cannot create a callable capability", () => {
  bootstrapAdapters();
  assert.match(
    validateAdapterCapability(resolveAdapterForModel("openai", "site", "openai")!.adapter, "unknown") ?? "",
    /modality is unknown/,
  );
});

test("MemeFast adapter delegates discovery and chat to the canonical /v1 paths", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input).endsWith("/v1/models")) {
      return Response.json({
        data: [{
          id: "demo-chat",
          object: "model",
          model_type: "chat",
          supported_endpoint_types: ["chat.completions"],
          tags: ["text"],
        }],
      });
    }
    return Response.json({
      id: "chat-1",
      object: "chat.completion",
      created: 1,
      model: "demo-chat",
      choices: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  };

  try {
    const ctx = { targetUrl: "https://memefast.example/v1", apiKey: "secret" };
    const models = await memefastAdapter.discoverModels?.(ctx);
    assert.equal(models?.[0]?.id, "demo-chat");
    assert.equal(models?.[0]?.metadata?.model_type, "chat");
    assert.deepEqual(models?.[0]?.metadata?.supported_endpoint_types, ["chat.completions"]);
    await memefastAdapter.forwardChat(
      { model: "demo-chat", messages: [{ role: "user", content: "hello" }] },
      ctx,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls[0]?.url, "https://memefast.example/v1/models");
  assert.equal(calls[1]?.url, "https://memefast.example/v1/chat/completions");
  assert.equal((calls[1]?.init?.headers as Record<string, string>).Authorization, "Bearer secret");
});
