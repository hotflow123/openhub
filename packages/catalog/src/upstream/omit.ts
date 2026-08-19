/**
 * Adapted from anomalyco/models.dev (MIT License).
 * https://github.com/anomalyco/models.dev/blob/dev/packages/core/src/generate.ts
 */

/**
 * 按点路径深度删除字段（路径不命中则跳过；末尾父对象清空则一并删除）
 */
export function applyOmit(target: Record<string, unknown>, paths: string[]): void {
  omitLoop: for (const omit of paths) {
    const parts = omit.split(".");
    const parents: Array<{ value: Record<string, unknown>; key: string }> = [];
    let current = target;

    for (const part of parts.slice(0, -1)) {
      const next = current[part];
      if (next === undefined || next === null || typeof next !== "object" || Array.isArray(next)) {
        continue omitLoop;
      }
      parents.push({ value: current, key: part });
      current = next as Record<string, unknown>;
    }

    const lastPart = parts.at(-1);
    if (lastPart === undefined || !(lastPart in current)) continue;
    delete current[lastPart];

    for (let index = parents.length - 1; index >= 0; index--) {
      const parent = parents[index];
      if (parent === undefined) continue;
      const value = parent.value[parent.key];
      if (
        value === null ||
        value === undefined ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value as object).length > 0
      )
        break;
      delete parent.value[parent.key];
    }
  }
}