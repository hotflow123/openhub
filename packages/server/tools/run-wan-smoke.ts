/**
 * wan 适配器跑通证据脚本
 *
 * 跑法：
 *   终端 1: cd packages/server && npx tsx tools/mock-newapi-video-server.ts
 *           （或用 MOCK_NEWAPI_PORT=4102 区分；本脚本默认 4101）
 *   终端 2: cd packages/server && npx tsx tools/run-wan-smoke.ts [mode]
 *           mode 默认 "newapi"，可传 "direct"
 *
 * 流程：
 *   1. 直接 import wanAdapter，构造对应模式的 ctx
 *   2. submitVideoTask → 收到 site_id
 *   3. queryVideoTask 第一次 → processing / RUNNING
 *   4. queryVideoTask 第二次 → completed / SUCCEEDED + result.video_url
 *   5. 把请求/响应摘要写进 runlog
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { wanAdapter } from "../src/engine/adapters/wan";

const MOCK_URL = process.env.MOCK_NEWAPI_URL ?? "http://localhost:4101";
const MOCK_KEY = "sk-mock-test-key";
const MODE = (process.argv[2] as "newapi" | "direct" | undefined) ?? "newapi";
const PROMPT = "a panda riding a bicycle through a misty bamboo forest, cinematic, 4k";

const ctx =
  MODE === "direct"
    ? {
        targetUrl: MOCK_URL,
        apiKey: MOCK_KEY,
        config: {
          video: {
            mode: "direct" as const,
            vendor: {
              baseUrl: MOCK_URL, // 让 mock 直接服务（同一个端口同时支持两种协议）
              submitPath: "/api/v1/services/aigc/video-generation/video-synthesis",
              queryPath: "/api/v1/tasks/{id}",
              submitStyle: "form" as const,
            },
          },
        },
      }
    : {
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
  log_line(`[wan-smoke] target=${MOCK_URL} mode=${MODE}`);
  log_line(`[wan-smoke] step 1: submitVideoTask`);
  const submitInput = {
    prompt: PROMPT,
    model: "wanx2.1-t2v-turbo",
    parameters: { size: "1280*720", duration: 5 },
  };
  log_line(`[wan-smoke] submit payload: ${JSON.stringify(submitInput)}`);

  const submit = await wanAdapter.submitVideoTask!(submitInput, ctx);
  log_line(`[wan-smoke] submit response: ${JSON.stringify(submit)}`);
  if (!submit.siteTaskId) throw new Error("submitVideoTask returned no siteTaskId");

  log_line(`[wan-smoke] step 2: queryVideoTask #1 (expect processing / RUNNING)`);
  const q1 = await wanAdapter.queryVideoTask!(submit.siteTaskId, ctx);
  log_line(
    `[wan-smoke] query #1 response: ${JSON.stringify({ status: q1.status, result: q1.result ?? null })}`,
  );

  log_line(`[wan-smoke] step 3: queryVideoTask #2 (expect completed / SUCCEEDED)`);
  const q2 = await wanAdapter.queryVideoTask!(submit.siteTaskId, ctx);
  log_line(
    `[wan-smoke] query #2 response: ${JSON.stringify({ status: q2.status, result: q2.result ?? null })}`,
  );

  if (q2.status !== "completed") {
    throw new Error(`expected completed, got ${q2.status}`);
  }
  if (!q2.result?.video_url) {
    throw new Error("expected completed result.video_url, got none");
  }

  log_line(`[wan-smoke] step 4: status mapping sample`);
  const mapped1 = wanAdapter.mapVideoStatus!("SUCCEEDED");
  const mapped2 = wanAdapter.mapVideoStatus!("PENDING");
  const mapped3 = wanAdapter.mapVideoStatus!("FAILED");
  log_line(`[wan-smoke] mapVideoStatus("SUCCEEDED") = ${mapped1}`);
  log_line(`[wan-smoke] mapVideoStatus("PENDING") = ${mapped2}`);
  log_line(`[wan-smoke] mapVideoStatus("FAILED") = ${mapped3}`);
  if (mapped1 !== "completed") throw new Error("mapVideoStatus('SUCCEEDED') should be 'completed'");
  if (mapped2 !== "pending") throw new Error("mapVideoStatus('PENDING') should be 'pending'");
  if (mapped3 !== "failed") throw new Error("mapVideoStatus('FAILED') should be 'failed'");

  log_line(`[wan-smoke] PASSED`);

  // 写证据
  mkdirSync(resolve("agent-notes/runlog"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(
    resolve(`agent-notes/runlog/phase-3a-wan-smoke-${MODE}-${stamp}.md`),
    log.join("\n") + "\n",
    "utf-8",
  );
}

main().catch((e) => {
  log_line(`[wan-smoke] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  mkdirSync(resolve("agent-notes/runlog"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(
    resolve(`agent-notes/runlog/phase-3a-wan-smoke-${MODE}-${stamp}.md`),
    log.join("\n") + "\n",
    "utf-8",
  );
  process.exit(1);
});