export interface SyncResult {
  runId: string;
  status: "success" | "failed";
  total: number;
  added: number;
  updated: number;
  removed: number;
  errorMessage?: string;
  durationMs: number;
}

export interface MatchResult {
  catalogModelId: string | null;
  confidence: number;
  source: "exact" | "normalized" | "alias" | "keyword" | null;
}