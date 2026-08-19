/**
 * P0-1 验证：API Key 撤销
 *
 * 流程：
 *   1. 建一个 hub key
 *   2. 用它打 /v1/models → 200
 *   3. POST /admin/keys/:id/revoke
 *   4. 再用同一个 key 打 /v1/models → 401 + code=revoked_key
 *   5. 再次 revoke → 200 + already_revoked=true（幂等）
 */

const BACKEND = process.env.OPENHUB_BACKEND ?? "http://localhost:3000";
const ADMIN_AUTH = "Basic " + Buffer.from("admin:admin123").toString("base64");

const log = [];
function L(s) { console.log(s); log.push(s); }

async function api(method, path, body, extraHeaders = {}) {
  const url = path.startsWith("http") ? path : `${BACKEND}${path}`;
  const resp = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: ADMIN_AUTH, ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: resp.status, data };
}

async function main() {
  L("[p0-1] backend=" + BACKEND);

  // 1. 建 key
  const keyName = `p0-1-test-${Date.now().toString(36)}`;
  const keyRes = await api("POST", "/admin/keys", { name: keyName });
  if (keyRes.status !== 201) throw new Error("key create failed: " + JSON.stringify(keyRes.data));
  const keyId = keyRes.data.data.id;
  const rawKey = keyRes.data.data.key;
  L(`[p0-1] created key id=${keyId} prefix=${keyRes.data.data.prefix}`);

  // 2. 用 key 打 /v1/chat/completions → 200
  const before = await fetch(`${BACKEND}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({
      model: "mock-gpt4o-mini",
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  L(`[p0-1] /v1/chat/completions before revoke: status=${before.status}`);
  if (before.status !== 200) throw new Error(`expected 200, got ${before.status}`);

  // 3. 撤销
  const revokeRes = await api("POST", `/admin/keys/${keyId}/revoke`);
  L(`[p0-1] revoke response: status=${revokeRes.status} ${JSON.stringify(revokeRes.data)}`);
  if (revokeRes.status !== 200) throw new Error("revoke failed");
  if (revokeRes.data.data.status !== "revoked") throw new Error("status not revoked");
  if (typeof revokeRes.data.data.revoked_at !== "number") throw new Error("revoked_at missing");

  // 4. 用同一个 key 打 /v1/chat/completions → 401
  const after = await fetch(`${BACKEND}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawKey}`,
    },
    body: JSON.stringify({
      model: "mock-gpt4o-mini",
      messages: [{ role: "user", content: "ping again" }],
    }),
  });
  const afterData = await after.json();
  L(`[p0-1] /v1/chat/completions after revoke: status=${after.status} body=${JSON.stringify(afterData)}`);
  if (after.status !== 401) throw new Error(`expected 401, got ${after.status}`);
  if (afterData.error?.code !== "revoked_key") throw new Error(`expected code=revoked_key, got ${afterData.error?.code}`);

  // 5. 再次撤销 → 幂等
  const revokeAgain = await api("POST", `/admin/keys/${keyId}/revoke`);
  L(`[p0-1] revoke again: status=${revokeAgain.status} ${JSON.stringify(revokeAgain.data)}`);
  if (revokeAgain.status !== 200) throw new Error("second revoke should be idempotent 200");
  if (!revokeAgain.data.data.already_revoked) throw new Error("already_revoked should be true");

  L("[p0-1] PASSED");
}

main().catch((e) => {
  L(`[p0-1] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});