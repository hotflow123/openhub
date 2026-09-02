import assert from "node:assert/strict";
import test from "node:test";
import { OpenHubClient, OpenHubError } from "../src/index";

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    await handler(String(input), init)) as typeof fetch;
}

test("sends the OpenHub key and supports JSON, binary, and multipart calls", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new OpenHubClient({
    baseUrl: "https://hub.example/",
    apiKey: "hub-key",
    fetch: mockFetch(async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/v1/audio/speech")) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      if (url.endsWith("/v1/audio/transcriptions")) return Response.json({ text: "ok" });
      return Response.json({ id: "chat-1", choices: [] });
    }),
  });

  await client.chat({ model: "chat", messages: [] });
  await client.synthesizeSpeech({ model: "tts", input: "hello", voice: "alloy" });
  await client.transcribeAudio({ model: "stt", file: new Blob(["audio"]) });

  assert.equal(calls[0].url, "https://hub.example/v1/chat/completions");
  assert.equal(new Headers(calls[0].init?.headers).get("Authorization"), "Bearer hub-key");
  assert.equal(calls[1].init?.headers && new Headers(calls[1].init?.headers).get("Content-Type"), "application/json");
  assert.equal(calls[2].init?.body instanceof FormData, true);
});

test("polls a video task until it reaches a terminal state", async () => {
  let count = 0;
  const client = new OpenHubClient({
    baseUrl: "https://hub.example",
    apiKey: "hub-key",
    fetch: mockFetch(() => {
      count++;
      return Response.json({ id: "task-1", status: count === 1 ? "processing" : "completed", result: { video_url: "https://cdn.example/video.mp4" } });
    }),
  });

  const result = await client.waitForVideoTask("task-1", { intervalMs: 0, timeoutMs: 100 });
  assert.equal(result.status, "completed");
  assert.equal(count, 2);
});

test("returns structured upstream errors and client polling timeouts", async () => {
  const failing = new OpenHubClient({
    baseUrl: "https://hub.example",
    apiKey: "hub-key",
    fetch: mockFetch(() => Response.json({ error: { message: "unknown model", code: "variant_not_found" } }, { status: 404 })),
  });
  await assert.rejects(
    failing.chat({ model: "missing", messages: [] }),
    (error: unknown) => error instanceof OpenHubError && error.status === 404 && error.code === "variant_not_found",
  );

  const polling = new OpenHubClient({
    baseUrl: "https://hub.example",
    apiKey: "hub-key",
    fetch: mockFetch(() => Response.json({ id: "task-1", status: "processing" })),
  });
  await assert.rejects(
    polling.waitForVideoTask("task-1", { intervalMs: 2, timeoutMs: 1 }),
    (error: unknown) => error instanceof OpenHubError && error.code === "client_timeout",
  );
});
