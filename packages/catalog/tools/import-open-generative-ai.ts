import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import type {
  NormalizedParameterTemplate,
  OpenGenerativeAiSnapshot,
  ParameterField,
  TemplateModality,
} from "../src/parameter-template.js";

const DEFAULT_SOURCE = "E:\\code\\openhub\\Open-Generative-AI";
const DEFAULT_OUT = "packages/catalog/data/open-generative-ai.snapshot.json";
const COLLECTIONS: Array<{ name: string; operation: string; modality: TemplateModality }> = [
  { name: "t2iModels", operation: "image.text_to_image", modality: "image" },
  { name: "i2iModels", operation: "image.image_to_image", modality: "image" },
  { name: "t2vModels", operation: "video.text_to_video", modality: "video" },
  { name: "i2vModels", operation: "video.image_to_video", modality: "video" },
  { name: "v2vModels", operation: "video.video_to_video", modality: "video" },
  { name: "lipsyncModels", operation: "video.lipsync", modality: "video" },
  { name: "recastModels", operation: "video.recast", modality: "video" },
  { name: "audioModels", operation: "audio.source", modality: "audio" },
];

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : fallback;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeField(value: unknown): ParameterField {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("input field must be an object");
  }
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    const normalizedKey = key === "minValue" ? "minimum" : key === "maxValue" ? "maximum" : key === "max_items" ? "maxItems" : key;
    result[normalizedKey] = item && typeof item === "object" && !Array.isArray(item)
      ? normalizeNested(item as Record<string, unknown>)
      : item;
  }
  if (result.type === "int") result.type = "integer";
  return result as ParameterField;
}

function normalizeNested(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key === "minValue" ? "minimum" : key === "maxValue" ? "maximum" : key === "max_items" ? "maxItems" : key;
    if (normalizedKey === "properties" && item && typeof item === "object" && !Array.isArray(item)) {
      result[normalizedKey] = Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([k, v]) => [k, normalizeField(v)]));
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      result[normalizedKey] = normalizeNested(item as Record<string, unknown>);
    } else {
      result[normalizedKey] = item;
    }
  }
  if (result.type === "int") result.type = "integer";
  return result;
}

function sourceCommit(source: string): string {
  return execFileSync("git", ["-c", `safe.directory=${source.replace(/\\/g, "/")}`, "-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function requiredFields(inputs: Record<string, ParameterField>): string[] {
  return Object.entries(inputs).filter(([, field]) => field.required === true).map(([name]) => name);
}

async function main() {
  const source = resolve(arg("--source", DEFAULT_SOURCE));
  const out = resolve(arg("--out", DEFAULT_OUT));
  const file = join(source, "packages", "studio", "src", "models.js");
  if (!existsSync(file)) throw new Error(`source file not found: ${file}`);
  const sourceText = await readFile(file);
  const commit = sourceCommit(source);
  const module = await import(pathToFileURL(file).href);
  const records: NormalizedParameterTemplate[] = [];
  for (const collection of COLLECTIONS) {
    const models = module[collection.name];
    if (!Array.isArray(models)) throw new Error(`missing model array: ${collection.name}`);
    models.forEach((model: unknown, index: number) => {
      if (!model || typeof model !== "object" || Array.isArray(model)) throw new Error(`${collection.name}[${index}] is not an object`);
      const item = model as Record<string, unknown>;
      if (typeof item.id !== "string" || !item.id) throw new Error(`${collection.name}[${index}].id must be a string`);
      if (item.inputs !== undefined && (typeof item.inputs !== "object" || Array.isArray(item.inputs) || item.inputs === null)) throw new Error(`${collection.name}[${index}].inputs must be an object`);
      const inputs = Object.fromEntries(Object.entries((item.inputs ?? {}) as Record<string, unknown>).map(([name, field]) => [name, normalizeField(field)]));
      records.push({
        sourceModelId: item.id,
        sourceCollection: collection.name,
        sourceIndex: index,
        operation: collection.operation,
        modality: collection.modality,
        provider: typeof item.provider === "string" ? item.provider : null,
        providerName: typeof item.provider_name === "string" ? item.provider_name : null,
        endpointHint: typeof item.endpoint === "string" ? item.endpoint : null,
        inputs,
        required: Array.isArray(item.required) ? item.required.filter((value): value is string => typeof value === "string") : requiredFields(inputs),
        provenance: { sourceCommit: commit, file: "packages/studio/src/models.js", collection: collection.name, index },
      });
    });
  }
  const licensePath = join(source, "LICENSE");
  const sourceLicense = existsSync(licensePath) ? (await readFile(licensePath, "utf8")).trim() : null;
  const generatedAt = new Date().toISOString();
  const content = { source: "open-generative-ai" as const, sourceCommit: commit, sourceFileSha256: sha256(sourceText), sourceLicense, records };
  const snapshot: OpenGenerativeAiSnapshot = { ...content, generatedAt, snapshotSha256: sha256(JSON.stringify(stable(content))) };
  await writeFile(out, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  const fieldNames = new Set(records.flatMap((record) => Object.keys(record.inputs)));
  if (records.length !== 439 || fieldNames.size !== 128) throw new Error(`unexpected source statistics: records=${records.length} fields=${fieldNames.size}`);
  console.log(JSON.stringify({ out, records: records.length, inputFields: fieldNames.size, snapshotSha256: snapshot.snapshotSha256 }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
