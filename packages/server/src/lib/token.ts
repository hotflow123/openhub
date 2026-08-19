import { createHash, randomBytes } from "node:crypto";

/**
 * 生成虚拟 Key 的明文、SHA-256 hash、显示前缀 + 后缀
 */
export function generateVirtualKey(): {
  raw: string;
  hash: string;
  prefix: string;
  suffix: string;
} {
  const random = randomBytes(24).toString("hex");
  const raw = "sk-openhub-" + random;
  const hash = createHash("sha256").update(raw).digest("hex");
  const prefix = "sk-openhub-" + random.slice(0, 8);
  const suffix = raw.slice(-4);
  return { raw, hash, prefix, suffix };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}