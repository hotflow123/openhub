import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  listProviderAdapterRegistrations,
  type AdapterRegistration,
} from "./adapter-manifest";

export interface AdapterIndexEntry {
  id: string;
  version: string;
  displayName: string;
  modalities: string[];
  capabilities: string[];
  modelBindings: AdapterRegistration["manifest"]["modelBindings"];
  artifactTypes: string[];
  sourcePath: string | null;
  artifactSha256: string | null;
  status: AdapterRegistration["status"];
}

export interface AdapterIndex {
  formatVersion: 1;
  adapters: AdapterIndexEntry[];
}

export interface AdapterIndexValidationResult {
  ok: boolean;
  issues: string[];
}

export const DEFAULT_ADAPTER_INDEX_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
  "adapter-index.json",
);

function resolveSourcePath(sourcePath: string): string | null {
  const candidates = isAbsolute(sourcePath)
    ? [sourcePath]
    : [
        resolve(process.cwd(), sourcePath),
        resolve(dirname(fileURLToPath(import.meta.url)), "../..", sourcePath),
      ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export async function sha256File(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function entryFor(registration: AdapterRegistration): Promise<AdapterIndexEntry> {
  const sourcePath = registration.sourcePath ?? null;
  const resolvedPath = sourcePath ? resolveSourcePath(sourcePath) : null;
  return {
    id: registration.manifest.id,
    version: registration.manifest.version,
    displayName: registration.manifest.displayName,
    modalities: [...registration.manifest.modalities].sort(),
    capabilities: [...registration.manifest.capabilities].sort(),
    modelBindings: registration.manifest.modelBindings,
    artifactTypes: [...(registration.manifest.artifactTypes ?? [])].sort(),
    sourcePath,
    artifactSha256: resolvedPath ? await sha256File(resolvedPath) : null,
    status: registration.status,
  };
}

export async function buildAdapterIndex(
  registrations: AdapterRegistration[] = listProviderAdapterRegistrations(),
): Promise<AdapterIndex> {
  const adapters = await Promise.all(registrations.map(entryFor));
  adapters.sort((left, right) => left.id.localeCompare(right.id));
  return { formatVersion: 1, adapters };
}

function canonicalIndex(index: AdapterIndex): string {
  return JSON.stringify({
    formatVersion: index.formatVersion,
    adapters: [...index.adapters]
      .map((entry) => ({
        ...entry,
        modalities: [...entry.modalities].sort(),
        capabilities: [...entry.capabilities].sort(),
        artifactTypes: [...entry.artifactTypes].sort(),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

export function validateAdapterIndex(
  index: unknown,
  expected?: AdapterIndex,
): AdapterIndexValidationResult {
  const issues: string[] = [];
  if (!index || typeof index !== "object") {
    return { ok: false, issues: ["index must be an object"] };
  }
  const candidate = index as Partial<AdapterIndex>;
  if (candidate.formatVersion !== 1) issues.push("unsupported index formatVersion");
  if (!Array.isArray(candidate.adapters)) {
    issues.push("adapters must be an array");
  } else {
    const ids = candidate.adapters.map((entry) => entry?.id).filter((id): id is string => typeof id === "string");
    if (new Set(ids).size !== ids.length) issues.push("adapters contains duplicate IDs");
    candidate.adapters.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") issues.push(`adapters[${index}] must be an object`);
      else if (typeof entry.id !== "string" || entry.id.trim().length === 0) issues.push(`adapters[${index}].id is invalid`);
      else if (typeof entry.version !== "string" || !/^\d+\.\d+\.\d+$/.test(entry.version)) issues.push(`adapters[${index}].version is invalid`);
      else if (typeof entry.artifactSha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.artifactSha256)) issues.push(`adapters[${index}].artifactSha256 is invalid`);
    });
  }
  if (expected && canonicalIndex(index as AdapterIndex) !== canonicalIndex(expected)) {
    issues.push("index differs from the registered source manifests or artifacts");
  }
  return { ok: issues.length === 0, issues };
}

export async function readAdapterIndex(filePath = DEFAULT_ADAPTER_INDEX_PATH): Promise<AdapterIndex> {
  return JSON.parse(await readFile(filePath, "utf8")) as AdapterIndex;
}

export async function writeAdapterIndex(
  index: AdapterIndex,
  filePath = DEFAULT_ADAPTER_INDEX_PATH,
): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}
