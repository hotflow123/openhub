/**
 * kling 适配器跑通证据脚本
 *
 * 流程：
 *   1. 直接 import klingAdapter，构造 mock newapi 模式 ctx
 *   2. 假设本机 4101 端口有 mock-newapi-video-server 跑着
 *   3. submitVideoTask → 收到 site_id
 *   4. queryVideoTask 第一次 → processing
 *   5. queryVideoTask 第二次 → completed + result.video_url
 *   6. 把请求/响应摘要写进 runlog
 *
 * 跑法：
 *   终端 1: pnpm tsx packages/server/tools/mock-newapi-video-server.ts
 *   终端 2: pnpm tsx packages/server/tools/run-kling-smoke.ts
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { klingAdapter } from "../src/engine/adapters/kling";

const MOCK_URL = process.env.MOCK_NEWAPI_URL ?? "http://localhost:4101";
const MOCK_KEY = "sk-mock-test-key";
const PROMPT = "a cat wearing sunglasses, cinematic, 4k";

const ctx = {
  targetUrl: MOCK_URL,
  apiKey: MOCK_KEY,
  config: {
    video: { mode: "newapi" as const, endpoint: "videos" },
  },
};

const log: string[] = [];
function log_line(s: string) {
  console.log(s);
  log.push(s);
}

async function main() {
  log_line(`[kling-smoke] target=${MOCK_URL} mode=newapi`);
  log_line(`[kling-smoke] step 1: submitVideoTask`);
  const submitInput = {
    prompt: PROMPT,
    model: "kling-v1-5",
    duration: 5,
    aspect_ratio: "16:9",
  };
  log_line(`[kling-smoke] submit payload: ${JSON.stringify(submitInput)}`);

  const submit = await klingAdapter.submitVideoTask!(submitInput, ctx);
  log_line(`[kling-smoke] submit response: ${JSON.stringify(submit)}`);
  if (!submit.siteTaskId) throw new Error("submitVideoTask returned no siteTaskId");

  log_line(`[kling-smoke] step 2: queryVideoTask #1 (expect processing)`);
  const q1 = await klingAdapter.queryVideoTask!(submit.siteTaskId, ctx);
  log_line(`[kling-smoke] query #1 response: ${JSON.stringify({ status: q1.status, result: q1.result ?? null })}`);

  log_line(`[kling-smoke] step 3: queryVideoTask #2 (expect completed)`);
  const q2 = await klingAdapter.queryVideoTask!(submit.siteTaskId, ctx);
  log_line(`[kling-smoke] query #2 response: ${JSON.stringify({ status: q2.status, result: q2.result ?? null })}`);

  if (q2.status !== "completed") {
    throw new Error(`expected completed, got ${q2.status}`);
  }
  if (!q2.result?.video_url) {
    throw new Error("expected completed result.video_url, got none");
  }

  log_line(`[kling-smoke] step 4: status mapping sample`);
  const mapped = klingAdapter.mapVideoStatus!("succeed");
  log_line(`[kling-smoke] mapVideoStatus("succeed") = ${mapped}`);
  if (mapped !== "completed") throw new Error("mapVideoStatus('succeed') should be 'completed'");

  log_line(`[kling-smoke] PASSED`);

  // 写证据
  mkdirSync(resolve("agent-notes/runlog"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(
    resolve(`agent-notes/runlog/phase-3a-kling-smoke-${stamp}.md`),
    log.join("\n") + "\n",
    "utf-8",
  );
}

main().catch((e) => {
  log_line(`[kling-smoke] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  mkdirSync(resolve("agent-notes/runlog"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(
    resolve(`agent-notes/runlog/phase-3a-kling-smoke-${stamp}.md`),
    log.join("\n") + "\n",
    "utf-8",
  );
  process.exit(1);
});
