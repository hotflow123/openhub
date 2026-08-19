/**
 * 简单 OpenAI 兼容 mock server（P1+P2 收尾验证用）
 *
 * 支持：
 *   GET  /v1/models           → 固定的 5 个模型
 *   POST /v1/chat/completions → 返回简单 chat 回包
 *   POST /v1/embeddings       → 返回固定 1536 维向量
 *   POST /v1/images/generations → 返回 mock 图片 URL
 *   POST /v1/audio/speech     → 返回 mock mp3 (empty)
 *   POST /v1/audio/transcriptions → 返回 mock text
 *   GET  /health
 */

import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_LOCAL_PORT ?? 9999);

const MODELS = [
  { id: "gpt-4o-mini", object: "model", created: 1700000000, owned_by: "mock" },
  { id: "gpt-4o", object: "model", created: 1700000001, owned_by: "mock" },
  { id: "text-embedding-3-small", object: "model", created: 1700000002, owned_by: "mock" },
  { id: "dall-e-3", object: "model", created: 1700000003, owned_by: "mock" },
  { id: "tts-1", object: "model", created: 1700000004, owned_by: "mock" },
];

const server = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const auth = req.headers["authorization"] ?? "";
  if (!auth.startsWith("Bearer ")) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: { message: "missing bearer token" } }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/models") {
    res.statusCode = 200;
    res.end(JSON.stringify({ object: "list", data: MODELS }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    collectBody(req).then((raw) => {
      const body = safeJson(raw);
      const model = body?.model ?? "unknown";
      const messages = Array.isArray(body?.messages) ? body.messages : [];
      const lastMsg = messages.at(-1);
      const userContent = lastMsg?.content ?? "";
      const id = `chatcmpl-${Date.now()}`;
      const reply = `Mock reply (model=${model}) for: ${String(userContent).slice(0, 60)}`;
      const resp = {
        id,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: reply },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      };
      res.statusCode = 200;
      res.end(JSON.stringify(resp));
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/embeddings") {
    collectBody(req).then((raw) => {
      const body = safeJson(raw);
      const input = Array.isArray(body?.input) ? body.input : [body?.input ?? ""];
      const data = input.map((t, i) => ({
        object: "embedding",
        index: i,
        embedding: Array.from({ length: 8 }, () => 0.1),
      }));
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          object: "list",
          data,
          model: body?.model ?? "text-embedding-3-small",
          usage: { prompt_tokens: 5, total_tokens: 5 },
        }),
      );
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/images/generations") {
    collectBody(req).then(() => {
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          created: Math.floor(Date.now() / 1000),
          data: [
            { url: "https://mock.openhub.local/img/sample-1.png" },
            { url: "https://mock.openhub.local/img/sample-2.png" },
          ],
        }),
      );
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/audio/speech") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "audio/mpeg");
    res.end(Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00]));
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/audio/transcriptions") {
    res.statusCode = 200;
    res.end(JSON.stringify({ text: "mock transcription" }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    res.statusCode = 200;
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: { message: "mock: not found", path: url.pathname } }));
});

function collectBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

server.listen(PORT, () => {
  console.log(`[mock-local] listening on http://localhost:${PORT}`);
});