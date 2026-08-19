/**
 * URL 安全校验（SSRF 防护）
 *
 * 来源：DESIGN.md 第 11 章（"URL 安全校验"）
 *
 * 适用范围：
 *  - sites.baseUrl（用户录入）
 *  - tasks.callback_url（已部分实现 https 检查）
 *  - catalog 同步 URL（当前只从 env 读，后续可能接受用户输入）
 *
 * 策略：
 *  1. URL 必须能解析（new URL）
 *  2. callback 强制 https
 *  3. hostname 不能是私网/回环/链路本地（除非 dev 模式显式允许 localhost）
 *  4. 转发请求时禁重定向 + 强制超时
 */

import { lookup } from "node:dns/promises";

const PRIVATE_IPV4_RANGES = [
  { start: [10, 0, 0, 0], end: [10, 255, 255, 255] }, // 10.0.0.0/8
  { start: [172, 16, 0, 0], end: [172, 31, 255, 255] }, // 172.16.0.0/12
  { start: [192, 168, 0, 0], end: [192, 168, 255, 255] }, // 192.168.0.0/16
  { start: [127, 0, 0, 0], end: [127, 255, 255, 255] }, // 127.0.0.0/8 (loopback)
  { start: [169, 254, 0, 0], end: [169, 254, 255, 255] }, // 169.254.0.0/16 (link-local)
  { start: [0, 0, 0, 0], end: [0, 255, 255, 255] }, // 0.0.0.0/8
  { start: [100, 64, 0, 0], end: [100, 127, 255, 255] }, // 100.64.0.0/10 (carrier-grade NAT)
  { start: [224, 0, 0, 0], end: [239, 255, 255, 255] }, // 224.0.0.0/4 (multicast)
  { start: [240, 0, 0, 0], end: [255, 255, 255, 255] }, // 240.0.0.0/4 (reserved)
];

function ipv4ToInt(parts: number[]): number {
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p))) return false;
  const int = ipv4ToInt(parts);
  for (const range of PRIVATE_IPV4_RANGES) {
    if (int >= ipv4ToInt(range.start) && int <= ipv4ToInt(range.end)) return true;
  }
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  // 简化判断：loopback ::1, link-local fe80::/10, unique-local fc00::/7, ::ffff:0:0/96 (IPv4-mapped)
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  if (lower === "::") return true;
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  // IPv4-mapped IPv6: ::ffff:x.x.x.x
  const mapped = lower.match(/^::ffff:([0-9.]+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) return isPrivateIPv6(ip);
  return isPrivateIPv4(ip);
}

/**
 * 校验 URL 不指向私网/回环
 * 异步：需要解析 hostname（DNS 查询可能指向公网 IP 或私网 IP）
 *
 * @param urlStr 用户输入的 URL
 * @param options.allowPrivateIp true 则放行私网/回环（仅 dev 模式）
 * @param options.requireHttps true 则强制 https
 */
export interface ValidateUrlOptions {
  allowPrivateIp?: boolean;
  requireHttps?: boolean;
}

export async function validateUrl(
  urlStr: string,
  options: ValidateUrlOptions = {},
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`);
  }

  if (options.requireHttps && parsed.protocol !== "https:") {
    throw new Error(`URL must use https:// (got ${parsed.protocol})`);
  }

  // hostname 不能为空
  const host = parsed.hostname;
  if (!host) throw new Error(`URL has no hostname: ${urlStr}`);

  // 0. IP 字面量检查（始终按私网规则判断，allowPrivateIp 不能绕过）
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    if (isPrivateIPv4(host)) throw new Error(`URL points to private IP: ${host}`);
    return;
  }
  if (host.startsWith("[") && host.endsWith("]")) {
    const ip = host.slice(1, -1);
    if (isPrivateIPv6(ip)) throw new Error(`URL points to private IP: ${ip}`);
    return;
  }

  // dev 模式：放行 localhost / 内网域名（仅 DNS 解析阶段判断）
  if (options.allowPrivateIp) return;

  // 1. DNS 解析
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch (e) {
    throw new Error(`DNS lookup failed for ${host}: ${e instanceof Error ? e.message : String(e)}`);
  }

  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new Error(`URL resolves to private IP: ${host} → ${a.address}`);
    }
  }
}

/**
 * 同步版本（仅检查 host 字符串本身是否是 IP，不查 DNS）
 * 用于"已经解析过的 IP"或"内部分配的 URL"等场景
 */
export function validateUrlSync(
  urlStr: string,
  options: ValidateUrlOptions = {},
): void {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`);
  }

  if (options.requireHttps && parsed.protocol !== "https:") {
    throw new Error(`URL must use https:// (got ${parsed.protocol})`);
  }

  // IP 字面量始终按私网规则判断（不允许 allowPrivateIp 绕过）
  // 这是为了防止 IP 字面量绕过 dev 模式的"localhost 放行"
  const host = parsed.hostname;
  if (!host) throw new Error(`URL has no hostname: ${urlStr}`);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    if (isPrivateIPv4(host)) throw new Error(`URL points to private IP: ${host}`);
    return;
  }
  if (host.startsWith("[") && host.endsWith("]")) {
    const ip = host.slice(1, -1);
    if (isPrivateIPv6(ip)) throw new Error(`URL points to private IP: ${ip}`);
    return;
  }

  // allowPrivateIp 模式：放行 localhost / 私网域名
  if (options.allowPrivateIp) return;

  // 严格模式：常见内网域名也拒绝
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) {
    throw new Error(`URL points to localhost: ${host}`);
  }
}

/**
 * 转发请求时的安全 fetch：禁重定向 + 强制超时
 */
export async function safeFetch(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 30_000, ...rest } = init;
  return await fetch(url, {
    ...rest,
    redirect: "error", // 禁止重定向（防 SSRF 重定向到内网）
    signal: AbortSignal.timeout(timeoutMs),
  });
}