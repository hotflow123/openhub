export interface MemeFastProtocolSource {
  id: string;
  url: string;
  kind: "documentation" | "runtime";
  enabled: boolean;
  status: "unverified" | "fetch_failed" | "json_manifest";
  note: string;
}

export const MEMEFAST_PROTOCOL_SOURCES: readonly MemeFastProtocolSource[] = [
  {
    id: "memefast-docs",
    url: "https://docs.memefast.cc/",
    kind: "documentation",
    enabled: true,
    status: "fetch_failed",
    note: "Primary MemeFast documentation source; fetch failed during the 2026-09-05 inventory.",
  },
  {
    id: "memefast-apifox",
    url: "https://memefast.apifox.cn",
    kind: "documentation",
    enabled: false,
    status: "fetch_failed",
    note: "Documentation mirror candidate; not used automatically.",
  },
  {
    id: "memefast-runtime-api",
    url: "https://api.memefast.cc/v1",
    kind: "runtime",
    enabled: false,
    status: "unverified",
    note: "Runtime base URL observed in repository material; not a protocol document.",
  },
];

export function findMemeFastProtocolSource(value: string): MemeFastProtocolSource | undefined {
  return MEMEFAST_PROTOCOL_SOURCES.find((source) => source.id === value || source.url === value);
}

export function isAllowedMemeFastProtocolUrl(sourceUrl: string, value: string): boolean {
  try {
    const source = new URL(sourceUrl);
    const target = new URL(value, source);
    const sourcePath = source.pathname.endsWith("/") ? source.pathname : `${source.pathname}/`;
    if (target.protocol !== source.protocol || target.origin !== source.origin) return false;
    if (target.username || target.password) return false;
    return target.pathname === source.pathname || target.pathname.startsWith(sourcePath);
  } catch {
    return false;
  }
}
