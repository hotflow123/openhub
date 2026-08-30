import type { InputContract, MemeFastCatalog, MemeFastCatalogEntry } from "./types.js";

export function normalizeModelId(value: string): string {
  return value.toLowerCase().trim().replace(/[\s_\-/]+/g, " ");
}

export function catalogFromEntries(entries: readonly MemeFastCatalogEntry[]): MemeFastCatalog {
  return {
    find(modelId) {
      const exact = entries.find((entry) => entry.id === modelId);
      if (exact) return exact;
      const normalized = normalizeModelId(modelId);
      const matches = entries.filter((entry) =>
        [entry.id, ...(entry.aliases ?? [])].some((value) => normalizeModelId(value) === normalized),
      );
      return matches.length === 1 ? matches[0] : undefined;
    },
  };
}

export function mergeContract(base: InputContract, catalog?: Partial<InputContract>): InputContract {
  if (!catalog) return base;
  return {
    fields: [...new Set([...base.fields, ...(catalog.fields ?? [])])],
    requiredFields: [...new Set([...base.requiredFields, ...(catalog.requiredFields ?? [])])],
    enums: { ...base.enums, ...(catalog.enums ?? {}) },
    defaults: { ...(base.defaults ?? {}), ...(catalog.defaults ?? {}) },
  };
}
