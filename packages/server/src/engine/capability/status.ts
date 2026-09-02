export type ProbeStatus =
  | "unknown"
  | "available"
  | "temporary_failure"
  | "forbidden"
  | "unsupported"
  | "request_invalid"
  | "contract_mismatch";

export function isProbeForCurrentConfig(
  probeRevision: number | null | undefined,
  siteRevision: number | null | undefined,
): boolean {
  return siteRevision != null && probeRevision === siteRevision;
}

export function classifyProbeFailure(status: number, message?: string): ProbeStatus {
  if (status === 404 && /(?:model|endpoint).*(?:not found|does not exist|不存在)|(?:not found|does not exist|不存在).*(?:model|endpoint)/i.test(message ?? "")) return "unsupported";
  if (status === 401 || status === 403) return "forbidden";
  if (status === 429 || status >= 500) return "temporary_failure";
  if (status >= 400) return "request_invalid";
  return "unknown";
}
