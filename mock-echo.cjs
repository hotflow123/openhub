// Minimal OpenAI-compatible mock for local end-to-end tests.
//
// Endpoints:
//   GET  /v1/models             -> { data: [ { id, object, created, owned_by } ] }
//   POST /v1/chat/completions   -> echoes a deterministic reply
//   POST /v1/embeddings         -> returns a tiny fixed vector
//   POST /v1/images/generations -> returns a fake image URL
//   POST /v1/audio/speech       -> returns 1 byte of "audio"
//
// Usage:  node mock-echo.cjs [port]
const http = require("node:http");

const PORT = Number(process.argv[2] || process.env.PORT || 9999);

// 异步视频任务状态（进程内）
const state = {
  videoTasks: new Map(),
};

const MODELS = [
  { id: "gpt-4o-mini", object: "model", created: 1700000000, owned_by: "mock" },
  { id: "gpt-4o", object: "model", created: 1700000001, owned_by: "mock" },
  { id: "text-embedding-3-small", object: "model", created: 1700000002, owned_by: "mock" },
  { id: "dall-e-3", object: "model", created: 1700000003, owned_by: "mock" },
  { id: "tts-1", object: "model", created: 1700000004, owned_by: "mock" },
  { id: "sora-mock", object: "model", created: 1700000005, owned_by: "mock" },
];

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/plain" : "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  console.log(`[mock] ${req.method} ${url.pathname} from ${req.socket.remoteAddress}`);

  if (req.method === "GET" && url.pathname === "/v1/models") {
    return send(res, 200, { object: "list", data: MODELS });
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    const body = await readJson(req).catch(() => ({}));
    console.log(`[mock] chat body=${JSON.stringify(body)}`);
    const reply = `mock-reply(${body?.model ?? "?"}):${(body?.messages?.[0]?.content ?? "").slice(0, 32)}`;
    return send(res, 200, {
      id: "chatcmpl-mock-" + Date.now(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: body?.model ?? "unknown",
      choices: [
        { index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  }

  if (req.method === "POST" && url.pathname === "/v1/embeddings") {
    const body = await readJson(req).catch(() => ({}));
    const input = Array.isArray(body?.input) ? body.input : [body?.input ?? ""];
    return send(res, 200, {
      object: "list",
      model: body?.model ?? "unknown",
      data: input.map((t, i) => ({
        object: "embedding",
        index: i,
        embedding: [0.1, 0.2, 0.3, Number(t.length) || 0],
      })),
      usage: { prompt_tokens: 1, total_tokens: 1 },
    });
  }

  if (req.method === "POST" && url.pathname === "/v1/images/generations") {
    const body = await readJson(req).catch(() => ({}));
    return send(res, 200, {
      created: Math.floor(Date.now() / 1000),
      data: [{ url: `https://example.com/mock-${body?.prompt?.slice(0, 8) || "img"}.png` }],
    });
  }

  if (req.method === "POST" && url.pathname === "/v1/audio/speech") {
    const body = await readJson(req).catch(() => ({}));
    const buf = Buffer.from(`mock-audio(${body?.model ?? "?"})`);
    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Content-Length": buf.length,
    });
    return res.end(buf);
  }

  // 异步视频：POST /v1/videos 提交，返回 task_id；后续 GET /v1/videos/:id 查状态
  if (req.method === "POST" && url.pathname === "/v1/videos") {
    const body = await readJson(req).catch(() => ({}));
    const taskId = `mv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    state.videoTasks.set(taskId, {
      id: taskId,
      status: "queued",
      prompt: body?.prompt ?? "",
      model: body?.model ?? "unknown",
      submittedAt: Date.now(),
    });
    return send(res, 200, {
      id: taskId,
      status: "queued",
      model: body?.model ?? "unknown",
    });
  }

  const videoMatch = url.pathname.match(/^\/v1\/videos\/([^/]+)$/);
  if (req.method === "GET" && videoMatch) {
    const taskId = videoMatch[1];
    const t = state.videoTasks.get(taskId);
    if (!t) return send(res, 404, { error: "video task not found" });
    // 2s 之后从 queued → processing → completed
    const age = Date.now() - t.submittedAt;
    if (age < 1000) t.status = "queued";
    else if (age < 2000) t.status = "in_progress";
    else {
      t.status = "completed";
      t.result = {
        video_url: `https://example.com/mock-video/${taskId}.mp4`,
        duration: 5,
        width: 1280,
        height: 720,
      };
    }
    return send(res, 200, {
      id: t.id,
      status: t.status,
      result: t.result ?? null,
    });
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { status: "ok" });
  }

  return send(res, 404, { error: { message: "mock endpoint not found", path: url.pathname } });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`mock-echo listening on http://0.0.0.0:${PORT}`);
});
