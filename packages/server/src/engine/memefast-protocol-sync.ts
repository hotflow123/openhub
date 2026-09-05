import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import type { ProtocolCatalogRow } from "../db/schema/memefast-protocols";
import { findMemeFastProtocolSource, isAllowedMemeFastProtocolUrl } from "../lib/memefast-sources";

export interface ProtocolDocument {
  protocolId: string;
  version: string;
  name?: string;
  sourceUrl?: string;
  sourceDocs?: string[];
  sourceVersion?: string;
  modality?: "llm" | "image" | "audio" | "video" | "embedding" | "unknown";
  modelNames?: string[];
  operations: unknown[];
  requestContract?: unknown;
  responseContract?: unknown;
  statusMapping?: unknown;
  parameterMapping?: unknown;
}

export interface ProtocolStore {
  findByIdentity(protocolId: string, version: string): Promise<ProtocolCatalogRow[]>;
  insertProtocol(row: Record<string, unknown>): Promise<void>;
  insertRun(row: Record<string, unknown>): Promise<void>;
}

export interface ProtocolDiff {
  status: "added" | "changed" | "unchanged";
  changedFields: string[];
  previousHash: string | null;
}

export interface ProtocolSyncResult {
  status: "success" | "partial" | "failed";
  recordId?: string;
  protocolId?: string;
  version?: string;
  diff?: ProtocolDiff;
  errorMessage?: string;
  runId: string;
  added: number;
  changed: number;
  unparsed: number;
  failed: number;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function hashDocument(document: ProtocolDocument): string {
  return createHash("sha256").update(stableJson(document)).digest("hex");
}

function parseDocument(value: unknown): ProtocolDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("protocol document must be an object");
  }
  const document = value as Record<string, unknown>;
  if (typeof document.protocolId !== "string" || !document.protocolId.trim()) {
    throw new Error("protocolId is required");
  }
  if (typeof document.version !== "string" || !document.version.trim()) {
    throw new Error("version is required");
  }
  if (!Array.isArray(document.operations)) {
    throw new Error("operations must be an array");
  }
  return {
    protocolId: document.protocolId.trim(),
    version: document.version.trim(),
    name: typeof document.name === "string" ? document.name : document.protocolId,
    sourceUrl: typeof document.sourceUrl === "string" ? document.sourceUrl : undefined,
    sourceDocs: Array.isArray(document.sourceDocs)
      ? document.sourceDocs.filter((item): item is string => typeof item === "string")
      : [],
    sourceVersion: typeof document.sourceVersion === "string" ? document.sourceVersion : undefined,
    modality: document.modality === "llm" ||
      document.modality === "image" ||
      document.modality === "audio" ||
      document.modality === "video" ||
      document.modality === "embedding" ||
      document.modality === "unknown"
      ? document.modality
      : "unknown",
    modelNames: Array.isArray(document.modelNames)
      ? document.modelNames.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        )
      : [],
    operations: document.operations,
    requestContract: document.requestContract ?? {},
    responseContract: document.responseContract ?? {},
    statusMapping: document.statusMapping ?? {},
    parameterMapping: document.parameterMapping ?? {},
  };
}

function htmlEntityDecode(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(value: string): string {
  return htmlEntityDecode(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function isReferenceLink(label: string, href: string): boolean {
  if (/\breference\b/i.test(label)) return true;
  return /(?:^|[/#._-])(?:api[-_ ]?)?reference(?:[/#._-]|$)/i.test(href);
}

export function extractMemeFastReferenceLinks(html: string, sourceUrl: string): string[] {
  const source = new URL(sourceUrl);
  const links = new Set<string>();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  const hrefPattern = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

  for (const match of html.matchAll(anchorPattern)) {
    const attributes = match[1] ?? "";
    const hrefMatch = attributes.match(hrefPattern);
    if (!hrefMatch) continue;
    const href = htmlEntityDecode(hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? "").trim();
    const label = stripHtml(match[2] ?? "");
    if (!href || !isReferenceLink(label, href)) continue;
    try {
      const resolved = new URL(href, source);
      if (!isAllowedMemeFastProtocolUrl(sourceUrl, resolved.toString())) continue;
      resolved.hash = "";
      links.add(resolved.toString());
    } catch {
      continue;
    }
  }
  return [...links];
}

export function extractMemeFastJsonBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const scriptPattern = /<script\b[^>]*\btype\s*=\s*["']application\/json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
  const fencedPattern = /```json\s*([\s\S]*?)```/gi;

  for (const match of html.matchAll(scriptPattern)) {
    try {
      blocks.push(JSON.parse((match[1] ?? "").trim()));
    } catch {
      blocks.push(undefined);
    }
  }
  for (const match of html.matchAll(fencedPattern)) {
    try {
      blocks.push(JSON.parse((match[1] ?? "").trim()));
    } catch {
      blocks.push(undefined);
    }
  }
  return blocks;
}

function htmlAttribute(attributes: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = attributes.match(pattern);
  return match ? htmlEntityDecode(match[1] ?? match[2] ?? match[3] ?? "").trim() : undefined;
}

export function extractMemeFastModuleScriptUrls(html: string, sourceUrl: string): string[] {
  const source = new URL(sourceUrl);
  const scripts = new Set<string>();
  for (const match of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attributes = match[1] ?? "";
    if (htmlAttribute(attributes, "type")?.toLowerCase() !== "module") continue;
    const src = htmlAttribute(attributes, "src");
    if (!src) continue;
    try {
      const resolved = new URL(src, source);
      if (!isAllowedMemeFastProtocolUrl(sourceUrl, resolved.toString())) continue;
      resolved.hash = "";
      scripts.add(resolved.toString());
    } catch {
      continue;
    }
  }
  return [...scripts];
}

function readJavaScriptString(source: string, start: number): { value: string; end: number } | undefined {
  const quote = source[start];
  if (quote !== "'" && quote !== '"') return undefined;
  let value = "";
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === quote) return { value, end: index + 1 };
    if (character !== "\\") {
      value += character;
      continue;
    }
    const escape = source[index + 1];
    if (!escape) return undefined;
    const simpleEscapes: Record<string, string> = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
      "0": "\0",
      "\\": "\\",
      "'": "'",
      '"': '"',
    };
    if (escape in simpleEscapes) {
      value += simpleEscapes[escape];
      index += 1;
      continue;
    }
    if (escape === "u" || escape === "x") {
      const length = escape === "u" ? 4 : 2;
      const digits = source.slice(index + 2, index + 2 + length);
      if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(digits)) return undefined;
      value += String.fromCodePoint(Number.parseInt(digits, 16));
      index += length + 1;
      continue;
    }
    if (escape === "\n") {
      index += 1;
      continue;
    }
    if (escape === "\r" && source[index + 2] === "\n") {
      index += 2;
      continue;
    }
    return undefined;
  }
  return undefined;
}

export function extractMemeFastJsonParseBindings(source: string): {
  bindings: Map<"JT" | "RN", unknown>;
  unparsed: number;
} {
  const bindings = new Map<"JT" | "RN", unknown>();
  let unparsed = 0;
  const assignmentPattern = /\b(?:const|let|var)\s+(JT|RN)\s*=\s*JSON\.parse\s*\(/g;
  for (const match of source.matchAll(assignmentPattern)) {
    const variable = match[1] as "JT" | "RN";
    const start = (match.index ?? 0) + match[0].length;
    const parsed = readJavaScriptString(source, start + (source.slice(start).match(/^\s*/)?.[0].length ?? 0));
    if (!parsed) {
      unparsed += 1;
      continue;
    }
    try {
      bindings.set(variable, JSON.parse(parsed.value));
    } catch {
      unparsed += 1;
    }
  }
  return { bindings, unparsed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" && value[key].trim() ? value[key].trim() : undefined;
}

interface DirectoryOperation {
  apifoxApiId: string;
  path: string;
  method: string;
  platform?: string;
  modality: ProtocolDocument["modality"];
  value: Record<string, unknown>;
}

function inferMemeFastModality(
  value: Record<string, unknown>,
  platform?: string,
  detail?: Record<string, unknown>,
): ProtocolDocument["modality"] {
  const text = [
    platform,
    stringField(value, "id"),
    stringField(value, "path"),
    stringField(value, "summary"),
    stringField(detail ?? {}, "summary"),
  ].filter(Boolean).join(" ").toLowerCase();
  if (/(video|视频|seedance|veo|kling|sora|pixverse|vidu|runway|luma|hailuo)/i.test(text)) return "video";
  if (/(audio|音频|语音|音乐|suno|speech|tts|voice)/i.test(text)) return "audio";
  if (/(image|图像|图片|绘图|ideogram|flux|dall)/i.test(text)) return "image";
  if (/(embedding|rerank|嵌入|重排序)/i.test(text)) return "embedding";
  if (/(chat|completion|messages|文本|对话|llm|gemini|claude|deepseek|openai)/i.test(text)) return "llm";
  return "unknown";
}

function collectDirectoryOperations(
  value: unknown,
  operations: DirectoryOperation[],
  unparsed: { count: number },
  inheritedPlatform?: string,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectDirectoryOperations(item, operations, unparsed, inheritedPlatform);
    return;
  }
  if (!isRecord(value)) return;
  const platform = stringField(value, "platform") ?? inheritedPlatform;
  const apifoxApiId = stringField(value, "apifoxApiId");
  if (apifoxApiId) {
    const path = stringField(value, "path");
    const method = stringField(value, "method");
    if (!path || !method) {
      unparsed.count += 1;
    } else {
      operations.push({
        apifoxApiId,
        path,
        method,
        platform,
        modality: inferMemeFastModality(value, platform),
        value,
      });
    }
    return;
  }
  for (const child of Object.values(value)) {
    collectDirectoryOperations(child, operations, unparsed, platform);
  }
}

function normalizeProtocolGroup(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function knownModality(value: unknown): ProtocolDocument["modality"] {
  return value === "llm" ||
    value === "image" ||
    value === "audio" ||
    value === "video" ||
    value === "embedding" ||
    value === "unknown"
    ? value
    : "unknown";
}

function collectExplicitModelNames(
  value: unknown,
  keyHint: string,
  names: Set<string>,
  modelContext = false,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectExplicitModelNames(item, keyHint, names, modelContext);
    return;
  }
  if (!isRecord(value)) {
    if (keyHint.toLowerCase() === "model" && typeof value === "string" && value.trim()) {
      names.add(value.trim());
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (
      typeof child === "string" &&
      ["value", "request", "body"].includes(normalizedKey)
    ) {
      collectModelNamesFromDescription(child, names, false, false);
    }
    if (
      modelContext &&
      typeof child === "string" &&
      ["description", "example", "examples"].includes(normalizedKey)
    ) {
      collectModelNamesFromDescription(child, names);
    }
    const isModelKey = normalizedKey === "model" ||
      normalizedKey === "model_name" ||
      normalizedKey === "modelname";
    if (
      isModelKey &&
      typeof child === "string" &&
      child.trim()
    ) {
      names.add(child.trim());
      continue;
    }
    if (
      normalizedKey === "enum" &&
      keyHint.toLowerCase() === "model" &&
      Array.isArray(child)
    ) {
      for (const item of child) {
        if (typeof item === "string" && item.trim()) names.add(item.trim());
      }
      continue;
    }
    if (
      isModelKey &&
      isRecord(child)
    ) {
      collectModelNamesFromDescription(child.description, names);
      collectModelNamesFromDescription(child.example, names);
      collectModelNamesFromDescription(child.examples, names);
    }
    collectExplicitModelNames(child, normalizedKey, names, modelContext || isModelKey);
  }
}

function collectModelNamesFromDescription(
  value: unknown,
  names: Set<string>,
  allowStandaloneQuoted = true,
  allowLabeled = true,
): void {
  if (typeof value !== "string") {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectModelNamesFromDescription(item, names, allowStandaloneQuoted, allowLabeled);
      }
    }
    return;
  }
  const quoted = /["'`]([a-z][a-z0-9._/-]{1,80})["'`]/gi;
  const labeled = /(?:["']?model(?:\s+name)?["']?|模型名称|模型名|示例值|固定值|可选值)\s*[:：]\s*["'`]?\s*([a-z][a-z0-9._/-]{1,100})/gi;
  const jsonModel = /["']model["']\s*:\s*["']([a-z][a-z0-9._/-]{1,100})["']/gi;
  const add = (candidate: string) => {
    if (!/^(?:https?|www)$/i.test(candidate)) names.add(candidate);
  };
  if (allowStandaloneQuoted) {
    for (const match of value.matchAll(quoted)) add(match[1]);
  }
  if (allowLabeled) {
    for (const match of value.matchAll(labeled)) add(match[1]);
  }
  for (const match of value.matchAll(jsonModel)) add(match[1]);
}

export function extractProtocolModelNames(document: ProtocolDocument): string[] {
  const names = new Set<string>();
  for (const operation of document.operations) {
    collectExplicitModelNames(operation, "", names);
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

export function buildMemeFastProtocolDocuments(
  bundles: string[],
  sourceUrl: string,
  sourceDocs: string[],
  sourceHash: string,
): { documents: ProtocolDocument[]; unparsed: number } {
  const directories: DirectoryOperation[] = [];
  const details = new Map<string, Record<string, unknown>>();
  const unparsed = { count: 0 };
  let hasDirectoryBinding = false;
  let hasDetailBinding = false;

  for (const bundle of bundles) {
    const { bindings, unparsed: bindingErrors } = extractMemeFastJsonParseBindings(bundle);
    unparsed.count += bindingErrors;
    const directory = bindings.get("JT");
    if (directory !== undefined) {
      hasDirectoryBinding = true;
      collectDirectoryOperations(directory, directories, unparsed);
    }
    const detailTable = bindings.get("RN");
    if (isRecord(detailTable)) {
      hasDetailBinding = true;
      for (const [key, value] of Object.entries(detailTable)) {
        if (!isRecord(value)) {
          unparsed.count += 1;
          continue;
        }
        if (details.has(key)) unparsed.count += 1;
        else details.set(key, value);
      }
    } else if (detailTable !== undefined) {
      hasDetailBinding = true;
      unparsed.count += 1;
    }
  }
  if (!hasDirectoryBinding) unparsed.count += 1;
  if (!hasDetailBinding) unparsed.count += 1;

  const grouped = new Map<string, ProtocolDocument["operations"]>();
  const associatedDetails = new Set<string>();
  for (const operation of directories) {
    const detail = details.get(operation.apifoxApiId);
    if (detail) associatedDetails.add(operation.apifoxApiId);
    const platform = operation.platform ?? (detail ? stringField(detail, "platform") : undefined);
    if (!platform) {
      unparsed.count += 1;
      continue;
    }
    const modality = inferMemeFastModality(operation.value, platform, detail);
    const operationDocument: Record<string, unknown> = {
      apifoxApiId: operation.apifoxApiId,
      path: operation.path,
      method: operation.method,
      platform,
      modality,
      directoryOperation: operation.value,
      ...(detail ? { detail } : {}),
    };
    if (modality === "video") {
      const method = operation.method.toUpperCase();
      const path = operation.path.toLowerCase();
      if (method === "POST" && /(generation|generate|create|submit)/.test(path)) {
        operationDocument.operationRole = "video.submit";
      } else if (method === "GET" && /(query|task|status|result)/.test(path)) {
        operationDocument.operationRole = "video.query";
      }
    }
    for (const key of ["summary"] as const) {
      const value = stringField(operation.value, key) ?? stringField(detail ?? {}, key);
      if (value !== undefined) operationDocument[key] = value;
    }
    for (const key of ["requestBody", "responses", "requestExamples", "deprecated"] as const) {
      if (detail && key in detail) operationDocument[key] = detail[key];
      else if (key in operation.value) operationDocument[key] = operation.value[key];
    }
    for (const key of [
      "responseExamples",
      "requestHeaders",
      "responseHeaders",
      "queryParams",
      "pathParams",
    ] as const) {
      if (detail && key in detail) operationDocument[key] = detail[key];
      else if (key in operation.value) operationDocument[key] = operation.value[key];
    }
    const group = `${normalizeProtocolGroup(platform)}.${modality}`;
    const groupOperations = grouped.get(group) ?? [];
    groupOperations.push(operationDocument);
    grouped.set(group, groupOperations);
  }
  for (const key of details.keys()) {
    if (!associatedDetails.has(key)) unparsed.count += 1;
  }

  const documents: ProtocolDocument[] = [];
  for (const [group, operations] of grouped) {
    const document: ProtocolDocument = {
      protocolId: `memefast.${group}`,
      version: `source-${sourceHash.slice(0, 16)}`,
      name: group,
      sourceUrl,
      sourceDocs,
      sourceVersion: sourceHash,
      modality: knownModality((operations[0] as Record<string, unknown>).modality),
      modelNames: [],
      operations,
      requestContract: {
        operations: operations.map((operation) => {
          const item = operation as Record<string, unknown>;
          return {
            apifoxApiId: item.apifoxApiId,
            requestBody: item.requestBody,
          };
        }),
      },
      responseContract: {
        operations: operations.map((operation) => {
          const item = operation as Record<string, unknown>;
          return {
            apifoxApiId: item.apifoxApiId,
            responses: item.responses,
            responseExamples: item.responseExamples,
          };
        }),
      },
    };
    document.modelNames = extractProtocolModelNames(document);
    documents.push(document);
  }
  return { documents, unparsed: unparsed.count };
}

function diffDocument(previous: ProtocolCatalogRow | undefined, document: ProtocolDocument, contentHash: string): ProtocolDiff {
  if (!previous) return { status: "added", changedFields: [], previousHash: null };
  if (previous.contentHash === contentHash) return { status: "unchanged", changedFields: [], previousHash: contentHash };
  const previousDocument = JSON.parse(previous.rawDocument) as Record<string, unknown>;
  const currentDocument = document as unknown as Record<string, unknown>;
  const changedFields = Object.keys(currentDocument).filter((field) =>
    stableJson(previousDocument[field]) !== stableJson(currentDocument[field]));
  return { status: "changed", changedFields, previousHash: previous.contentHash };
}

export async function importProtocolDocument(
  input: unknown,
  store: ProtocolStore,
  options: { sourceUrl: string; fetchedAt?: Date; triggeredBy?: "auto" | "manual" },
): Promise<ProtocolSyncResult> {
  const runId = nanoid();
  const startedAt = Date.now();
  try {
    const document = parseDocument(input);
    const sourceUrl = options.sourceUrl || document.sourceUrl;
    if (!sourceUrl) throw new Error("sourceUrl is required");
    const contentHash = hashDocument(document);
    const existing = await store.findByIdentity(document.protocolId, document.version);
    const sameContent = existing.find((row) => row.contentHash === contentHash);
    const previous = sameContent ?? existing[0];
    const diff = diffDocument(previous, document, contentHash);
    if (diff.status === "unchanged") {
      await store.insertRun({
        id: runId,
        sourceUrl,
        startedAt: Math.floor(startedAt / 1000),
        finishedAt: Math.floor(Date.now() / 1000),
        fetchedAt: Math.floor((options.fetchedAt ?? new Date()).getTime() / 1000),
        contentHash,
        sourceVersion: document.sourceVersion ?? null,
        status: "success",
        diff: JSON.stringify(diff),
        triggeredBy: options.triggeredBy ?? "manual",
      });
      return {
        status: "success",
        recordId: previous?.recordId,
        protocolId: document.protocolId,
        version: document.version,
        diff,
        runId,
        added: 0,
        changed: 0,
        unparsed: 0,
        failed: 0,
      };
    }
    const recordId = createHash("sha256")
      .update(`${document.protocolId}\0${document.version}\0${contentHash}`)
      .digest("hex")
      .slice(0, 32);
    await store.insertProtocol({
      recordId,
      protocolId: document.protocolId,
      version: document.version,
      name: document.name ?? document.protocolId,
      sourceUrl,
      sourceDocs: JSON.stringify(document.sourceDocs ?? []),
      sourceVersion: document.sourceVersion ?? null,
      modality: document.modality ?? "unknown",
      operations: JSON.stringify(document.operations),
      requestContract: JSON.stringify(document.requestContract ?? {}),
      responseContract: JSON.stringify(document.responseContract ?? {}),
      statusMapping: JSON.stringify(document.statusMapping ?? {}),
      parameterMapping: JSON.stringify(document.parameterMapping ?? {}),
      evidenceStatus: "imported",
      status: diff.status === "changed" ? "changed" : "imported",
      enabled: false,
      fetchedAt: options.fetchedAt ?? new Date(),
      contentHash,
      previousHash: diff.previousHash,
      diffStatus: diff.status,
      rawDocument: JSON.stringify(document),
      updatedAt: new Date(),
    });
    await store.insertRun({
      id: runId,
      sourceUrl,
      startedAt: Math.floor(startedAt / 1000),
      finishedAt: Math.floor(Date.now() / 1000),
      fetchedAt: Math.floor((options.fetchedAt ?? new Date()).getTime() / 1000),
      contentHash,
      sourceVersion: document.sourceVersion ?? null,
      status: "success",
      addedCount: diff.status === "added" ? 1 : 0,
      changedCount: diff.status === "changed" ? 1 : 0,
      diff: JSON.stringify(diff),
      triggeredBy: options.triggeredBy ?? "manual",
    });
    return {
      status: "success",
      recordId,
      protocolId: document.protocolId,
      version: document.version,
      diff,
      runId,
      added: diff.status === "added" ? 1 : 0,
      changed: diff.status === "changed" ? 1 : 0,
      unparsed: 0,
      failed: 0,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await store.insertRun({
      id: runId,
      sourceUrl: options.sourceUrl,
      startedAt: Math.floor(startedAt / 1000),
      finishedAt: Math.floor(Date.now() / 1000),
      fetchedAt: null,
      contentHash: null,
      sourceVersion: null,
      status: "failed",
      errorMessage,
      diff: "{}",
      triggeredBy: options.triggeredBy ?? "manual",
    });
    return { status: "failed", errorMessage, runId, added: 0, changed: 0, unparsed: 0, failed: 1 };
  }
}

async function recordSyncRun(
  store: ProtocolStore,
  sourceUrl: string,
  startedAt: number,
  fetchedAt: Date | null,
  summary: Pick<ProtocolSyncResult, "added" | "changed" | "unparsed" | "failed">,
  errors: string[],
  contentHash?: string | null,
): Promise<string> {
  const runId = nanoid();
  await store.insertRun({
    id: runId,
    sourceUrl,
    startedAt: Math.floor(startedAt / 1000),
    finishedAt: Math.floor(Date.now() / 1000),
    fetchedAt: fetchedAt ? Math.floor(fetchedAt.getTime() / 1000) : null,
    contentHash: contentHash ?? null,
    sourceVersion: null,
    status: summary.failed > 0 ? "failed" : summary.unparsed > 0 ? "partial" : "success",
    addedCount: summary.added,
    changedCount: summary.changed,
    unparsedCount: summary.unparsed,
    diff: JSON.stringify(summary),
    errorMessage: errors.length > 0 ? errors.join("; ") : null,
    triggeredBy: "manual",
  });
  return runId;
}

function failedSourceResult(errorMessage: string, sourceUrl: string, store: ProtocolStore, startedAt: number): Promise<ProtocolSyncResult> {
  return recordSyncRun(
    store,
    sourceUrl,
    startedAt,
    null,
    { added: 0, changed: 0, unparsed: 0, failed: 1 },
    [errorMessage],
  ).then((runId) => ({
    status: "failed",
    errorMessage,
    runId,
    added: 0,
    changed: 0,
    unparsed: 0,
    failed: 1,
  }));
}

async function readResponse(response: Response): Promise<{ text: string; fetchedAt: Date; contentType: string }> {
  if (!response.ok) throw new Error(`protocol source HTTP ${response.status}`);
  return {
    text: await response.text(),
    fetchedAt: new Date(),
    contentType: response.headers.get("content-type") ?? "",
  };
}

function parseFetchedManifests(text: string, contentType: string): { manifests: unknown[]; isJson: boolean } {
  const isJson = /(?:^|\s|;)application\/json(?:\s|;|$)/i.test(contentType) ||
    /^\s*[\[{]/.test(text);
  if (isJson) {
    try {
      return { manifests: [JSON.parse(text)], isJson: true };
    } catch {
      return { manifests: [undefined], isJson: true };
    }
  }
  return { manifests: extractMemeFastJsonBlocks(text), isJson: false };
}

export async function syncProtocolSource(
  source: string,
  store: ProtocolStore,
  fetcher: typeof fetch = fetch,
): Promise<ProtocolSyncResult> {
  const trusted = findMemeFastProtocolSource(source);
  if (!trusted || !trusted.enabled) {
    return failedSourceResult("source is not an enabled allow-listed MemeFast source", source, store, Date.now());
  }
  const startedAt = Date.now();
  const summary = { added: 0, changed: 0, unparsed: 0, failed: 0 };
  const errors: string[] = [];
  let importedResult: ProtocolSyncResult | undefined;
  let importedCount = 0;
  let fetchedAt: Date | null = null;
  let sourceContentHash: string | null = null;
  const bundleTexts: string[] = [];
  const sourceDocs = [trusted.url];

  const fetchPage = async (url: string) => {
    const response = await fetcher(url, {
      headers: { Accept: "text/html, application/json" },
      signal: AbortSignal.timeout(15000),
    });
    return readResponse(response);
  };

  try {
    const root = await fetchPage(trusted.url);
    fetchedAt = root.fetchedAt;
    const rootPayload = parseFetchedManifests(root.text, root.contentType);

    const pages: Array<{
      url: string;
      text: string;
      fetchedAt: Date;
      manifests: unknown[];
      isDirectory: boolean;
    }> = [];
    if (rootPayload.isJson) {
      pages.push({
        url: trusted.url,
        text: root.text,
        fetchedAt: root.fetchedAt,
        manifests: rootPayload.manifests,
        isDirectory: false,
      });
    } else {
      const moduleUrls = extractMemeFastModuleScriptUrls(root.text, trusted.url);
      const referenceLinks = extractMemeFastReferenceLinks(root.text, trusted.url);
      pages.push({
        url: trusted.url,
        text: root.text,
        fetchedAt: root.fetchedAt,
        manifests: rootPayload.manifests,
        isDirectory: moduleUrls.length > 0 || referenceLinks.length > 0,
      });
      for (const moduleUrl of moduleUrls) {
        try {
          const asset = await fetchPage(moduleUrl);
          bundleTexts.push(asset.text);
          sourceDocs.push(moduleUrl);
        } catch (error) {
          summary.failed += 1;
          errors.push(`${moduleUrl}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      for (const referenceUrl of referenceLinks) {
        try {
          const page = await fetchPage(referenceUrl);
          pages.push({
            url: referenceUrl,
            text: page.text,
            fetchedAt: page.fetchedAt,
            manifests: parseFetchedManifests(page.text, page.contentType).manifests,
            isDirectory: false,
          });
          sourceDocs.push(referenceUrl);
        } catch (error) {
          summary.failed += 1;
          errors.push(`${referenceUrl}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    sourceContentHash = createHash("sha256")
      .update([root.text, ...bundleTexts, ...pages.slice(1).map((page) => page.text)].join("\0"))
      .digest("hex");
    if (bundleTexts.length > 0) {
      const bundle = buildMemeFastProtocolDocuments(bundleTexts, trusted.url, sourceDocs, sourceContentHash);
      summary.unparsed += bundle.unparsed;
      pages.push({
        url: trusted.url,
        text: "",
        fetchedAt: root.fetchedAt,
        manifests: bundle.documents,
        isDirectory: true,
      });
    }

    for (const page of pages) {
      const validManifests = page.manifests.filter((manifest): manifest is Record<string, unknown> => {
        try {
          parseDocument(manifest);
          return true;
        } catch {
          summary.unparsed += 1;
          return false;
        }
      });
      for (const manifest of validManifests) {
        const result = await importProtocolDocument(manifest, store, {
          sourceUrl: page.url,
          fetchedAt: page.fetchedAt,
        });
        importedCount += 1;
        if (result.status === "success") importedResult = result;
        summary.added += result.added;
        summary.changed += result.changed;
        if (result.status === "failed") {
          summary.failed += 1;
          errors.push(`${page.url}: ${result.errorMessage ?? "protocol import failed"}`);
        }
      }
      if (validManifests.length === 0 && page.manifests.length === 0 && !page.isDirectory) {
        summary.unparsed += 1;
      }
    }

    const runId = await recordSyncRun(store, trusted.url, startedAt, fetchedAt, summary, errors, sourceContentHash);
    return {
      status: summary.failed > 0 ? "failed" : summary.unparsed > 0 ? "partial" : "success",
      runId,
      recordId: importedCount === 1 ? importedResult?.recordId : undefined,
      protocolId: importedCount === 1 ? importedResult?.protocolId : undefined,
      version: importedCount === 1 ? importedResult?.version : undefined,
      diff: importedCount === 1 ? importedResult?.diff : undefined,
      added: summary.added,
      changed: summary.changed,
      unparsed: summary.unparsed,
      failed: summary.failed,
      errorMessage: errors.length > 0 ? errors.join("; ") : undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    summary.failed += 1;
    errors.push(errorMessage);
    const runId = await recordSyncRun(store, trusted.url, startedAt, fetchedAt, summary, errors, sourceContentHash);
    return {
      status: "failed",
      errorMessage,
      runId,
      added: summary.added,
      changed: summary.changed,
      unparsed: summary.unparsed,
      failed: summary.failed,
    };
  }
}
