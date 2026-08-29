import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const idIdx = args.indexOf("--id");
const LIMIT = limitIdx > -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const ONLY_ID = idIdx > -1 ? args[idIdx + 1] : null;
const outIdx = args.indexOf("--output");
const OUTPUT = outIdx > -1
  ? resolve(args[outIdx + 1])
  : resolve(process.cwd(), "../../model/data/fal_model_encyclopedia.json");
const CONCURRENCY = 5;

function extractBalancedJson(text, startIdx) {
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.substring(startIdx, i + 1);
    }
  }
  return null;
}

function extractSchemasFromHtml(html) {
  const rscChunks = html.match(/self\.__next_f\.push\(\[1,"(.*?)"\]\)/gs) || [];
  for (const chunk of rscChunks) {
    try {
      const content = chunk.replace(/^self\.__next_f\.push\(\[1,"/, "").replace(/"\]\)$/, "");
      const unescaped = JSON.parse('"' + content + '"');
      if (!unescaped.includes('"properties"')) continue;

      const idx = unescaped.indexOf('"schemas"');
      if (idx === -1) continue;
      const braceStart = unescaped.indexOf("{", idx);
      if (braceStart === -1) continue;

      const schemaJson = extractBalancedJson(unescaped, braceStart);
      if (!schemaJson) continue;
      try {
        return JSON.parse(schemaJson);
      } catch {}
    } catch {}
  }
  return null;
}

function compact(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function words(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.toLowerCase())
    .filter(Boolean);
}

function levenshtein(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const above = row[j];
      row[j] = left[i - 1] === right[j - 1]
        ? diagonal
        : Math.min(diagonal + 1, row[j] + 1, row[j - 1] + 1);
      diagonal = above;
    }
  }
  return row[right.length];
}

const CATEGORY_MARKERS = {
  "text-to-image": ["texttoimage", "text2image", "t2i", "txt2img"],
  "image-to-image": ["imagetoimage", "image2image", "i2i", "img2img"],
  "text-to-video": ["texttovideo", "text2video", "t2v", "txt2vid"],
  "image-to-video": ["imagetovideo", "image2video", "i2v", "img2vid"],
  "video-to-video": ["videotovideo", "video2video", "v2v"],
  "text-to-speech": ["texttospeech", "text2speech", "t2s", "tts"],
  "speech-to-text": ["speechtotext", "speech2text", "s2t", "stt"],
  "audio-to-audio": ["audio to audio", "audio2audio", "a2a"],
};

function scoreSchemaCandidate(key, schema, model) {
  const schemaText = [key, schema?.title].filter(Boolean).join(" ");
  const targetText = [model.id, model.title, model.modelFamily, model.group?.key, model.group?.label]
    .filter(Boolean)
    .join(" ");
  const schemaCompact = compact(schemaText);
  const targetCompact = compact(targetText);
  const targetWords = words(targetText);
  const ignored = new Set(["input", "output", "schema", "request", "response", "model"]);
  const identityScore = words(schemaText)
    .filter((word) => word.length >= 3 && !ignored.has(word))
    .reduce((score, word) => {
      if (targetWords.includes(word) || targetCompact.includes(compact(word))) return score + 2;
      return targetWords.some((targetWord) => targetWord.length >= 4 && levenshtein(word, targetWord) <= 1)
        ? score + 1
        : score;
    }, 0);
  const directionScore = (CATEGORY_MARKERS[model.category] ?? [compact(model.category)])
    .some((marker) => schemaCompact.includes(compact(marker)))
    ? 100
    : 0;
  return {
    key,
    schema,
    directionScore,
    identityScore,
    propertyCount: Object.keys(schema?.properties ?? {}).length,
    score: directionScore + identityScore,
  };
}

function findInputSchema(schemas, model) {
  const candidates = Object.entries(schemas ?? {})
    .filter(([key]) => /input/i.test(key) && !/output|error|validation/i.test(key))
    .map(([key, schema]) => scoreSchemaCandidate(key, schema, model));
  if (candidates.length === 0) return null;

  const directed = candidates.filter((candidate) => candidate.directionScore > 0);
  const pool = directed.length > 0 ? directed : candidates;
  pool.sort((left, right) =>
    right.score - left.score || right.identityScore - left.identityScore || right.propertyCount - left.propertyCount,
  );
  const best = pool[0];
  const second = pool[1];
  if (!directed.length && best.identityScore === 0) return null;
  if (second && best.score === second.score && best.identityScore === second.identityScore) return null;
  return best.schema;
}

function schemaToParameters(inputSchema) {
  if (!inputSchema?.properties) return [];
  const required = inputSchema.required ?? [];
  return Object.entries(inputSchema.properties).map(([name, prop]) => ({
    name,
    type: prop.type ?? (prop.anyOf ? "union" : "unknown"),
    required: required.includes(name),
    description: prop.description ?? null,
    default: prop.default !== undefined ? prop.default : undefined,
    enum: prop.enum ?? undefined,
  }));
}

async function fetchModelPage(endpointId) {
  const response = await fetch(`https://fal.ai/models/${endpointId}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function main() {
  console.log("Fetching model list...");
  const allModels = [];
  let page = 1;
  let pages = 1;
  while (page <= pages) {
    const response = await fetch(`https://fal.ai/api/models?page=${page}&size=100`, {
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    allModels.push(...data.items);
    pages = data.pages;
    page++;
  }

  const selected = ONLY_ID
    ? allModels.filter((model) => model.id === ONLY_ID)
    : allModels.slice(0, Math.min(LIMIT, allModels.length));
  if (ONLY_ID && selected.length === 0) throw new Error(`Model not found: ${ONLY_ID}`);
  console.log(`Processing ${selected.length}...`);

  const encyclopediaModels = {};
  let processed = 0;
  let withSchema = 0;
  let errors = 0;

  async function processModel(model) {
    try {
      const schemas = extractSchemasFromHtml(await fetchModelPage(model.id));
      const inputSchema = findInputSchema(schemas, model);
      const parameters = schemaToParameters(inputSchema);
      encyclopediaModels[model.id] = {
        title: model.title ?? model.id,
        category: model.category ?? "unknown",
        description: model.shortDescription?.trim() ?? null,
        pricing: model.pricingInfoOverride ?? null,
        tags: model.tags ?? [],
        endpoint_id: model.id,
        source: model.machineType === "serverless" ? "realtime" : "queue",
        input_schema: inputSchema,
        parameters: parameters.length > 0 ? parameters : null,
        status: inputSchema ? "ok" : "no_schema",
      };
      if (inputSchema) withSchema++;
    } catch (error) {
      encyclopediaModels[model.id] = {
        title: model.title ?? model.id,
        category: model.category ?? "unknown",
        description: model.shortDescription?.trim() ?? null,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
      errors++;
    }
    processed++;
    if (processed % 20 === 0 || processed === selected.length) {
      console.log(`  ${processed}/${selected.length} | schemas:${withSchema} errors:${errors}`);
    }
  }

  const queue = [...selected];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const model = queue.shift();
      if (!model) break;
      await processModel(model);
    }
  }));

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify({
    meta: {
      generated_at: new Date().toISOString(),
      source: "fal.ai",
      total_models: Object.keys(encyclopediaModels).length,
      with_schema: withSchema,
      without_schema: selected.length - withSchema - errors,
    },
    models: encyclopediaModels,
  }, null, 2), "utf8");
  console.log(`Done! total=${Object.keys(encyclopediaModels).length} schemas=${withSchema} errors=${errors}`);
  console.log(`Output: ${OUTPUT}`);
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
