import assert from "node:assert/strict";
import test from "node:test";
import { grokAdapter } from "./src/engine/adapters/grok";
import { klingAdapter } from "./src/engine/adapters/kling";
import { openaiAdapter } from "./src/engine/adapters/openai";
import { seedanceAdapter } from "./src/engine/adapters/seedance";
import { wanAdapter } from "./src/engine/adapters/wan";
import type { ForwardContext } from "./src/engine/adapter";

const ctx: ForwardContext = { targetUrl: "https://provider.test", apiKey: "test-key" };
const request = { model: "video-model", prompt: "make a video", duration: 5 };

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function withFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("OpenAI-style video adapter submits and queries", async () => {
  await withFetch(async (url) => url.endsWith("/v1/videos")
    ? jsonResponse({ id: "oa-1", status: "queued" })
    : jsonResponse({ id: "oa-1", status: "succeeded", result: { url: "https://example.test/oa.mp4" } }), async () => {
    const config = { ...ctx, config: { video: { endpoint: "videos" } } };
    const submitted = await openaiAdapter.submitVideoTask!(request, config);
    const queried = await openaiAdapter.queryVideoTask!(submitted.siteTaskId, config);
    assert.equal(submitted.siteTaskId, "oa-1");
    assert.equal(queried.status, "completed");
    assert.equal((queried.result as Record<string, unknown>)?.url, "https://example.test/oa.mp4");
  });
});

test("Kling, Wan, Seedance and Grok map representative terminal responses", async () => {
  await withFetch(async (url, init) => {
    if (url.includes("kling.test")) return jsonResponse(init?.method === "POST" ? { id: "k-1", status: "queued" } : { status: "succeeded", result: { video_url: "https://example.test/kling.mp4" } });
    if (url.includes("dashscope.test")) return jsonResponse(init?.method === "POST"
      ? { output: { task_id: "w-1", task_status: "PENDING" } }
      : { output: { task_status: "SUCCEEDED", video_url: "https://example.test/wan.mp4" } });
    if (url.includes("volces.test")) return jsonResponse(init?.method === "POST"
      ? { id: "s-1", status: "queued" }
      : { id: "s-1", status: "succeeded", content: [{ type: "video_url", url: "https://example.test/seedance.mp4" }] });
    return jsonResponse(init?.method === "POST"
      ? { request_id: "g-1", status: "pending" }
      : { request_id: "g-1", status: "done", video: { url: "https://example.test/grok.mp4" } });
  }, async () => {
    const klingContext = { ...ctx, targetUrl: "https://kling.test", config: { video: { mode: "newapi", endpoint: "videos" } } };
    const kling = await klingAdapter.submitVideoTask!(request, klingContext);
    assert.equal(kling.initialStatus, "pending");

    const wanContext = { ...ctx, config: { video: { mode: "direct", vendor: { baseUrl: "https://dashscope.test", submitPath: "/video-synthesis", queryPath: "/tasks/{id}" } } } };
    const wan = await wanAdapter.submitVideoTask!(request, wanContext);
    const wanResult = await wanAdapter.queryVideoTask!(wan.siteTaskId, wanContext);
    assert.equal(wanResult.status, "completed");
    assert.equal(wanResult.result?.video_url, "https://example.test/wan.mp4");

    const seedanceContext = { ...ctx, config: { video: { mode: "direct", vendor: { baseUrl: "https://volces.test", submitPath: "/tasks", queryPath: "/tasks/{id}" } } } };
    const seedance = await seedanceAdapter.submitVideoTask!(request, seedanceContext);
    const seedanceResult = await seedanceAdapter.queryVideoTask!(seedance.siteTaskId, seedanceContext);
    assert.equal(seedanceResult.status, "completed");
    assert.equal(seedanceResult.result?.video_url, "https://example.test/seedance.mp4");

    const grokContext = { ...ctx, config: { video: { mode: "direct", vendor: { baseUrl: "https://api.x.ai", submitPath: "/v1/videos/generations", queryPath: "/v1/videos/{id}" } } } };
    const grok = await grokAdapter.submitVideoTask!(request, grokContext);
    const grokResult = await grokAdapter.queryVideoTask!(grok.siteTaskId, grokContext);
    assert.equal(grokResult.status, "completed");
    assert.equal(grokResult.result?.video_url, "https://example.test/grok.mp4");
  });
});
