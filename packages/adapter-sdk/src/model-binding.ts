import type { EvidenceRef } from "./common";

export type ModelBindingMatch = "exact" | "normalized" | "alias" | "prefix";

export interface ModelBindingRule {
  match: ModelBindingMatch;
  values: string[];
  vendor?: string;
  evidence: EvidenceRef[];
}
