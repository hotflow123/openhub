/**
 * grok 适配器跑通证据脚本
 *
 * 跑法：
 *   终端 1: cd packages/server && npx tsx tools/mock-newapi-video-server.ts
 *   终端 2: cd packages/server && npx tsx tools/run-grok-smoke.ts
 *
 * 流程：
 *   1. import grokAdapter，构造 direct 模式 ctx（baseUrl=mock）
 *   2. submitVideoTask → 收到 request_id
 *   3. queryVideoTask 第一次 → pending / processing
 *   4. queryVideoTask 第二次 → done / completed + video.url
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { grokAdapter } from "../src/engine/adapters/grok";

const MOCK_URL = process.env.MOCK_NEWAPI_URL ?? "http://localhost:4101";
const MOCK_KEY = "sk-mock-test-key";
const PROMPT = "a glowing crystal-powered rocket launching from Mars, cinematic";

const ctx = {
  targetUrl: MOCK_URL,
  apiKey: MOCK_KEY,
  config: {
    video: {
      mode: "direct" as const,
      vendor: {
        baseUrl: MOCK_URL,
        submitPath: "/v1/videos/generations",
        queryPath: "/v1/videos/{id}",
      },
    },
  },
};

const log: string[] = [];
function log_line(s: string) {
  console.log(s);
  log.push(s);
}

async function main() {
  log_line(`[grok-smoke] target=${MOCK_URL} mode=direct`);
  log_line(`[grok-smoke] step 1: submitVideoTask`);
  const submitInput = {
    model: "grok-imagine-video-1.5",
    prompt: PROMPT,
    duration: 5,
    resolution: "720p",
    aspect_ratio: "16:9",
  };
  log_line(`[grok-smoke] submit payload: ${JSON.stringify(submitInput)}`);

  const submit = await grokAdapter.submitVideoTask!(submitInput, ctx);
  log_line(`[grok-smoke] submit response: ${JSON.stringify(submit)}`);
  if (!submit.siteTaskId) throw new Error("submitVideoTask returned no request_id");

  log_line(`[grok-smoke] step 2: queryVideoTask #1 (expect pending / processing)`);
  const q1 = await grokAdapter.queryVideoTask!(submit.siteTaskId, ctx);
  log_line(
    `[grok-smoke] query #1 response: ${JSON.stringify({ status: q1.status, result: q1.result ?? null })}`,
  );

  log_line(`[grok-smoke] step 3: queryVideoTask #2 (expect done / completed)`);
  const q2 = await grokAdapter.queryVideoTask!(submit.siteTaskId, ctx);
  log_line(
    `[grok-smoke] query #2 response: ${JSON.stringify({ status: q2.status, result: q2.result ?? null })}`,
  );

  if (q2.status !== "completed") {
    throw new Error(`expected completed, got ${q2.status}`);
  }
  if (!q2.result?.video_url) {
    throw new Error("expected completed result.video_url, got none");
  }

  log_line(`[grok-smoke] step 4: status mapping sample`);
  const mapped1 = grokAdapter.mapVideoStatus!("done");
  const mapped2 = grokAdapter.mapVideoStatus!("pending");
  const mapped3 = grokAdapter.mapVideoStatus!("failed");
  const mapped4 = grokAdapter.mapVideoStatus!("expired");
  log_line(`[grok-smoke] mapVideoStatus("done") = ${mapped1}`);
  log_line(`[grok-smoke] mapVideoStatus("pending") = ${mapped2}`);
  log_line(`[grok-smoke] mapVideoStatus("failed") = ${mapped3}`);
  log_line(`[grok-smoke] mapVideoStatus("expired") = ${mapped4}`);
  if (mapped1 !== "completed") throw new Error("mapVideoStatus('done') should be 'completed'");
  if (mapped2 !== "pending") throw new Error("mapVideoStatus('pending') should be 'pending'");
  if (mapped3 !== "failed") throw new Error("mapVideoStatus('failed') should be 'failed'");
  if (mapped4 !== "timeout") throw new Error("mapVideoStatus('expired') should be 'timeout'");

  log_line(`[grok-smoke] PASSED`);

  mkdirSync(resolve("agent-notes/runlog"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(
    resolve(`agent-notes/runlog/phase-3a-grok-smoke-${stamp}.md`),
    log.join("\n") + "\n",
    "utf-8",
  );
}

main().catch((e) => {
  log_line(`[grok-smoke] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  mkdirSync(resolve("agent-notes/runlog"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(
    resolve(`agent-notes/runlog/phase-3a-grok-smoke-${stamp}.md`),
    log.join("\n") + "\n",
    "utf-8",
  );
  process.exit(1);
});