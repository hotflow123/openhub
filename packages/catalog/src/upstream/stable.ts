/**
 * Adapted from anomalyco/models.dev (MIT License).
 * https://github.com/anomalyco/models.dev/blob/dev/packages/core/src/sync/index.ts
 */

/**
 * 对象稳定序列化 —— 用于判断两个 JSON 是否语义相等（忽略 key 顺序）
 */
export function stable(value: unknown): string {
  if (Array.isArray(value)) {
    const items = value.map(stable);
    const ordered = value.every((item) => item === null || typeof item !== "object")
      ? items.sort()
      : items;
    return `[${ordered.join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}