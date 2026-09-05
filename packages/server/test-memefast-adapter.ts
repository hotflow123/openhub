import assert from "node:assert/strict";
import test from "node:test";
import { memefastAdapter } from "./src/engine/adapters/memefast";

test("MemeFast adapter executes the bound protocol paths without renaming the model", async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response(
      calls.at(-1)?.method === "POST"
        ? JSON.stringify({ task_id: "task-1", status: "queued" })
        : JSON.stringify({ task: { status: "succeeded", result: { video_url: "https://cdn.test/video.mp4" } } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const context = {
      targetUrl: "https://api.memefast.cc",
      apiKey: "secret",
      protocol: {
        protocolId: "memefast.seedance.video",
        version: "source-test",
        modality: "video",
        modelNames: ["seedance2.0"],
        operations: [
          {
            method: "POST",
            path: "/v1/video/generations",
            operationRole: "video.submit",
            summary: "Create video",
            requestBody: {
              schema: {
                properties: {
                  model: { type: "string" },
                  content: { type: "array" },
                  duration: { type: "integer" },
                  ratio: { type: "string" },
                },
              },
            },
          },
          {
            method: "GET",
            path: "/v1/query/video_generation/{task_id}",
            operationRole: "video.query",
            summary: "Query video",
          },
        ],
      },
    };

    const submitted = await memefastAdapter.submitVideoTask(
      { model: "seedance2.0", prompt: "test", duration: 5 },
      context,
    );
    const queried = await memefastAdapter.queryVideoTask(submitted.siteTaskId, context);

    assert.equal(submitted.siteTaskId, "task-1");
    assert.equal(queried.status, "completed");
    assert.equal(queried.result?.video_url, "https://cdn.test/video.mp4");
    assert.equal(calls[0].url, "https://api.memefast.cc/v1/video/generations");
    assert.equal(calls[1].url, "https://api.memefast.cc/v1/query/video_generation/task-1");
    const requestBody = JSON.parse(calls[0].body ?? "{}");
    assert.equal(requestBody.model, "seedance2.0");
    assert.deepEqual(requestBody.content, [{ type: "text", text: "test" }]);
    assert.equal(requestBody.duration, 5);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("MemeFast adapter refuses execution without a protocol binding", async () => {
  await assert.rejects(
    memefastAdapter.submitVideoTask({ model: "seedance2.0" }, {
      targetUrl: "https://api.memefast.cc",
      apiKey: "secret",
    }),
    /protocol binding is required/,
  );
});

test("MemeFast query prefers the single-task endpoint over a task list", async () => {
  const previousFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input, init) => {
    urls.push(String(input));
    return new Response(
      init?.method === "POST"
        ? JSON.stringify({ task_id: "task-1", status: "queued" })
        : JSON.stringify({ task: { status: "succeeded" } }),
      { status: 200 },
    );
  };

  try {
    await memefastAdapter.queryVideoTask("task-1", {
      targetUrl: "https://api.memefast.cc",
      apiKey: "secret",
      protocol: {
        protocolId: "memefast.seedance.video",
        version: "source-test",
        modality: "video",
        operations: [
          { method: "GET", path: "/api/v3/contents/generations/tasks", operationRole: "video.query" },
          { method: "GET", path: "/api/v3/contents/generations/tasks/{task_id}", operationRole: "video.query" },
        ],
      },
    });
    assert.equal(urls[0], "https://api.memefast.cc/api/v3/contents/generations/tasks/task-1");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("MemeFast query stays on the submit endpoint family", async () => {
  const previousFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input, init) => {
    urls.push(String(input));
    return new Response(
      init?.method === "POST"
        ? JSON.stringify({ task_id: "task-1", status: "queued" })
        : JSON.stringify({ task: { status: "succeeded" } }),
      { status: 200 },
    );
  };

  try {
    const context = {
      targetUrl: "https://api.memefast.cc",
      apiKey: "secret",
      protocol: {
        protocolId: "memefast.seedance.video",
        version: "source-test",
        modality: "video",
        operations: [
          {
            method: "POST",
            path: "/api/v3/contents/generations/tasks",
            operationRole: "video.submit",
          },
          {
            method: "GET",
            path: "/v1/video/generations/{task_id}",
            operationRole: "video.query",
          },
          {
            method: "GET",
            path: "/api/v3/contents/generations/tasks/{task_id}",
            operationRole: "video.query",
          },
        ],
      },
    };

    await memefastAdapter.submitVideoTask({ model: "seedance2.0", prompt: "test" }, context);
    await memefastAdapter.queryVideoTask("task-1", context);

    assert.equal(urls[1], "https://api.memefast.cc/api/v3/contents/generations/tasks/task-1");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("MemeFast maps prompt to content for imported direct-property schemas", async () => {
  const previousFetch = globalThis.fetch;
  let requestBody = "";
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ task_id: "task-1", status: "queued" }), { status: 200 });
  };

  try {
    await memefastAdapter.submitVideoTask(
      { model: "doubao-seedance-2-0-fast-260128", prompt: "test", duration: 5 },
      {
        targetUrl: "https://api.memefast.cc",
        apiKey: "secret",
        protocol: {
          protocolId: "memefast.seedance.video",
          version: "source-test",
          modality: "video",
          operations: [{
            method: "POST",
            path: "/api/v3/contents/generations/tasks",
            operationRole: "video.submit",
            requestBody: {
              properties: {
                model: { type: "string" },
                content: { type: "array" },
              },
            },
          }],
        },
      },
    );
    const body = JSON.parse(requestBody) as Record<string, unknown>;
    assert.deepEqual(body.content, [{ type: "text", text: "test" }]);
    assert.equal(body.prompt, undefined);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
