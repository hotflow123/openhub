import assert from "node:assert/strict";
import test from "node:test";
import {
  extractModelVersion,
  matchModel,
  parseModelIdentity,
  rankModelCandidates,
  type MatcherDb,
} from "@openhub/catalog/matcher";

const candidates = [
  {
    id: "bytedance-seed/seed-2.0-code",
    name: "Seed 2.0 Code",
    family: "seed",
    modality: "llm",
  },
  {
    id: "bytedance/seedream-5.0-pro",
    name: "Seedream 5.0 Pro",
    family: "seedream",
    modality: "image",
  },
  {
    id: "bytedance/seedream-4.5-pro",
    name: "Seedream 4.5 Pro",
    family: "seedream",
    modality: "image",
  },
];

function fakeMatcherDb(rows = candidates): MatcherDb {
  return {
    async findCatalogById() {
      return undefined;
    },
    async findCatalogByNormalized() {
      return undefined;
    },
    async findCatalogAlias() {
      return undefined;
    },
    async findCatalogCandidates() {
      return rows;
    },
  };
}

test("normalizes split numeric versions and ignores date suffixes", () => {
  assert.equal(extractModelVersion("doubao-seedream-5-0-pro-260628"), "5");
  assert.equal(extractModelVersion("bytedance/seedream/v5/pro/text-to-image"), "5");
  assert.equal(extractModelVersion("gpt-5.5-2026-04-23"), "5.5");
  assert.equal(extractModelVersion("model-260628"), null);
});

test("matches a dated provider snapshot to its catalog base model", async () => {
  const result = await matchModel(
    fakeMatcherDb([
      { id: "openai/gpt-5.5", name: "GPT-5.5", family: "gpt", modality: "llm" },
      { id: "openai/gpt-5.5-pro", name: "GPT-5.5 Pro", family: "gpt-pro", modality: "llm" },
      { id: "openai/gpt-5.4", name: "GPT-5.4", family: "gpt", modality: "llm" },
    ]),
    "gpt-5.5-2026-04-23",
    { modality: "llm" },
  );

  assert.equal(result.catalogModelId, "openai/gpt-5.5");
  assert.equal(result.source, "structured");
  assert.ok(result.confidence >= 0.9);
});

test("matches a model by distinctive tokens and compatible version", async () => {
  const result = await matchModel(
    fakeMatcherDb(),
    "doubao-seedream-5-0-pro-260628",
    { modality: "image" },
  );

  assert.equal(result.catalogModelId, "bytedance/seedream-5.0-pro");
  assert.equal(result.source, "structured");
  assert.ok(result.confidence >= 0.58);
});

test("does not map seedream to an unrelated seed family row", async () => {
  const result = await matchModel(
    fakeMatcherDb(),
    "doubao-seedream-5-0-pro-260628",
    { modality: "image" },
  );

  assert.notEqual(result.catalogModelId, "bytedance-seed/seed-2.0-code");
});

test("rejects a family-only or modality-conflicting candidate", async () => {
  const result = await matchModel(fakeMatcherDb(), "seed-2-0-code", { modality: "image" });
  assert.equal(result.catalogModelId, null);

  const ranked = rankModelCandidates("seed-2-0-code", candidates, { modality: "image" });
  assert.equal(ranked.length, 0);
});

test("ranks schema operations after the shared model identity", () => {
  const ranked = rankModelCandidates(
    "doubao-seedream-5-0-pro-text-to-image-260628",
    [
      {
        id: "bytedance/seedream/v5/pro/text-to-image",
        name: "Seedream 5.0 Pro Text to Image",
        modality: "image",
      },
      {
        id: "bytedance/seedream/v5/pro/edit",
        name: "Seedream 5.0 Pro Image Editing",
        modality: "image",
      },
      {
        id: "bytedance/seedream/v4.5/text-to-image",
        name: "Seedream 4.5 Text to Image",
        modality: "image",
      },
    ],
    { modality: "image" },
  );

  assert.equal(ranked[0]?.candidate.id, "bytedance/seedream/v5/pro/text-to-image");
  assert.equal(ranked[0]?.versionMatch, true);
});

test("parses identity components instead of collapsing meaningful suffixes", () => {
  assert.deepEqual(parseModelIdentity("qwen3-8b"), {
    namespace: null,
    family: "qwen",
    version: "3",
    sizes: ["8b"],
    variants: [],
    operations: [],
  });
  assert.deepEqual(parseModelIdentity("gpt-4o-mini"), {
    namespace: null,
    family: "gpt",
    version: "4",
    sizes: [],
    variants: ["o", "mini"],
    operations: [],
  });
});

test("rejects same-family candidates with a different scale or variant", async () => {
  const cases = [
    {
      rawName: "qwen3-8b",
      modality: "llm",
      candidate: { id: "alibaba/qwen3-32b", modality: "llm" },
    },
    {
      rawName: "llama-3-8b",
      modality: "llm",
      candidate: { id: "meta/llama-guard-3-8b", modality: "llm" },
    },
    {
      rawName: "gemini-2.5-pro",
      modality: "llm",
      candidate: { id: "google/gemini-2.5-computer-use-preview-10-2025", modality: "llm" },
    },
  ] as const;

  for (const item of cases) {
    const result = await matchModel(fakeMatcherDb([item.candidate]), item.rawName, {
      modality: item.modality,
    });
    assert.equal(result.catalogModelId, null, item.rawName);
  }
});

test("rejects endpoint names that only share a vendor token", async () => {
  const cases = [
    {
      rawName: "MiniMax-Voice-Clone",
      modality: "unknown",
      candidate: { id: "minimax/image-01", modality: "image" },
    },
    {
      rawName: "whisper-1",
      modality: "audio",
      candidate: { id: "openai/gpt-realtime-whisper", modality: "audio" },
    },
    {
      rawName: "kling-omni-video",
      modality: "video",
      candidate: { id: "google/gemini-omni-flash-preview", modality: "video" },
    },
    {
      rawName: "veo_3_1-components",
      modality: "video",
      candidate: { id: "google/veo-3.1-generate-preview", modality: "video" },
    },
  ] as const;

  for (const item of cases) {
    const result = await matchModel(fakeMatcherDb([item.candidate]), item.rawName, {
      modality: item.modality,
    });
    assert.equal(result.catalogModelId, null, item.rawName);
  }
});

test("allows a canonical provider endpoint when the site omits generate", async () => {
  const result = await matchModel(
    fakeMatcherDb([
      { id: "google/veo-3.1-generate-preview", modality: "video" },
    ]),
    "veo_3_1",
    { modality: "video" },
  );

  assert.equal(result.catalogModelId, "google/veo-3.1-generate-preview");
  assert.equal(result.source, "structured");
  assert.ok(result.confidence >= 0.9);
});
