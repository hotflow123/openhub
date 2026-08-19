/**
 * seedance 适配器跑通证据脚本
 *
 * 跑法：
 *   终端 1: cd packages/server && npx tsx tools/mock-newapi-video-server.ts
 *   终端 2: cd packages/server && npx tsx tools/run-seedance-smoke.ts [mode]
 *           mode 默认 "newapi"，可传 "direct"
 *
 * 流程：
 *   1. import seedanceAdapter，构造对应模式的 ctx
 *   2. submitVideoTask → 收到 site_id
 *   3. queryVideoTask 第一次 → queued / running
 *   4. queryVideoTask 第二次 → succeeded / completed + url
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { seedanceAdapter } from "../src/engine/adapters/seedance";

const MOCK_URL = process.env.MOCK_NEWAPI_URL ?? "http://localhost:4101";
const MOCK_KEY = "sk-mock-test-key";
const MODE = (process.argv[2] as "newapi" | "direct" | undefined) ?? "newapi";
const PROMPT = "a hummingbird in slow motion over a red flower, cinematic, 4k";

const ctx =
  MODE === "direct"
    ? {
        targetUrl: MOCK_URL,
        apiKey: MOCK_KEY,
        config: {
          video: {
            mode: "direct" as const,
            vendor: {
              baseUrl: MOCK_URL,
              submitPath: "/api/v3/contents/generations/tasks",
              queryPath: "/api/v3/contents/generations/tasks/{id}",
            },
          },
        },
      }
    : {
        targetUrl: MOCK_URL,
        apiKey: MOCK_KEY,
        config: {
          video: { mode: "newapi" as const, endpoint: "video", submitPath: "generations", taskPath: "tasks" },
        },
      };

const log: string[] = [];
function log_line(s: string) {
  console.log(s);
  log.push(s);
}

async function main() {
  log_line(`[seedance-smoke] target=${MOCK_URL} mode=${MODE}`);
  log_line(`[seedance-smoke] step 1: submitVideoTask`);
  const submitInput = {
    model: "bytedance/seedance-1.0-pro-t2v",
    prompt: PROMPT,
    size: "720p",
    duration: 5,
    aspect_ratio: "16:9",
  };
  log_line(`[seedance-smoke] submit payload: ${JSON.stringify(submitInput)}`);

  const submit = await seedanceAdapter.submitVideoTask!(submitInput, ctx);
  log_line(`[seedance-smoke] submit response: ${JSON.stringify(submit)}`);
  if (!submit.siteTaskId) throw new Error("submitVideoTask returned no siteTaskId");

  log_line(`[seedance-smoke] step 2: queryVideoTask #1 (expect queued / running)`);
  const q1 = await seedanceAdapter.queryVideoTask!(submit.siteTaskId, ctx);
  log_line(
    `[seedance-smoke] query #1 response: ${JSON.stringify({ status: q1.status, result: q1.result ?? null })}`,
  );

  log_line(`[seedance-smoke] step 3: queryVideoTask #2 (expect succeeded / completed)`);
  const q2 = await seedanceAdapter.queryVideoTask!(submit.siteTaskId, ctx);
  log_line(
    `[seedance-smoke] query #2 response: ${JSON.stringify({ status: q2.status, result: q2.result ?? null })}`,
  );

  if (q2.status !== "completed") {
    throw new Error(`expected completed, got ${q2.status}`);
  }
  if (!q2.result?.video_url) {
    throw new Error("expected completed result.video_url, got none");
  }

  log_line(`[seedance-smoke] step 4: status mapping sample`);
  const mapped1 = seedanceAdapter.mapVideoStatus!("succeeded");
  const mapped2 = seedanceAdapter.mapVideoStatus!("queued");
  const mapped3 = seedanceAdapter.mapVideoStatus!("failed");
  log_line(`[seedance-smoke] mapVideoStatus("succeeded") = ${mapped1}`);
  log_line(`[seedance-smoke] mapVideoStatus("queued") = ${mapped2}`);
  log_line(`[seedance-smoke] mapVideoStatus("failed") = ${mapped3}`);
  if (mapped1 !== "completed") throw new Error("mapVideoStatus('succeeded') should be 'completed'");
  if (mapped2 !== "pending") throw new Error("mapVideoStatus('queued') should be 'pending'");
  if (mapped3 !== "failed") throw new Error("mapVideoStatus('failed') should be 'failed'");

  log_line(`[seedance-smoke] PASSED`);

  mkdirSync(resolve("agent-notes/runlog"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(
    resolve(`agent-notes/runlog/phase-3a-seedance-smoke-${MODE}-${stamp}.md`),
    log.join("\n") + "\n",
    "utf-8",
  );
}

main().catch((e) => {
  log_line(`[seedance-smoke] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  mkdirSync(resolve("agent-notes/runlog"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(
    resolve(`agent-notes/runlog/phase-3a-seedance-smoke-${MODE}-${stamp}.md`),
    log.join("\n") + "\n",
    "utf-8",
  );
  process.exit(1);
});