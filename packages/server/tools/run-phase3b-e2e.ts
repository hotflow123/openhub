/**
 * Phase 3B 端到端验证：worker 自动处理异步视频任务（POST → submit → poll → 完成）
 *
 * 跑法：
 *   终端 1: cd packages/server && npx tsx tools/mock-newapi-video-server.ts
 *   终端 2: cd packages/server && pnpm dev   （默认已起）
 *   终端 3: cd packages/server && npx tsx tools/run-phase3b-e2e.ts
 *
 * 流程：
 *   1. admin auth (Basic admin:admin123)
 *   2. POST /admin/sites           → 建 site 指向 mock (adapter=wan)
 *   3. 直接 DB 插一个 model（mock 的 /v1/models 是空的，discover 跑不出 model）
 *   4. POST /admin/variants        → 建 variant 关联 model，adapterConfig.video = { mode:"newapi", endpoint:"videos" }
 *   5. POST /admin/keys            → 拿到 hub key
 *   6. POST /v1/video/generations  → 提交任务，返回 task id
 *   7. 等 worker 轮询（最多 30 秒），轮询 GET /v1/video/tasks/:id 看 status
 *   8. 期望：status = completed, result.video_url 存在
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";

const BACKEND = process.env.OPENHUB_BACKEND ?? "http://localhost:3000";
const MOCK = process.env.MOCK_NEWAPI_URL ?? "http://localhost:4101";
const ADMIN_AUTH = "Basic " + Buffer.from("admin:admin123").toString("base64");

const log: string[] = [];
function log_line(s: string) {
  console.log(s);
  log.push(s);
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: ADMIN_AUTH,
    ...extraHeaders,
  };
  const url = path.startsWith("http") ? path : `${BACKEND}${path}`;
  const resp = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: resp.status, data };
}

async function main() {
  log_line(`[phase3b-e2e] backend=${BACKEND} mock=${MOCK}`);

  // 1. 建 site
  log_line(`[phase3b-e2e] step 1: POST /admin/sites`);
  const siteName = `mock-wan-${Date.now().toString(36)}`;
  const siteRes = await api("POST", "/admin/sites", {
    name: siteName,
    baseUrl: MOCK,
    apiKey: "sk-mock-test-key",
    adapterId: "wan",
  });
  log_line(`[phase3b-e2e] site response: status=${siteRes.status} ${JSON.stringify(siteRes.data)}`);
  if (siteRes.status !== 201) throw new Error("site create failed");
  const siteId = siteRes.data.data.id;

  // 2. 直接 DB 插 model（discover 走 mock 空 /v1/models 不会建）
  log_line(`[phase3b-e2e] step 2: insert model directly into DB`);
  const remoteId = "wanx2.1-t2v-turbo";
  const modelId = `${siteId}__${remoteId}`;
  const dbPath = process.env.OPENHUB_DB ?? "F:\\code\\测试\\packages\\server\\data\\openhub.db";
  const sqlite = new Database(dbPath);
  sqlite
    .prepare(
      `INSERT INTO models (id, site_id, remote_id, name) VALUES (?, ?, ?, ?)`,
    )
    .run(modelId, siteId, remoteId, remoteId);
  sqlite.close();
  log_line(`[phase3b-e2e] inserted model_id=${modelId}`);

  // 3. 建 variant
  log_line(`[phase3b-e2e] step 3: POST /admin/variants`);
  const variantName = `wan-e2e-${Date.now().toString(36)}`;
  const variantRes = await api("POST", "/admin/variants", {
    name: variantName,
    description: "Phase 3B e2e test variant",
    modelId,
    adapterConfig: { video: { mode: "newapi", endpoint: "videos" } },
    paramMapping: {},
  });
  log_line(`[phase3b-e2e] variant response: status=${variantRes.status} ${JSON.stringify(variantRes.data)}`);
  if (variantRes.status !== 201) throw new Error("variant create failed");

  // 4. 建 hub key
  log_line(`[phase3b-e2e] step 4: POST /admin/keys`);
  const keyRes = await api("POST", "/admin/keys", { name: `phase3b-${Date.now().toString(36)}` });
  log_line(`[phase3b-e2e] key response: status=${keyRes.status}`);
  if (keyRes.status !== 201) throw new Error("key create failed");
  const hubKey = keyRes.data.data.key;

  // 5. 提交异步任务
  log_line(`[phase3b-e2e] step 5: POST /v1/video/generations`);
  const submitBody = {
    model: variantName,
    prompt: "a cat riding a skateboard down a neon-lit alley, cinematic, 4k",
    duration: 5,
    aspect_ratio: "16:9",
  };
  const submitRes = await fetch(`${BACKEND}/v1/video/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${hubKey}`,
    },
    body: JSON.stringify(submitBody),
  });
  const submitData = await submitRes.json();
  log_line(
    `[phase3b-e2e] submit response: status=${submitRes.status} ${JSON.stringify(submitData)}`,
  );
  if (submitRes.status !== 200) throw new Error("video submit failed");
  const taskId = submitData.id;

  // 6. 轮询直到完成（最多 40 秒）
  log_line(`[phase3b-e2e] step 6: polling task ${taskId} until terminal`);
  const deadline = Date.now() + 40_000;
  let final: any = null;
  while (Date.now() < deadline) {
    const poll = await fetch(`${BACKEND}/v1/video/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${hubKey}` },
    });
    const pollData = await poll.json();
    log_line(`[phase3b-e2e] poll: status=${pollData.status} poll_count=${pollData.poll_count}`);
    if (
      pollData.status === "completed" ||
      pollData.status === "failed" ||
      pollData.status === "timeout"
    ) {
      final = pollData;
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!final) throw new Error("task did not reach terminal state within 40s");
  log_line(`[phase3b-e2e] final task: ${JSON.stringify(final)}`);

  if (final.status !== "completed") {
    throw new Error(`expected completed, got ${final.status}: ${final.error ?? ""}`);
  }
  if (!final.result?.video_url) {
    throw new Error("completed task has no result.video_url");
  }

  log_line(`[phase3b-e2e] PASSED`);

  mkdirSync(resolve("agent-notes/runlog"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(
    resolve(`agent-notes/runlog/phase-3b-e2e-${stamp}.md`),
    log.join("\n") + "\n",
    "utf-8",
  );

  // 清理（可选）
  log_line(`[phase3b-e2e] (optional) cleaning up site+model`);
  try {
    await api("DELETE", `/admin/sites/${siteId}`);
  } catch {}
}

main().catch((e) => {
  log_line(`[phase3b-e2e] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  mkdirSync(resolve("agent-notes/runlog"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(
    resolve(`agent-notes/runlog/phase-3b-e2e-${stamp}.md`),
    log.join("\n") + "\n",
    "utf-8",
  );
  process.exit(1);
});