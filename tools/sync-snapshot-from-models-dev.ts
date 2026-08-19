/**
 * 从 models.dev models.json 生成项目内置快照
 *
 * 用法: bun run tools/sync-snapshot-from-models-dev.ts
 *
 * 输出: packages/server/src/engine/capability/catalog-snapshot.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

interface ModelsDevItem {
  id: string;
  name: string;
  description?: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  modalities?: { input: string[]; output: string[] };
  limit?: { context?: number; input?: number; output?: number };
  open_weights?: boolean;
  release_date?: string;
  last_updated?: string;
  knowledge?: string;
}

type ModelsDevResponse = Record<string, ModelsDevItem>;

interface SnapshotModel {
  id: string;
  name: string;
  lab: string;
  lab_name: string;
  family?: string | null;
  modalities?: { input: string[]; output: string[] };
  limit?: { context?: number; input?: number; output?: number };
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  attachment?: boolean;
  temperature?: boolean;
  description?: string;
  release_date?: string;
  open_weights?: boolean;
}

interface Snapshot {
  version: string;
  source: string;
  models: SnapshotModel[];
}

const SOURCE_LAB_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  deepseek: "DeepSeek",
  alibaba: "Alibaba",
  zhipuai: "Zhipu AI",
  moonshotai: "Moonshot AI",
  minimax: "MiniMax",
  mistral: "Mistral",
  meta: "Meta",
  xai: "xAI",
  cohere: "Cohere",
  nvidia: "NVIDIA",
  bytedance: "ByteDance",
  tencent: "Tencent",
  microsoft: "Microsoft",
  ibm: "IBM",
  perplexity: "Perplexity",
  sakana: "Sakana AI",
  stepfun: "StepFun",
  meituan: "Meituan",
  xiaomi: "Xiaomi",
  poolside: "Poolside",
  deepreinforce: "DeepReinforce",
  arcee: "Arcee",
  swiss: "Swiss AI",
  sdaia: "SDAIA",
  sarvam: "Sarvam",
  aisingapore: "AI Singapore",
  thinkingmachines: "Thinking Machines",
  openrouter: "OpenRouter",
  vercel: "Vercel",
  groq: "Groq",
  cerebras: "Cerebras",
  togetherai: "Together AI",
  fireworks: "Fireworks",
  baseten: "Baseten",
  lambda: "Lambda",
  deepinfra: "DeepInfra",
  replit: "Replit",
  kluster: "Kluster",
  nebius: "Nebius",
};

function labNameFor(labId: string): string {
  if (SOURCE_LAB_NAMES[labId]) return SOURCE_LAB_NAMES[labId];
  // 转为 Title Case
  return labId
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function main() {
  const sourceFile = join(ROOT, "models.dev-snapshot.json");
  const targetFile = join(ROOT, "packages/server/src/engine/capability/catalog-snapshot.json");

  console.log(`Reading ${sourceFile}...`);
  const raw = readFileSync(sourceFile, "utf-8");
  const parsed = JSON.parse(raw) as ModelsDevResponse;

  const models: SnapshotModel[] = [];
  for (const [id, item] of Object.entries(parsed)) {
    const slashIdx = id.indexOf("/");
    const labId = slashIdx > 0 ? id.slice(0, slashIdx) : "unknown";

    models.push({
      id,
      name: item.name,
      lab: labId,
      lab_name: labNameFor(labId),
      family: item.family ?? null,
      modalities: item.modalities,
      limit: item.limit,
      reasoning: item.reasoning,
      tool_call: item.tool_call,
      structured_output: item.structured_output,
      attachment: item.attachment,
      temperature: item.temperature,
      description: item.description,
      release_date: item.release_date,
      open_weights: item.open_weights,
    });
  }

  const snapshot: Snapshot = {
    version: new Date().toISOString().split("T")[0],
    source: "https://models.dev/models.json",
    models,
  };

  console.log(`Writing ${targetFile} (${models.length} models)...`);
  writeFileSync(targetFile, JSON.stringify(snapshot, null, 2));

  // 统计信息
  const labCount = new Set(models.map((m) => m.lab)).size;
  const familyCount = new Set(models.map((m) => m.family).filter(Boolean)).size;
  console.log(`✅ Snapshot updated: ${models.length} models from ${labCount} labs (${familyCount} families)`);
}

main().catch((err) => {
  console.error("Failed to update snapshot:", err);
  process.exit(1);
});
