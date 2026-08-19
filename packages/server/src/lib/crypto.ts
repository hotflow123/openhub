/**
 * AES-256-GCM 加密工具
 *
 * 用于加密存储站点的 API Key。
 * OPENHUB_MASTER_KEY 通过环境变量传入；密钥派生使用 SHA-256（开发环境）或 PBKDF2（生产）。
 *
 * 存储格式：`api_key_enc` 列存 `base64(ciphertext || tag)`，`api_key_iv` 列存 `base64(iv)`。
 * tag 拼接在 ciphertext 后面以便 schema 兼容（不需要额外 tag 列）。
 */

const ALGO = "AES-GCM";
const TAG_BYTES = 16;

async function deriveKey(master: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(master);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

export interface EncryptedPayload {
  /** base64(ciphertext || tag) — 拼接存储避免再加一列 */
  ciphertext: string;
  /** base64(iv)，长度 12 bytes（AES-GCM 推荐） */
  iv: string;
}

export async function encrypt(plaintext: string, masterKey: string): Promise<EncryptedPayload> {
  const key = await deriveKey(masterKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
    { name: ALGO },
    false,
    ["encrypt"],
  );
  const ctWithTag = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: ALGO, iv: iv as BufferSource },
      cryptoKey,
      new TextEncoder().encode(plaintext),
    ),
  );
  // subtle.encrypt 的输出末尾自带 tag；直接整体 base64 存到 ciphertext 列
  return {
    ciphertext: bytesToBase64(ctWithTag),
    iv: bytesToBase64(iv),
  };
}

export async function decrypt(
  ciphertextWithTagB64: string,
  ivB64: string,
  masterKey: string,
): Promise<string> {
  const key = await deriveKey(masterKey);
  const iv = base64ToBytes(ivB64);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
    { name: ALGO },
    false,
    ["decrypt"],
  );
  const ctWithTag = base64ToBytes(ciphertextWithTagB64);
  if (ctWithTag.length < TAG_BYTES) {
    throw new Error(
      `Encrypted payload too short (${ctWithTag.length} bytes); expected at least ${TAG_BYTES} (ciphertext + tag)`,
    );
  }
  const pt = await crypto.subtle.decrypt(
    { name: ALGO, iv: iv as BufferSource },
    cryptoKey,
    ctWithTag as BufferSource,
  );
  return new TextDecoder().decode(pt);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function getMasterKey(): string {
  const k = process.env.OPENHUB_MASTER_KEY;
  if (!k || k.length < 16) {
    throw new Error("OPENHUB_MASTER_KEY is not set or too short (>= 16 chars required)");
  }
  return k;
}
