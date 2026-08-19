import { createHash } from "node:crypto";

export type AliasType = "exact" | "provider_id" | "slug" | "legacy";

export interface AliasEntry {
  id: string;
  catalogId: string;
  alias: string;
  normalized: string;
  aliasType: AliasType;
  priority: number;
}

export interface AliasDb {
  replaceAliases(rows: AliasEntry[]): Promise<void>;
}

export interface CatalogIdentity {
  id: string;
}

export function normalizeAlias(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[_\-/]/g, " ")
    .replace(/\s+/g, " ");
}

const LEGACY_ALIASES: Record<string, readonly string[]> = {
  "openai/gpt-4-turbo": [
    "gpt-4-turbo-preview",
    "gpt-4-1106-preview",
    "gpt-4-0125-preview",
  ],
  "openai/gpt-4o": ["chatgpt-4o", "gpt-4o-2024-05-13", "gpt-4o-2024-08-06"],
  "openai/gpt-4o-mini": ["gpt-4o-mini-2024-07-18"],
  "openai/gpt-3.5-turbo": ["gpt-3.5-t5", "gpt-3.5-turbo-1106"],
  "anthropic/claude-3-opus": ["claude-3-opus-20240229", "claude-opus"],
  "anthropic/claude-3-sonnet": ["claude-3-sonnet-20240229"],
  "anthropic/claude-3-haiku": ["claude-3-haiku-20240307"],
  "anthropic/claude-3-5-sonnet": [
    "claude-3-5-sonnet-20240620",
    "claude-3-5-sonnet-20241022",
  ],
  "anthropic/claude-3-5-haiku": ["claude-3-5-haiku-20241022"],
  "google/gemini-1.5-pro": ["gemini-1.5-pro-latest", "gemini-1.5-pro-002"],
  "google/gemini-1.5-flash": ["gemini-1.5-flash-latest", "gemini-1.5-flash-002"],
  "google/gemini-2.0-flash": ["gemini-2.0-flash-exp"],
};

function stableId(catalogId: string, alias: string): string {
  return createHash("sha256")
    .update(`${catalogId}\u0000${alias}`)
    .digest("hex")
    .slice(0, 24);
}

function providerModelId(catalogId: string): string | undefined {
  const separator = catalogId.indexOf("/");
  return separator === -1 ? undefined : catalogId.slice(separator + 1);
}

function slugVariants(value: string): string[] {
  return [value.replace(/-/g, "_"), value.replace(/[-_]/g, "")].filter(
    (variant) => variant !== value,
  );
}

/**
 * 生成具有稳定顺序和稳定 ID 的目录别名。
 * 相同别名仅保留字典序最靠前的 catalog 条目，避免同步结果随上游顺序漂移。
 */
export function buildAliases(catalogs: readonly CatalogIdentity[]): AliasEntry[] {
  const entries: AliasEntry[] = [];
  const claimed = new Set<string>();

  for (const catalog of [...catalogs].sort((a, b) => a.id.localeCompare(b.id))) {
    const append = (value: string, aliasType: AliasType, priority: number) => {
      const alias = value.toLowerCase();
      const normalized = normalizeAlias(alias);
      if (!normalized || claimed.has(normalized)) return;

      claimed.add(normalized);
      entries.push({
        id: stableId(catalog.id, normalized),
        catalogId: catalog.id,
        alias,
        normalized,
        aliasType,
        priority,
      });
    };

    append(catalog.id, "exact", 10);

    const providerId = providerModelId(catalog.id);
    if (providerId) {
      append(providerId, "provider_id", 20);
      for (const variant of slugVariants(providerId)) append(variant, "slug", 30);
    }

    for (const alias of LEGACY_ALIASES[catalog.id] ?? []) {
      append(alias, "legacy", 40);
    }
  }

  return entries;
}

export async function generateAliases(
  db: AliasDb,
  catalogs: readonly CatalogIdentity[],
): Promise<number> {
  const aliases = buildAliases(catalogs);
  await db.replaceAliases(aliases);
  return aliases.length;
}
