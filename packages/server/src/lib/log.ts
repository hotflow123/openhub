/**
 * 极简结构化日志（不引入第三方库）。
 *
 * Phase 3B 起统一使用；Phase 1/2 现有 console.log/* 暂时共存。
 */

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, extra?: unknown): void {
  const record = {
    level,
    ts: Date.now(),
    msg,
    ...(extra && typeof extra === "object" ? { extra } : extra != null ? { detail: extra } : {}),
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
