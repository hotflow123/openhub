import assert from "node:assert/strict";
import test from "node:test";
import { mapStoredVariantParams } from "./src/engine/param-mapper";
import { openaiAdapter } from "./src/engine/adapters/openai";

test("keeps Fal media fields when a variant maps them to provider names", () => {
  const result = mapStoredVariantParams(
    {
      model: "public-seedance",
      prompt: "a red kite",
      image_urls: ["https://example.test/image.png"],
      provider_only: "discard-me",
    },
    {
      fieldMapping: JSON.stringify({ image_urls: "reference_images" }),
    },
    ["model", "prompt", "image_urls"],
  );

  assert.deepEqual(result.body, {
    model: "public-seedance",
    prompt: "a red kite",
    reference_images: ["https://example.test/image.png"],
  });
  assert.deepEqual(result.dropped, ["provider_only"]);
});

test("applies blocked fields before forced overrides", () => {
  const result = mapStoredVariantParams(
    { model: "variant", duration: "5", seed: 1 },
    {
      paramBlocked: JSON.stringify(["seed"]),
      paramOverrides: JSON.stringify({ duration: "10" }),
    },
    ["model", "duration", "seed"],
  );

  assert.deepEqual(result.body, { model: "variant", duration: "10" });
  assert.deepEqual(result.dropped, []);
});

test("OpenAI adapter preserves mapped JSON fields for image, audio, and embedding", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push({ url, body });
    if (url.endsWith("/v1/audio/speech")) return new Response(new Uint8Array([1]));
    if (url.endsWith("/v1/images/generations")) return Response.json({ created: 1, data: [] });
    return Response.json({ object: "list", data: [], model: body.model, usage: {} });
  };

  try {
    await openaiAdapter.forwardImageGeneration(
      { model: "image", prompt: "x", render_quality: "hd" } as any,
      { targetUrl: "http://mock", apiKey: "key" },
    );
    await openaiAdapter.forwardAudioSpeech(
      { model: "audio", input: "x", speaker: "alloy" } as any,
      { targetUrl: "http://mock", apiKey: "key" },
    );
    await openaiAdapter.forwardEmbedding(
      { model: "embed", texts: ["x"] } as any,
      { targetUrl: "http://mock", apiKey: "key" },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests[0].body.render_quality, "hd");
  assert.equal(requests[1].body.speaker, "alloy");
  assert.deepEqual(requests[2].body.texts, ["x"]);
});
