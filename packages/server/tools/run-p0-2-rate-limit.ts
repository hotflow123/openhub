/**
 * P0-2 验证：速率限制（rate_limit 字段实际生效）
 *
 * 流程：
 *   1. 建一个 hub key，rate_limit = 3
 *   2. 连发 3 次 /v1/chat/completions → 200
 *   3. 第 4 次 → 429 + Retry-After header
 *   4. 验证响应头：X-RateLimit-Limit=3, X-RateLimit-Remaining=0
 *   5. 再建一个 key，rate_limit = null → 5 次都 200（不限速）
 */

const BACKEND = process.env.OPENHUB_BACKEND ?? "http://localhost:3000";
const ADMIN_AUTH = "Basic " + Buffer.from("admin:admin123").toString("base64");

const log = [];
function L(s) { console.log(s); log.push(s); }

async function api(method, path, body) {
  const resp = await fetch(`${BACKEND}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: ADMIN_AUTH },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: resp.status, data, headers: resp.headers };
}

async function callChat(key) {
  return await fetch(`${BACKEND}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "mock-gpt4o-mini",
      messages: [{ role: "user", content: "ping" }],
    }),
  });
}

async function main() {
  L("[p0-2] backend=" + BACKEND);

  // 1. 建 key, rate_limit=3
  const keyName = `p0-2-test-${Date.now().toString(36)}`;
  const keyRes = await api("POST", "/admin/keys", { name: keyName, rateLimit: 3 });
  if (keyRes.status !== 201) throw new Error("key create failed");
  const rawKey = keyRes.data.data.key;
  L(`[p0-2] created key id=${keyRes.data.data.id} rate_limit=3`);

  // 2. 连发 3 次
  for (let i = 1; i <= 3; i++) {
    const r = await callChat(rawKey);
    L(`[p0-2] request #${i}: status=${r.status} X-RateLimit-Remaining=${r.headers.get("X-RateLimit-Remaining")}`);
    if (r.status !== 200) throw new Error(`expected 200, got ${r.status}`);
  }

  // 3. 第 4 次 → 429
  const r4 = await callChat(rawKey);
  const r4Data = await r4.json();
  L(`[p0-2] request #4: status=${r4.status} X-RateLimit-Remaining=${r4.headers.get("X-RateLimit-Remaining")} Retry-After=${r4.headers.get("Retry-After")}`);
  L(`[p0-2] request #4 body: ${JSON.stringify(r4Data)}`);
  if (r4.status !== 429) throw new Error(`expected 429, got ${r4.status}`);
  if (r4Data.error?.code !== "rate_limited") throw new Error(`expected code=rate_limited, got ${r4Data.error?.code}`);
  if (!r4.headers.get("Retry-After")) throw new Error("Retry-After header missing");

  // 4. 验证响应头
  const limitHeader = r4.headers.get("X-RateLimit-Limit");
  if (limitHeader !== "3") throw new Error(`expected X-RateLimit-Limit=3, got ${limitHeader}`);

  // 5. 不限速的 key
  const unlimName = `p0-2-unlimited-${Date.now().toString(36)}`;
  const unlimRes = await api("POST", "/admin/keys", { name: unlimName });
  const unlimKey = unlimRes.data.data.key;
  L(`[p0-2] created unlimited key id=${unlimRes.data.data.id}`);
  for (let i = 1; i <= 5; i++) {
    const r = await callChat(unlimKey);
    if (r.status !== 200) throw new Error(`unlimited key request #${i} got ${r.status}`);
  }
  L(`[p0-2] unlimited key: 5 requests all 200`);

  L("[p0-2] PASSED");
}

main().catch((e) => {
  L(`[p0-2] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});