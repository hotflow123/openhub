import assert from "node:assert/strict";

const baseUrl = (process.env.OPENHUB_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const hubKey = process.env.OPENHUB_KEY;
const model = process.env.OPENHUB_MODEL;

assert.ok(hubKey, "OPENHUB_KEY is required");

const headers = { Authorization: `Bearer ${hubKey}` };
const health = await fetch(`${baseUrl}/health`);
assert.equal(health.status, 200);

const modelsResponse = await fetch(`${baseUrl}/v1/models`, { headers });
assert.equal(modelsResponse.status, 200);
const modelsPayload = await modelsResponse.json() as { object?: string; data?: unknown };
assert.equal(modelsPayload.object, "list");
assert.ok(Array.isArray(modelsPayload.data));

if (model) {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "return exactly: openhub-smoke-ok" }],
      max_tokens: 16,
    }),
  });
  assert.equal(response.status, 200, await response.text());
}

console.log(JSON.stringify({
  health: "ok",
  publicModels: modelsPayload.data.length,
  chat: model ? "ok" : "skipped",
}));
