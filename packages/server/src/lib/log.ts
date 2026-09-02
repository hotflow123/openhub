/**
 * 极简结构化日志（不引入第三方库）。
 *
 * Phase 3B 起统一使用；Phase 1/2 现有 console.log/* 暂时共存。
 */

type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEY = /(api[_-]?key|authorization|cookie|password|secret|token|prompt|media|image|video|audio|file|url)/i;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const API_KEY_VALUE = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g;
const DATA_URL = /\bdata:[^\s"'<>]+/gi;
const MEDIA_URL = /\bhttps?:\/\/[^\s"'<>]+\.(?:mp4|mov|webm|mkv|png|jpe?g|gif|webp|mp3|wav|m4a|flac)(?:\?[^\s"'<>]*)?/gi;

export function sanitizeForLog(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return value
      .replace(BEARER_VALUE, "Bearer [REDACTED]")
      .replace(API_KEY_VALUE, "[REDACTED_KEY]")
      .replace(DATA_URL, "[REDACTED_DATA_URL]")
      .replace(MEDIA_URL, "[REDACTED_MEDIA_URL]");
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeForLog(value.message, "message", seen),
    };
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item, "", seen));
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeForLog(entryValue, entryKey, seen),
    ]),
  );
}

function emit(level: Level, msg: string, extra?: unknown): void {
  const record = {
    level,
    ts: Date.now(),
    msg,
    ...(extra && typeof extra === "object"
      ? { extra: sanitizeForLog(extra) }
      : extra != null
        ? { detail: sanitizeForLog(extra) }
        : {}),
  };
  // 一行 JSON，方便 stdout 收集
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, extra?: unknown) => emit("debug", msg, extra),
  info: (msg: string, extra?: unknown) => emit("info", msg, extra),
  warn: (msg: string, extra?: unknown) => emit("warn", msg, extra),
  error: (msg: string, extra?: unknown) => emit("error", msg, extra),
};
