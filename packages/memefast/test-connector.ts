import assert from "node:assert/strict";
import test from "node:test";
import { createMemeFastConnector, MemeFastError, normalizeBaseUrl } from "./src/index.js";

test("normalizes a base URL without duplicating /v1", () => {
  assert.equal(normalizeBaseUrl("https://example.test"), "https://example.test/v1");
  assert.equal(normalizeBaseUrl("https://example.test/api/v1/"), "https://example.test/api/v1");
});

test("discovers models and uses exact upstream model ids", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    if (String(input).endsWith("/v1/models")) return Response.json({ data: [{ id: "vendor/model-a", object: "model" }] });
    return Response.json({ choices: [{ message: { role: "assistant", content: "ok" } }] });
  };
  try {
    const connector = createMemeFastConnector({ baseUrl: "https://example.test/", apiKey: "secret" });
    assert.deepEqual(await connector.discover(), [{ id: "vendor/model-a", object: "model", raw: { id: "vendor/model-a", object: "model" } }]);
    await connector.chat({ model: "vendor/model-a", messages: [{ role: "user", content: "hello" }] });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(requests[1]?.url, "https://example.test/v1/chat/completions");
  assert.equal((requests[1]?.init?.headers as Record<string, string>).Authorization, "Bearer secret");
  assert.equal(JSON.parse(String(requests[1]?.init?.body)).model, "vendor/model-a");
});

test("uses catalog suggestions but rejects unknown top-level parameters", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/v1/models")) return Response.json({ data: [
      { id: "flux-pro", object: "model" },
      { id: "strict-image", object: "model", parameters: [{ name: "size", enum: ["1024x1024"] }] },
    ] });
    return Response.json({ data: [] });
  };
  try {
    const connector = createMemeFastConnector({
      baseUrl: "https://example.test/v1",
      apiKey: "secret",
      catalog: [{ id: "fal/flux-pro", aliases: ["flux-pro"], modality: "image", contract: { enums: { size: ["1024x1024"] } } }],
    });
    const profile = await connector.profile("flux-pro");
    assert.equal(profile.catalogId, "fal/flux-pro");
    assert.equal(profile.readiness, "needs_review");
    assert.deepEqual(profile.contract.fields, []);
    assert.deepEqual(profile.suggestedContract?.enums.size, ["1024x1024"]);
    await assert.rejects(
      () => connector.imageGeneration({ model: "flux-pro", prompt: "x", made_up: true }),
      (error: unknown) => error instanceof MemeFastError && error.info.code === "unknown_parameter",
    );
    const candidateValue = await connector.imageGeneration({ model: "flux-pro", prompt: "x", size: "bad" });
    assert.deepEqual(candidateValue.data, []);
    await assert.rejects(
      () => connector.imageGeneration({ model: "strict-image", prompt: "x", size: "other" }),
      (error: unknown) => error instanceof MemeFastError && error.info.code === "invalid_parameter",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("supports stream, binary speech, and multipart transcription", async () => {
  const originalFetch = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(init ?? {});
    const url = String(input);
    if (url.endsWith("/v1/models")) return Response.json({ data: [{ id: "chat" }] });
    if (url.endsWith("/v1/audio/speech")) return new Response(new Uint8Array([1, 2]));
    return Response.json({ text: "done" });
  };
  try {
    const connector = createMemeFastConnector({ baseUrl: "https://example.test", apiKey: "secret" });
    const stream = await connector.chatStream({ model: "chat", messages: [] });
    assert.equal(stream.status, 200);
    assert.deepEqual(new Uint8Array(await connector.audioSpeech({ model: "chat", input: "hi", voice: "alloy" })), new Uint8Array([1, 2]));
    assert.equal((await connector.audioTranscription({ model: "chat", file: new Blob(["a"]) })).text, "done");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls[1]?.body && typeof calls[1].body === "string", true);
  assert.equal(calls[3]?.body instanceof FormData, true);
});
