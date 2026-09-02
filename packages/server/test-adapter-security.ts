import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeForLog } from "./src/lib/log";
import { safeFetch, validateUrl, validateUrlSync } from "./src/lib/ssrf";

test("rejects private, loopback, and non-HTTPS callback addresses", async () => {
  assert.throws(() => validateUrlSync("http://127.0.0.1:3000"), /private IP/);
  assert.throws(() => validateUrlSync("http://10.0.0.1"), /private IP/);
  assert.throws(() => validateUrlSync("http://[::1]"), /private IP/);
  assert.throws(() => validateUrlSync("http://localhost:3000", { requireHttps: true }), /https/);
  await assert.rejects(validateUrl("http://example.com/callback", { requireHttps: true }), /https/);
});

test("safeFetch forces no redirects and preserves caller cancellation", async () => {
  const originalFetch = globalThis.fetch;
  let requestInit: RequestInit | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestInit = init;
    return Response.json({ ok: true });
  }) as typeof fetch;
  try {
    const response = await safeFetch("https://provider.example/models", { timeoutMs: 100 });
    assert.equal(response.status, 200);
    assert.equal(requestInit?.redirect, "error");
    assert.ok(requestInit?.signal);

    const controller = new AbortController();
    const pendingFetch = new Promise<Response>((_, reject) => {
      requestInit = undefined;
      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestInit = init;
        await new Promise<void>((resolve) => init?.signal?.addEventListener("abort", () => resolve(), { once: true }));
        reject(new Error("aborted"));
        return new Response();
      }) as typeof fetch;
    });
    const request = safeFetch("https://provider.example/models", { timeoutMs: 1_000, signal: controller.signal });
    controller.abort();
    await assert.rejects(Promise.race([request, pendingFetch]), /aborted|AbortError/);
    assert.ok(requestInit?.signal?.aborted);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sanitizes credentials, prompts, and media URLs recursively", () => {
  const sanitized = sanitizeForLog({
    apiKey: "sk-openhub-1234567890abcdef",
    authorization: "Bearer secret-token",
    prompt: "a private prompt",
    result: { video_url: "https://cdn.example/video.mp4?token=secret" },
    message: "Bearer another-token https://cdn.example/image.png",
  }) as Record<string, unknown>;
  assert.equal(sanitized.apiKey, "[REDACTED]");
  assert.equal(sanitized.authorization, "[REDACTED]");
  assert.equal(sanitized.prompt, "[REDACTED]");
  assert.deepEqual(sanitized.result, { video_url: "[REDACTED]" });
  assert.equal(sanitized.message, "Bearer [REDACTED] [REDACTED_MEDIA_URL]");
});
