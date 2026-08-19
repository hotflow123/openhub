/**
 * Phase 3C 端到端验证：跑通 4 个生成类型（chat / image / audio / video）
 *
 * 跑法：
 *   终端 1: node mock-echo.cjs 9999  （chat/image/audio/embedding）
 *   终端 2: npx tsx packages/server/tools/mock-newapi-video-server.ts   （video）
 *   终端 3: cd packages/server && pnpm dev  （已在跑）
 *   终端 4: npx tsx packages/server/tools/run-phase3c-e2e.ts
 *
 * 流程：
 *   1. 建 chat site (openai) → mock-echo:9999，建 model + variant mock-chat
 *   2. 建 image site (openai) → mock-echo:9999，建 model + variant mock-dalle
 *   3. 建 audio site (openai) → mock-echo:9999，建 model + variant mock-tts
 *   4. 建 video site (wan)    → mock-newapi:4101，建 model + variant mock-wan
 *   5. 建 hub key
 *   6. POST /v1/chat/completions → 验证 mock-reply
 *   7. POST /v1/images/generations → 验证 image URL
 *   8. POST /v1/audio/speech → 验证 200
 *   9. POST /v1/video/generations → 验证异步完成
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";

const BACKEND = process.env.OPENHUB_BACKEND ?? "http://localhost:3000";
const MOCK_ECHO = process.env.MOCK_ECHO_URL ?? "http://localhost:9999";
const MOCK_VIDEO = process.env.MOCK_NEWAPI_URL ?? "http://localhost:4101";
const ADMIN_AUTH = "Basic " + Buffer.from("admin:admin123").toString("base64");
const DB_PATH = process.env.OPENHUB_DB ?? "F:\\code\\测试\\packages\\server\\data\\openhub.db";

const log: string[] = [];
function log_line(s: string) {
  console.log(s);
  log.push(s);
}

async function admin(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  const url = path.startsWith("http") ? path : `${BACKEND}${path}`;
  const resp = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: ADMIN_AUTH,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: resp.status, data };
}

async function user(method: string, path: string, hubKey: string, body?: unknown): Promise<{
  status: number;
  data: any;
  text?: string;
}> {
  const url = path.startsWith("http") ? path : `${BACKEND}${path}`;
  const resp = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${hubKey}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: resp.status, data, text };
}

function insertModel(modelId: string, siteId: string, remoteId: string, name: string): void {
  const sqlite = new Database(DB_PATH);
  sqlite.prepare(`DELETE FROM models WHERE id = ?`).run(modelId);
  sqlite
    .prepare(`INSERT INTO models (id, site_id, remote_id, name) VALUES (?, ?, ?, ?)`)
    .run(modelId, siteId, remoteId, name);
  sqlite.close();
}

interface SetupResult {
  siteId: string;
  modelId: string;
  variantId: string;
  variantName: string;
}

async function setupSiteModelVariant(
  adapterId: string,
  baseUrl: string,
  remoteId: string,
  variantBaseName: string,
  adapterConfig: Record<string, unknown> | undefined,
): Promise<SetupResult> {
  const stamp = Date.now().toString(36);
  const variantName = `${variantBaseName}-${stamp}`;
  // site
  const siteRes = await admin("POST", "/admin/sites", {
    name: `${adapterId}-${stamp}-${Math.random().toString(36).slice(2, 6)}`,
    baseUrl,
    apiKey: "sk-mock-test-key",
    adapterId,
  });
  if (siteRes.status !== 201) throw new Error(`site create failed: ${JSON.stringify(siteRes.data)}`);
  const siteId = siteRes.data.data.id;
  // model
  const modelId = `${siteId}__${remoteId}`;
  insertModel(modelId, siteId, remoteId, remoteId);
  // variant
  const variantRes = await admin("POST", "/admin/variants", {
    name: variantName,
    description: `Phase 3C ${adapterId} ${variantName}`,
    modelId,
    adapterConfig,
    paramMapping: {},
  });
  if (variantRes.status !== 201) throw new Error(`variant create failed: ${JSON.stringify(variantRes.data)}`);
  const variantId = variantRes.data.data.id;
  return { siteId, modelId, variantId, variantName };
}

async function main() {
  log_line(`[phase3c-e2e] backend=${BACKEND}`);
  log_line(`[phase3c-e2e] mock-echo=${MOCK_ECHO}  mock-video=${MOCK_VIDEO}`);

  // 1. 建 hub key
  log_line(`[phase3c-e2e] step 0: POST /admin/keys`);
  const keyRes = await admin("POST", "/admin/keys", {
    name: `phase3c-${Date.now().toString(36)}`,
  });
  if (keyRes.status !== 201) throw new Error(`key create failed: ${JSON.stringify(keyRes.data)}`);
  const hubKey = keyRes.data.data.key;
  log_line(`[phase3c-e2e] hub key: ${keyRes.data.data.prefix}...`);

  // 2. chat setup
  log_line(`\n[phase3c-e2e] === chat ===`);
  const chat = await setupSiteModelVariant(
    "openai", MOCK_ECHO, "gpt-4o-mini", "mock-gpt4o-mini", undefined,
  );
  log_line(`[phase3c-e2e] chat site=${chat.siteId} variant=${chat.variantName}`);

  // 3. chat 调用
  log_line(`[phase3c-e2e] step 1: POST /v1/chat/completions`);
  const chatRes = await user("POST", "/v1/chat/completions", hubKey, {
    model: chat.variantName,
    messages: [{ role: "user", content: "e2e ping" }],
  });
  log_line(`[phase3c-e2e] chat response: status=${chatRes.status}`);
  log_line(`[phase3c-e2e] chat body: ${JSON.stringify(chatRes.data)}`);
  if (chatRes.status !== 200) throw new Error(`chat failed: ${chatRes.status}`);
  const reply = chatRes.data?.choices?.[0]?.message?.content ?? "";
  if (!reply.includes("mock-reply")) throw new Error(`chat reply missing 'mock-reply': ${reply}`);

  // 4. image setup
  log_line(`\n[phase3c-e2e] === image ===`);
  const img = await setupSiteModelVariant(
    "openai", MOCK_ECHO, "dall-e-3", "mock-dalle", undefined,
  );
  log_line(`[phase3c-e2e] image site=${img.siteId} variant=${img.variantName}`);

  // 5. image 调用
  log_line(`[phase3c-e2e] step 2: POST /v1/images/generations`);
  const imgRes = await user("POST", "/v1/images/generations", hubKey, {
    model: img.variantName,
    prompt: "a cat",
    n: 1,
    size: "256x256",
  });
  log_line(`[phase3c-e2e] image response: status=${imgRes.status}`);
  log_line(`[phase3c-e2e] image body: ${JSON.stringify(imgRes.data)}`);
  if (imgRes.status !== 200) throw new Error(`image failed: ${imgRes.status}`);
  const imageUrl = imgRes.data?.data?.[0]?.url ?? "";
  if (!imageUrl.includes("example.com/mock-")) throw new Error(`image url wrong: ${imageUrl}`);

  // 6. audio setup
  log_line(`\n[phase3c-e2e] === audio ===`);
  const aud = await setupSiteModelVariant(
    "openai", MOCK_ECHO, "tts-1", "mock-tts", undefined,
  );
  log_line(`[phase3c-e2e] audio site=${aud.siteId} variant=${aud.variantName}`);

  // 7. audio 调用
  log_line(`[phase3c-e2e] step 3: POST /v1/audio/speech`);
  const audRes = await fetch(`${BACKEND}/v1/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${hubKey}`,
    },
    body: JSON.stringify({
      model: aud.variantName,
      input: "hello world",
      voice: "alloy",
    }),
  });
  const audBuf = await audRes.arrayBuffer();
  log_line(`[phase3c-e2e] audio response: status=${audRes.status} bytes=${audBuf.byteLength}`);
  if (audRes.status !== 200) throw new Error(`audio failed: ${audRes.status}`);
  if (audBuf.byteLength === 0) throw new Error(`audio response empty`);

  // 8. video setup
  log_line(`\n[phase3c-e2e] === video ===`);
  const vid = await setupSiteModelVariant(
    "wan", MOCK_VIDEO, "wanx2.1-t2v-turbo", "mock-wan",
    { video: { mode: "newapi", endpoint: "videos" } },
  );
  log_line(`[phase3c-e2e] video site=${vid.siteId} variant=${vid.variantName}`);

  // 9. video 调用
  log_line(`[phase3c-e2e] step 4: POST /v1/video/generations`);
  const submitRes = await user("POST", "/v1/video/generations", hubKey, {
    model: vid.variantName,
    prompt: "a cat riding a skateboard, cinematic, 4k",
    duration: 5,
    aspect_ratio: "16:9",
  });
  log_line(`[phase3c-e2e] video submit: status=${submitRes.status} ${JSON.stringify(submitRes.data)}`);
  if (submitRes.status !== 200) throw new Error(`video submit failed: ${submitRes.status}`);
  const taskId = submitRes.data.id;

  log_line(`[phase3c-e2e] polling task ${taskId}...`);
  const deadline = Date.now() + 40_000;
  let final: any = null;
  while (Date.now() < deadline) {
    const poll = await user("GET", `/v1/video/tasks/${taskId}`, hubKey);
    log_line(`[phase3c-e2e] poll: status=${poll.data?.status} poll_count=${poll.data?.poll_count}`);
    if (
      poll.data?.status === "completed" ||
      poll.data?.status === "failed" ||
      poll.data?.status === "timeout"
    ) {
      final = poll.data;
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!final) throw new Error("video task did not finish within 40s");
  if (final.status !== "completed") throw new Error(`video task status=${final.status}: ${final.error}`);
  if (!final.result?.video_url) throw new Error("video task has no video_url");

  log_line(`\n[phase3c-e2e] ALL PASSED`);
  log_line(`[phase3c-e2e]   chat reply   : ${reply.slice(0, 60)}...`);
  log_line(`[phase3c-e2e]   image url    : ${imageUrl}`);
  log_line(`[phase3c-e2e]   audio bytes  : ${audBuf.byteLength}`);
  log_line(`[phase3c-e2e]   video url    : ${final.result.video_url}`);
  log_line(`[phase3c-e2e]   video polls  : ${final.poll_count}`);

  mkdirSync(resolve("agent-notes/runlog"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(
    resolve(`agent-notes/runlog/phase-3c-e2e-${stamp}.md`),
    log.join("\n") + "\n",
    "utf-8",
  );

  // 清理
  log_line(`\n[phase3c-e2e] cleanup: deleting sites`);
  for (const s of [chat, img, aud, vid]) {
    try { await admin("DELETE", `/admin/sites/${s.siteId}`); } catch {}
  }
}

main().catch((e) => {
  log_line(`[phase3c-e2e] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  mkdirSync(resolve("agent-notes/runlog"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(
    resolve(`agent-notes/runlog/phase-3c-e2e-${stamp}.md`),
    log.join("\n") + "\n",
    "utf-8",
  );
  process.exit(1);
});