/**
 * 简单的内存速率限制器（per-key, per-minute 固定窗口）
 *
 * 设计选择：
 *  - 进程内 Map，不持久化：重启清零。生产环境如需多实例，应替换为 Redis。
 *  - 固定窗口（按 UTC 分钟），不是滑动窗口。优点：实现简单、O(1) 查询。
 *  - 仅在 hubKey.rateLimit > 0 时启用；null/0 表示不限速。
 *
 * 用法：
 *   const result = rateLimit.check(keyId, limit);
 *   if (!result.ok) return 429;
 */

interface Bucket {
  /** 当前窗口起始时间（毫秒） */
  windowStart: number;
  /** 当前窗口内请求计数 */
  count: number;
}

const buckets = new Map<string, Bucket>();

// 每 5 分钟清理一次过期 bucket，避免 Map 无限增长
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const WINDOW_MS = 60 * 1000;

let cleanupTimer: NodeJS.Timeout | null = null;

function ensureCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets.entries()) {
      if (now - b.windowStart >= WINDOW_MS * 2) {
        buckets.delete(k);
      }
    }
    cleanupTimer?.unref?.();
  }, CLEANUP_INTERVAL_MS);
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** 重置时间（unix 秒） */
  resetAt: number;
  retryAfterSec?: number;
}

/**
 * 检查并递增一个 key 的请求计数
 * @param keyId hub key id
 * @param limit 每分钟最大请求数；0 或 null 表示不限
 */
export function checkRateLimit(
  keyId: string,
  limit: number | null | undefined,
): RateLimitResult {
  ensureCleanup();

  if (!limit || limit <= 0) {
    // 不限速
    return { ok: true, limit: 0, remaining: -1, resetAt: 0 };
  }

  const now = Date.now();
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  let bucket = buckets.get(keyId);
  if (!bucket || bucket.windowStart !== windowStart) {
    bucket = { windowStart, count: 0 };
    buckets.set(keyId, bucket);
  }
  bucket.count++;

  const remaining = Math.max(0, limit - bucket.count);
  const resetAt = Math.floor((windowStart + WINDOW_MS) / 1000);
  if (bucket.count > limit) {
    const retryAfter = Math.ceil((windowStart + WINDOW_MS - now) / 1000);
    return { ok: false, limit, remaining: 0, resetAt, retryAfterSec: retryAfter };
  }
  return { ok: true, limit, remaining, resetAt };
}

/** 测试辅助：清空所有计数 */
export function _resetRateLimitBuckets(): void {
  buckets.clear();
}

/** 测试辅助：查询当前计数 */
export function _peekRateLimitBucket(keyId: string): { count: number; windowStart: number } | null {
  const b = buckets.get(keyId);
  return b ? { count: b.count, windowStart: b.windowStart } : null;
}