import type { MatchResult } from "../sync/types.js";

export interface ModelIdentityCandidate {
  id: string;
  name?: string | null;
  family?: string | null;
  modality?: string | null;
}

export interface MatcherDb {
  findCatalogById(id: string): Promise<{ id: string } | undefined>;
  findCatalogByNormalized(normalized: string): Promise<{ id: string } | undefined>;
  findCatalogAlias(alias: string): Promise<{ catalogId: string } | undefined>;
  findCatalogCandidates(): Promise<readonly ModelIdentityCandidate[]>;
}

export interface MatchOptions {
  modality?: string | null;
}

export interface ModelIdentity {
  namespace: string | null;
  family: string;
  version: string | null;
  sizes: string[];
  variants: string[];
  operations: string[];
}

export interface RankedCatalogCandidate {
  candidate: ModelIdentityCandidate;
  score: number;
  sharedTokens: string[];
  queryVersion: string | null;
  candidateVersion: string | null;
  versionMatch: boolean | null;
  queryIdentity: ModelIdentity;
  candidateIdentity: ModelIdentity;
}

const IGNORED_TOKENS = new Set([
  "ai",
  "api",
  "beta",
  "default",
  "exp",
  "experimental",
  "latest",
  "model",
  "models",
  "preview",
  "release",
  "stable",
  "test",
  "v",
]);

const OPERATION_TOKENS = new Set([
  "audio",
  "blend",
  "clone",
  "components",
  "custom",
  "describe",
  "edit",
  "editing",
  "embed",
  "embedding",
  "extend",
  "file",
  "files",
  "generate",
  "generation",
  "image",
  "inpaint",
  "lipsync",
  "mask",
  "modal",
  "motion",
  "music",
  "pan",
  "realtime",
  "rerank",
  "search",
  "speech",
  "stt",
  "text",
  "to",
  "transcribe",
  "tts",
  "upload",
  "upscale",
  "variation",
  "video",
  "voice",
  "zoom",
  "i2v",
  "r2v",
  "t2i",
  "t2v",
]);

const VERSION_PREFIXES = new Set(["m", "r", "v", "version"]);

export function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[_\-\/]/g, " ").replace(/\s+/g, " ");
}

function canonicalNumber(value: string): string {
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : String(number);
}

function canonicalVersion(parts: string[]): string | null {
  if (!parts.length) return null;
  const normalized = parts.map(canonicalNumber);
  while (normalized.length > 1 && normalized[normalized.length - 1] === "0") normalized.pop();
  return normalized.join(".");
}

function isFourDigitDate(value: string): boolean {
  const number = Number(value);
  if (number >= 1900 && number <= 2099) return true;
  const month = Number(value.slice(0, 2));
  const day = Number(value.slice(2));
  if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return true;
  const year = Number(value.slice(0, 2));
  return year >= 20 && Number(value.slice(2)) >= 1 && Number(value.slice(2)) <= 12;
}

function isDateToken(token: string): boolean {
  return /^\d{6,8}$/.test(token) || (/^\d{4}$/.test(token) && isFourDigitDate(token));
}

function stripTrailingReleaseDate(value: string): string {
  return value
    .replace(/(?:^|[-_.])\d{4}[-_.]\d{1,2}[-_.]\d{1,2}$/, "")
    .replace(/(?:^|[-_.])\d{6,8}$/, "")
    .replace(/(?:^|[-_.])\d{4}$/, (match) => (isFourDigitDate(match.slice(1)) ? "" : match));
}

function splitPath(value: string): { namespace: string | null; modelText: string } {
  const parts = value
    .toLowerCase()
    .trim()
    .split(/[\\/]+/)
    .filter(Boolean);
  if (parts.length <= 1) return { namespace: null, modelText: parts[0] ?? "" };
  if (parts.length === 2) return { namespace: parts[0], modelText: parts[1] };
  return { namespace: parts[0], modelText: parts.slice(1).join("-") };
}

function splitSegments(value: string): string[] {
  return stripTrailingReleaseDate(value)
    .replace(/[\s:]+/g, "-")
    .split(/[-_]+/)
    .filter(Boolean);
}

interface NumericSegment {
  prefix: string;
  version: string;
  suffix: string;
}

function parseNumericSegment(segment: string): NumericSegment | null {
  const match = segment.match(/^([a-z]*)(\d+(?:\.\d+)*)([a-z]*)$/i);
  if (!match) return null;
  return { prefix: match[1].toLowerCase(), version: match[2], suffix: match[3].toLowerCase() };
}

function parseSize(segment: string): string | null {
  const match = segment.match(/^([a-z]?\d+(?:\.\d+)?)([bmkgt])$/i);
  return match ? `${match[1].toLowerCase()}${match[2].toLowerCase()}` : null;
}

function normalizeIdentityToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function addIdentityToken(values: string[], value: string): void {
  const token = normalizeIdentityToken(value);
  if (!token || IGNORED_TOKENS.has(token) || isDateToken(token)) return;
  if (!values.includes(token)) values.push(token);
}

function splitVersionSuffix(value: string): string[] {
  return value.match(/[a-z]+|\d+/g)?.map(normalizeIdentityToken).filter(Boolean) ?? [];
}

export function parseModelIdentity(value: string): ModelIdentity {
  const { namespace, modelText } = splitPath(value);
  const segments = splitSegments(modelText);
  const familyTokens: string[] = [];
  const variants: string[] = [];
  const operations: string[] = [];
  const sizes: string[] = [];
  const versionParts: string[] = [];
  let versionIndex = -1;
  let versionEndIndex = -1;

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const size = parseSize(segment);
    if (size) {
      sizes.push(size);
      continue;
    }

    const numeric = parseNumericSegment(segment);
    if (!numeric) {
      const familyToken = normalizeIdentityToken(segment);
      if (familyToken && !IGNORED_TOKENS.has(familyToken) && !isDateToken(familyToken)) {
        familyTokens.push(familyToken);
      }
      continue;
    }

    versionIndex = index;
    if (numeric.prefix) {
      if (!familyTokens.length || !VERSION_PREFIXES.has(numeric.prefix)) {
        familyTokens.push(normalizeIdentityToken(numeric.prefix));
      }
    }
    versionParts.push(...splitVersionSuffix(numeric.version));
    if (numeric.suffix) addIdentityToken(variants, numeric.suffix);
    break;
  }

  if (versionIndex >= 0) {
    for (let index = versionIndex + 1; index < segments.length; index++) {
      const segment = segments[index];
      if (/^\d+(?:\.\d+)?$/.test(segment) && !isDateToken(segment)) {
        versionParts.push(segment);
        continue;
      }
      versionEndIndex = index;
      break;
    }
    if (versionEndIndex < 0) versionEndIndex = segments.length;
  }

  if (versionIndex >= 0) {
    for (let index = versionEndIndex; index < segments.length; index++) {
      const segment = segments[index];
      const size = parseSize(segment);
      if (size) {
        if (!sizes.includes(size)) sizes.push(size);
        continue;
      }
      for (const token of segment.match(/[a-z]+|\d+/gi) ?? []) {
        const normalized = normalizeIdentityToken(token);
        if (!normalized || IGNORED_TOKENS.has(normalized) || isDateToken(normalized)) continue;
        if (OPERATION_TOKENS.has(normalized)) {
          if (!operations.includes(normalized)) operations.push(normalized);
        } else {
          addIdentityToken(variants, normalized);
        }
      }
    }
  }

  return {
    namespace,
    family: familyTokens.filter(Boolean).join("-"),
    version: canonicalVersion(versionParts),
    sizes,
    variants,
    operations,
  };
}

export function extractModelVersion(value: string): string | null {
  return parseModelIdentity(value).version;
}

function modalityMatches(queryModality: string | null | undefined, candidate: ModelIdentityCandidate): boolean {
  if (!queryModality || queryModality === "unknown" || !candidate.modality) return true;
  return queryModality === candidate.modality;
}

function arrayEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function endsWith<T>(value: T[], suffix: T[]): boolean {
  return suffix.length <= value.length && suffix.every((item, index) => value[value.length - suffix.length + index] === item);
}

function familyCompatible(query: ModelIdentity, candidate: ModelIdentity): boolean {
  if (query.family === candidate.family) return true;
  const queryTokens = query.family.split("-").filter(Boolean);
  const candidateTokens = candidate.family.split("-").filter(Boolean);
  if (!queryTokens.length || !candidateTokens.length) return false;
  const shorter = queryTokens.length <= candidateTokens.length ? queryTokens : candidateTokens;
  const longer = shorter === queryTokens ? candidateTokens : queryTokens;
  if (!endsWith(longer, shorter)) return false;
  const prefix = longer.slice(0, longer.length - shorter.length);
  return prefix.length > 0 && prefix.every((token) => token.length >= 3 && !OPERATION_TOKENS.has(token));
}

function operationsCompatible(query: ModelIdentity, candidate: ModelIdentity): boolean {
  if (arrayEqual(query.operations, candidate.operations)) return true;
  if (query.operations.length > 0 || candidate.operations.length === 0) return false;
  return candidate.operations.length === 1 && candidate.operations[0] === "generate";
}

function identityCompatible(query: ModelIdentity, candidate: ModelIdentity): boolean {
  if (!familyCompatible(query, candidate)) return false;
  if (query.namespace && candidate.namespace && query.namespace !== candidate.namespace) return false;
  if (query.version !== candidate.version) return false;
  if (!arrayEqual(query.sizes, candidate.sizes)) return false;
  if (!arrayEqual(query.variants, candidate.variants)) return false;
  return operationsCompatible(query, candidate);
}

function rootScore(query: ModelIdentity, candidate: ModelIdentity): number {
  return query.family === candidate.family ? 1 : 0.94;
}

function identityScore(query: ModelIdentity, candidate: ModelIdentity): number {
  const score = rootScore(query, candidate);
  return candidate.operations.length > 0 && query.operations.length === 0 ? score - 0.02 : score;
}

function candidateIdentity(candidate: ModelIdentityCandidate): ModelIdentity {
  return parseModelIdentity(candidate.id);
}

export function rankModelCandidates(
  modelName: string,
  candidates: readonly ModelIdentityCandidate[],
  options: MatchOptions = {},
): RankedCatalogCandidate[] {
  const queryIdentity = parseModelIdentity(modelName);
  if (!queryIdentity.family) return [];

  return candidates
    .filter((candidate) => modalityMatches(options.modality, candidate))
    .map((candidate): RankedCatalogCandidate | null => {
      const identity = candidateIdentity(candidate);
      if (!identityCompatible(queryIdentity, identity)) return null;
      const sharedTokens = [
        ...queryIdentity.family.split("-"),
        ...(queryIdentity.version ? [queryIdentity.version] : []),
        ...queryIdentity.sizes,
        ...queryIdentity.variants,
        ...queryIdentity.operations,
      ].filter(Boolean);
      return {
        candidate,
        score: identityScore(queryIdentity, identity),
        sharedTokens,
        queryVersion: queryIdentity.version,
        candidateVersion: identity.version,
        versionMatch: queryIdentity.version === null && identity.version === null
          ? null
          : queryIdentity.version === identity.version,
        queryIdentity,
        candidateIdentity: identity,
      };
    })
    .filter((match): match is RankedCatalogCandidate => match !== null)
    .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id));
}

function directMatch(
  id: string,
  source: MatchResult["source"],
  confidence: number,
  candidatesById: Map<string, ModelIdentityCandidate>,
  modality: string | null | undefined,
): MatchResult | null {
  const candidate = candidatesById.get(id);
  if (candidate && !modalityMatches(modality, candidate)) return null;
  return { catalogModelId: id, confidence, source };
}

export async function matchModel(
  db: MatcherDb,
  modelName: string,
  options: MatchOptions = {},
): Promise<MatchResult> {
  const candidates = await db.findCatalogCandidates();
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  const exact = await db.findCatalogById(modelName);
  if (exact) {
    const result = directMatch(exact.id, "exact", 1.0, candidatesById, options.modality);
    if (result) return result;
  }

  const normalized = normalize(modelName);
  const norm = await db.findCatalogByNormalized(normalized);
  if (norm) {
    const result = directMatch(norm.id, "normalized", 0.95, candidatesById, options.modality);
    if (result) return result;
  }

  const alias = await db.findCatalogAlias(normalized);
  if (alias) {
    const result = directMatch(alias.catalogId, "alias", 0.9, candidatesById, options.modality);
    if (result) return result;
  }

  const ranked = rankModelCandidates(modelName, candidates, options);
  const [best, next] = ranked;
  if (!best || best.score < 0.9) return { catalogModelId: null, confidence: 0, source: null };

  const margin = next ? best.score - next.score : best.score;
  if (margin < 0.06) return { catalogModelId: null, confidence: 0, source: null };

  return {
    catalogModelId: best.candidate.id,
    confidence: Math.min(best.score, 0.99),
    source: "structured",
  };
}
