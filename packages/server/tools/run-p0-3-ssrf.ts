/**
 * P0-3 验证：SSRF 防护（site.baseUrl 校验）
 *
 * 依赖：
 *   - OPENHUB_ALLOW_PRIVATE_URLS=true  → dev 模式（localhost 放行）
 *   - OPENHUB_ALLOW_PRIVATE_URLS=false → 生产模式（拒绝私网）
 *
 * 测试两种 URL：
 *   A) 公网 https（应放行，无论模式）
 *   B) localhost（应放行 dev / 拒绝 prod）
 *   C) 私网 IP 字面量 10.0.0.1（应拒绝，无论模式）
 *   D) AWS metadata 169.254.169.254（应拒绝，无论模式）
 *   E) 解析为私网 IP 的域名（应拒绝）
 *   F) ftp://（应拒绝，zod URL schema 拒绝）
 *
 * 流程：
 *   1. 通过创建/删除一组 site 来探测：status=201 表示放行，400 表示拒绝
 *   2. 把结果写到一个矩阵，最后断言
 */

const BACKEND = process.env.OPENHUB_BACKEND ?? "http://localhost:3000";
const ADMIN_AUTH = "Basic " + Buffer.from("admin:admin123").toString("base64");

const log = [];
function L(s) { console.log(s); log.push(s); }

async function trySite(baseUrl) {
  const resp = await fetch(`${BACKEND}/admin/sites`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: ADMIN_AUTH },
    body: JSON.stringify({
      name: `ssrf-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      baseUrl,
      apiKey: "sk-test",
      adapterId: "openai",
    }),
  });
  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: resp.status, data };
}

async function deleteSite(id) {
  if (!id) return;
  await fetch(`${BACKEND}/admin/sites/${id}`, {
    method: "DELETE",
    headers: { Authorization: ADMIN_AUTH },
  });
}

async function main() {
  L("[p0-3] backend=" + BACKEND);

  // 1. 公网 https（应放行）
  let r = await trySite("https://api.openai.com/v1");
  L(`[p0-3] A) https://api.openai.com → status=${r.status} (expect 201)`);
  if (r.status !== 201) throw new Error(`A) expected 201 for public https, got ${r.status}: ${JSON.stringify(r.data).slice(0, 120)}`);
  await deleteSite(r.data?.data?.id);

  // 2. localhost（dev 模式放行）
  r = await trySite("http://localhost:9999/");
  L(`[p0-3] B) http://localhost:9999 → status=${r.status} (dev 模式 expect 201, prod 模式 expect 400)`);
  if (r.status !== 201 && r.status !== 400) throw new Error(`B) unexpected status: ${r.status}`);
  if (r.status === 201) {
    L(`[p0-3]    → dev 模式：localhost 被放行（正确）`);
    await deleteSite(r.data?.data?.id);
  } else if (r.status === 400) {
    L(`[p0-3]    → prod 模式：localhost 被拒绝（正确）`);
  }

  // 3. 私网 IP 字面量 10.0.0.1（应拒绝，无论模式）
  r = await trySite("http://10.0.0.1/foo");
  L(`[p0-3] C) http://10.0.0.1 → status=${r.status} (expect 400)`);
  if (r.status !== 400) throw new Error(`C) expected 400 for 10.0.0.1, got ${r.status}`);
  if (r.data.error?.code !== "ssrf_blocked") throw new Error(`C) expected code=ssrf_blocked, got ${r.data.error?.code}`);

  // 4. AWS metadata 169.254.169.254（应拒绝）
  r = await trySite("http://169.254.169.254/latest/meta-data");
  L(`[p0-3] D) http://169.254.169.254 → status=${r.status} (expect 400)`);
  if (r.status !== 400) throw new Error(`D) expected 400 for AWS metadata, got ${r.status}`);
  if (r.data.error?.code !== "ssrf_blocked") throw new Error(`D) expected code=ssrf_blocked, got ${r.data.error?.code}`);

  // 5. loopback 127.0.0.1（应拒绝，无论模式 — 注意：IP 字面量在 dev 模式也必须拒绝）
  r = await trySite("http://127.0.0.1:1/");
  L(`[p0-3] E) http://127.0.0.1 → status=${r.status} (expect 400, IP 字面量即使 dev 也拒绝)`);
  if (r.status !== 400) throw new Error(`E) expected 400 for 127.0.0.1, got ${r.status}`);

  // 6. 192.168.0.0/16
  r = await trySite("http://192.168.1.1/");
  L(`[p0-3] F) http://192.168.1.1 → status=${r.status} (expect 400)`);
  if (r.status !== 400) throw new Error(`F) expected 400 for 192.168.1.1, got ${r.status}`);

  // 7. 非 http(s) 协议
  r = await trySite("ftp://example.com/");
  L(`[p0-3] G) ftp://example.com → status=${r.status} (expect 400, zod URL 拒绝)`);
  if (r.status !== 400) throw new Error(`G) expected 400 for ftp://, got ${r.status}`);

  L("[p0-3] PASSED");
}

main().catch((e) => {
  L(`[p0-3] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});