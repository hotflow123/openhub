/**
 * Mock New API / DashScope 视频服务器（本地辅助工具）
 *
 * 目的：在没有真实 New API 站点的环境下，验证 OpenHub 适配器协议实现是否正确。
 * 支持两种协议：
 *
 *   A) New API（OpenAI 兼容风格）：
 *      POST /v1/videos/submit    → { id, status: "processing" }
 *      GET  /v1/videos/{id}      → 头 N-1 次 processing，第 N 次 completed
 *
 *   B) DashScope 官方风格（wan / kling / 任意 "direct" 模式）：
 *      POST /api/v1/services/aigc/video-generation/video-synthesis  (form)
 *        回包：{ output: { task_id, task_status: "PENDING" }, code: "200", request_id }
 *      GET  /api/v1/tasks/{id}
 *        第 N 次回：{ output: { task_id, task_status: "SUCCEEDED", video_url }, code: "200" }
 *
 * 行为可配置：
 *   - MOCK_NEWAPI_PORT              端口（默认 4101）
 *   - MOCK_NEWAPI_COMPLETE_AFTER    几次查询后变 completed（默认 2）
 *   - MOCK_NEWAPI_FAIL              "1" 时返回失败
 *   - MOCK_NEWAPI_RESULT_URL        completed 时返回的 video_url
 */

import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_NEWAPI_PORT ?? 4101);
const COMPLETE_AFTER = Number(process.env.MOCK_NEWAPI_COMPLETE_AFTER ?? 2);
const FAIL_MODE = process.env.MOCK_NEWAPI_FAIL === "1";
const RESULT_URL =
  process.env.MOCK_NEWAPI_RESULT_URL ?? "https://mock.openhub.local/videos/sample.mp4";

interface MockTask {
  submitAt: number;
  pollCount: number;
  prompt: string;
  mode: string;
  status: string;
}

const tasks = new Map<string, MockTask>();
let submitCounter = 0;

const server = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  // 验证 Bearer token（简单的非空校验）
  const auth = req.headers["authorization"] ?? "";
  if (!auth.startsWith("Bearer ")) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: { message: "missing bearer token", type: "auth_error" } }));
    return;
  }

  // ───────── A) New API 风格：POST /v1/videos/submit  OR  POST /v1/videos ─────────
  // wan / openai 适配器在 newapi 模式下都用 POST /v1/{endpoint}（无 /submit 后缀）
  // kling 用 POST /v1/{endpoint}/submit（带后缀）。两者都支持以便测试。
  const newapiSubmitMatch =
    url.pathname.match(/^\/v1\/([^/]+)\/submit$/) ??
    url.pathname.match(/^\/v1\/([^/]+)$/);
  if (req.method === "POST" && newapiSubmitMatch && url.pathname !== "/v1/models") {
    submitCounter++;
    const id = `mock_${Date.now().toString(36)}_${submitCounter.toString(36)}`;
    const body = collectBody(req);
    body.then((raw) => {
      try {
        const payload = JSON.parse(raw || "{}");
        tasks.set(id, {
          submitAt: Date.now(),
          pollCount: 0,
          prompt: payload.prompt ?? "",
          mode: payload.mode ?? "newapi",
          status: "processing",
        });
        res.statusCode = 200;
        res.end(JSON.stringify({ id, status: "processing" }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: "invalid json" } }));
      }
    });
    return;
  }

  // ───────── A) New API 风格：GET /v1/videos/{id} ─────────
  // 回包格式根据 task.mode 自适应：
  //   - newapi 风格：{ id, status, result?: { video_url, ... } }
  //   - xAI grok 风格：{ request_id, status, video?: { url } }
  const newapiMatch = url.pathname.match(/^\/v1\/videos\/([^/]+)$/);
  if (req.method === "GET" && newapiMatch) {
    const id = newapiMatch[1];
    const task = tasks.get(id);
    if (!task) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "task not found" } }));
      return;
    }
    task.pollCount++;
    const isXai = task.mode === "xai-direct";
    if (FAIL_MODE) {
      if (isXai) {
        res.end(JSON.stringify({ request_id: id, status: "failed" }));
      } else {
        res.end(JSON.stringify({ id, status: "failed", error: "mock failure" }));
      }
      return;
    }
    if (task.pollCount >= COMPLETE_AFTER) {
      task.status = isXai ? "done" : "completed";
      if (isXai) {
        res.end(
          JSON.stringify({
            request_id: id,
            status: "done",
            video: { url: RESULT_URL },
          }),
        );
      } else {
        res.end(
          JSON.stringify({
            id,
            status: "completed",
            result: {
              video_url: RESULT_URL,
              duration: 5,
              width: 1280,
              height: 720,
            },
          }),
        );
      }
    } else {
      if (isXai) {
        res.end(JSON.stringify({ request_id: id, status: "processing" }));
      } else {
        res.end(JSON.stringify({ id, status: "processing" }));
      }
    }
    return;
  }

  // ───────── B) DashScope 官方风格：POST /api/v1/services/aigc/video-generation/video-synthesis ─────────
  if (
    req.method === "POST" &&
    url.pathname === "/api/v1/services/aigc/video-generation/video-synthesis"
  ) {
    submitCounter++;
    const id = `mock_${Date.now().toString(36)}_${submitCounter.toString(36)}`;
    const body = collectBody(req);
    body.then((raw) => {
      try {
        const params = new URLSearchParams(raw);
        const prompt = params.get("input.prompt") ?? "";
        tasks.set(id, {
          submitAt: Date.now(),
          pollCount: 0,
          prompt,
          mode: "direct",
          status: "PENDING",
        });
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            output: { task_id: id, task_status: "PENDING" },
            request_id: `req_${id}`,
            code: "200",
            message: "Success",
          }),
        );
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: "invalid form" } }));
      }
    });
    return;
  }

  // ───────── B) DashScope 官方风格：GET /api/v1/tasks/{id} ─────────
  const dashMatch = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)$/);
  if (req.method === "GET" && dashMatch) {
    const id = dashMatch[1];
    const task = tasks.get(id);
    if (!task) {
      res.statusCode = 404;
      res.end(
        JSON.stringify({
          output: { task_id: id, task_status: "FAILED" },
          code: "InvalidParameter",
          message: "task not found",
        }),
      );
      return;
    }
    task.pollCount++;
    if (FAIL_MODE) {
      res.end(
        JSON.stringify({
          output: { task_id: id, task_status: "FAILED" },
          code: "Failed",
          message: "mock failure",
        }),
      );
      return;
    }
    if (task.pollCount >= COMPLETE_AFTER) {
      res.end(
        JSON.stringify({
          output: {
            task_id: id,
            task_status: "SUCCEEDED",
            video_url: RESULT_URL,
          },
          request_id: `req_${id}`,
          code: "200",
          message: "Success",
        }),
      );
    } else {
      res.end(
        JSON.stringify({
          output: { task_id: id, task_status: "RUNNING" },
          request_id: `req_${id}`,
          code: "200",
          message: "Success",
        }),
      );
    }
    return;
  }

  // GET /v1/models 健康检查
  if (req.method === "GET" && url.pathname === "/v1/models") {
    res.statusCode = 200;
    res.end(JSON.stringify({ object: "list", data: [] }));
    return;
  }

  // ───────── C) New API 视频端点：POST /v1/video/generations ─────────
  // 字节 seedance / 其它 New API 站点走这个路径
  if (req.method === "POST" && url.pathname === "/v1/video/generations") {
    submitCounter++;
    const id = `mock_${Date.now().toString(36)}_${submitCounter.toString(36)}`;
    const body = collectBody(req);
    body.then((raw) => {
      try {
        const payload = JSON.parse(raw || "{}");
        tasks.set(id, {
          submitAt: Date.now(),
          pollCount: 0,
          prompt: payload.prompt ?? "",
          mode: "newapi-video",
          status: "queued",
        });
        res.statusCode = 200;
        res.end(JSON.stringify({ id, status: "queued" }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: "invalid json" } }));
      }
    });
    return;
  }

  // ───────── C) New API 视频端点：GET /v1/video/tasks/{id} ─────────
  const newapiVideoTaskMatch = url.pathname.match(/^\/v1\/video\/tasks\/([^/]+)$/);
  if (req.method === "GET" && newapiVideoTaskMatch) {
    const id = newapiVideoTaskMatch[1];
    const task = tasks.get(id);
    if (!task) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "task not found" } }));
      return;
    }
    task.pollCount++;
    if (FAIL_MODE) {
      res.end(JSON.stringify({ id, status: "failed", error: "mock failure" }));
      return;
    }
    if (task.pollCount >= COMPLETE_AFTER) {
      res.end(
        JSON.stringify({
          id,
          status: "succeeded",
          url: RESULT_URL,
          duration: 5,
          width: 1280,
          height: 720,
        }),
      );
    } else {
      res.end(JSON.stringify({ id, status: "running" }));
    }
    return;
  }

  // ───────── D) Volcengine Ark（字节方舟）风格 ─────────
  // direct 模式 seedance / 类似服务走这个
  // POST /api/v3/contents/generations/tasks → { id, status }
  // GET  /api/v3/contents/generations/tasks/{id} → { id, status, content:[{url}] }
  if (
    req.method === "POST" &&
    url.pathname === "/api/v3/contents/generations/tasks"
  ) {
    submitCounter++;
    const id = `mock_${Date.now().toString(36)}_${submitCounter.toString(36)}`;
    const body = collectBody(req);
    body.then((raw) => {
      try {
        const payload = JSON.parse(raw || "{}");
        tasks.set(id, {
          submitAt: Date.now(),
          pollCount: 0,
          prompt: typeof payload.prompt === "string" ? payload.prompt : "",
          mode: "ark-direct",
          status: "queued",
        });
        res.statusCode = 200;
        res.end(JSON.stringify({ id, status: "queued" }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: "invalid json" } }));
      }
    });
    return;
  }

  const arkTaskMatch = url.pathname.match(/^\/api\/v3\/contents\/generations\/tasks\/([^/]+)$/);
  if (req.method === "GET" && arkTaskMatch) {
    const id = arkTaskMatch[1];
    const task = tasks.get(id);
    if (!task) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "task not found" } }));
      return;
    }
    task.pollCount++;
    if (FAIL_MODE) {
      res.end(JSON.stringify({ id, status: "failed", error: { message: "mock failure" } }));
      return;
    }
    if (task.pollCount >= COMPLETE_AFTER) {
      res.end(
        JSON.stringify({
          id,
          status: "succeeded",
          content: [{ type: "video", url: RESULT_URL }],
          duration: 5,
          width: 1280,
          height: 720,
        }),
      );
    } else {
      res.end(JSON.stringify({ id, status: "running" }));
    }
    return;
  }

  // ───────── E) xAI Grok Imagine 协议 ─────────
  // POST /v1/videos/generations → { request_id }
  // GET  /v1/videos/{request_id} → { request_id, status, video?: { url } }
  if (req.method === "POST" && url.pathname === "/v1/videos/generations") {
    submitCounter++;
    const id = `mock_${Date.now().toString(36)}_${submitCounter.toString(36)}`;
    const body = collectBody(req);
    body.then((raw) => {
      try {
        const payload = JSON.parse(raw || "{}");
        tasks.set(id, {
          submitAt: Date.now(),
          pollCount: 0,
          prompt: payload.prompt ?? "",
          mode: "xai-direct",
          status: "pending",
        });
        res.statusCode = 200;
        res.end(JSON.stringify({ request_id: id }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: "invalid json" } }));
      }
    });
    return;
  }

  // 注意：上面已经有 /v1/videos/{id} 的 newapi 风格 GET 分支（newapiMatch）
  // 那个分支对 grok 同样适用，但回包格式需要是 xAI 风格。
  // 我们让 newapi 风格 GET 路径优先匹配，未匹配到时再走 grok 风格。
  // 这里给 grok 一个独立的提交路径让 mock 知道是 xAI 风格。

  res.statusCode = 404;
  res.end(JSON.stringify({ error: { message: "not found" } }));
});

function collectBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

server.listen(PORT, () => {
  console.log(`[mock-newapi] listening on http://localhost:${PORT}`);
  console.log(
    `[mock-newapi] complete_after=${COMPLETE_AFTER} fail=${FAIL_MODE} (modes: newapi + dashscope + newapi-video + ark)`,
  );
});
