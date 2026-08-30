import assert from "node:assert/strict";
import test from "node:test";
import { buildDerivedModelProfile } from "./src/engine/model-profile";
import { buildCatalogProfileUpdate } from "./src/engine/catalog/profile";

test("rebuilds an embedding profile without stale LLM fields", () => {
  const profile = buildDerivedModelProfile({
    modality: "embedding",
    endpointCaps: ["embedding"],
    paramCaps: [],
    classificationSource: "runtime",
    classificationConfidence: "high",
    classificationReason: "MemeFast model_type: embedding",
    confidence: 0.98,
  });

  assert.equal(profile.modality, "embedding");
  assert.deepEqual(JSON.parse(profile.endpointCaps), ["embedding"]);
  assert.equal(profile.contextWindow, null);
  assert.equal(profile.maxOutputTokens, null);
  assert.equal(profile.supportsReasoning, 0);
  assert.equal(profile.supportsFunctionCalling, 0);
  assert.equal(profile.supportsVision, 0);
  assert.equal(profile.supportedSizes, null);
  assert.equal(profile.maxDurationSec, null);
  assert.equal(profile.supportsStream, 0);
  assert.equal(profile.requiresAsync, 0);
});

test("does not infer video limits or async execution from modality alone", () => {
  const profile = buildDerivedModelProfile({
    modality: "video",
    endpointCaps: ["video_generation"],
    paramCaps: [],
    classificationSource: "runtime",
    classificationConfidence: "high",
    classificationReason: "MemeFast model_type: video",
    confidence: 0.98,
    video: {},
  });

  assert.equal(profile.contextWindow, null);
  assert.equal(profile.supportsFunctionCalling, 0);
  assert.equal(profile.maxDurationSec, null);
  assert.equal(profile.requiresAsync, 0);
});

test("keeps explicit stream and queue evidence", () => {
  const profile = buildDerivedModelProfile({
    modality: "llm",
    endpointCaps: ["chat", "stream", "function_calling"],
    paramCaps: ["stream", "function_calling"],
    classificationSource: "runtime",
    classificationConfidence: "high",
    classificationReason: "MemeFast endpoint metadata",
    confidence: 0.98,
    llm: { contextWindow: 64000 },
    falSource: "queue",
  });

  assert.equal(profile.contextWindow, 64000);
  assert.equal(profile.supportsFunctionCalling, 1);
  assert.equal(profile.supportsStream, 1);
  assert.equal(profile.requiresAsync, 1);
});

test("uses a high-confidence catalog match for base suggestions only", () => {
  const update = buildCatalogProfileUpdate(
    {
      capsOverridden: 0,
      modality: "unknown",
      modalitySource: "unknown",
      vendor: null,
      family: null,
      contextWindow: null,
      maxOutputTokens: null,
      supportsReasoning: 0,
      supportsFunctionCalling: 0,
      supportsVision: 0,
    },
    {
      labName: "OpenAI",
      family: "gpt",
      contextLimit: 200000,
      outputLimit: 16000,
      reasoning: true,
      toolCall: true,
      modalitiesIn: '["text","image"]',
      modalitiesOut: '["text"]',
    },
    "high",
  );

  assert.equal(update.modality, "llm");
  assert.equal(update.vendor, "OpenAI");
  assert.equal(update.contextWindow, 200000);
  assert.equal(update.maxOutputTokens, 16000);
  assert.equal(update.supportsReasoning, 1);
  assert.equal(update.supportsFunctionCalling, 1);
  assert.equal(update.supportsVision, 1);
});

test("does not use low-confidence catalog data or manual capability rows", () => {
  const catalog = {
    labName: "OpenAI",
    family: "gpt",
    contextLimit: 200000,
    outputLimit: 16000,
    modalitiesOut: '["text"]',
  };

  assert.deepEqual(
    buildCatalogProfileUpdate(
      { capsOverridden: 0, modality: "unknown", modalitySource: "unknown" },
      catalog,
      "medium",
    ),
    {},
  );
  assert.deepEqual(
    buildCatalogProfileUpdate(
      { capsOverridden: 1, modality: "unknown", modalitySource: "unknown" },
      catalog,
      "high",
    ),
    {},
  );
});

test("does not let a catalog modality override a stronger name classification", () => {
  const update = buildCatalogProfileUpdate(
    { capsOverridden: 0, modality: "llm", modalitySource: "keyword" },
    {
      labName: "Google",
      family: "gemini",
      modalitiesIn: '["text","audio"]',
      modalitiesOut: '["text","audio"]',
    },
    "high",
  );

  assert.equal(update.modality, undefined);
  assert.equal(update.modalitySource, undefined);
});

test("does not attach LLM limits to non-LLM catalog matches", () => {
  const update = buildCatalogProfileUpdate(
    {
      capsOverridden: 0,
      modality: "audio",
      modalitySource: "runtime",
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsReasoning: 1,
      supportsFunctionCalling: 1,
      supportsVision: 1,
    },
    {
      labName: "OpenAI",
      family: "whisper",
      contextLimit: 200000,
      outputLimit: 16000,
      reasoning: true,
      toolCall: true,
      modalitiesIn: '["audio"]',
      modalitiesOut: '["text"]',
    },
    "high",
  );

  assert.equal(update.contextWindow, null);
  assert.equal(update.maxOutputTokens, null);
  assert.equal(update.supportsReasoning, 0);
  assert.equal(update.supportsFunctionCalling, 0);
  assert.equal(update.supportsVision, 0);
});

test("does not attach LLM limits when catalog classifies an unknown model as media", () => {
  const update = buildCatalogProfileUpdate(
    {
      capsOverridden: 0,
      modality: "unknown",
      modalitySource: "unknown",
      contextWindow: null,
      maxOutputTokens: null,
      supportsReasoning: 0,
      supportsFunctionCalling: 0,
      supportsVision: 0,
    },
    {
      labName: "Runway",
      family: "video",
      contextLimit: 200000,
      outputLimit: 16000,
      reasoning: true,
      toolCall: true,
      modalitiesIn: '["text"]',
      modalitiesOut: '["video"]',
    },
    "high",
  );

  assert.equal(update.modality, "video");
  assert.equal(update.contextWindow, null);
  assert.equal(update.maxOutputTokens, null);
  assert.equal(update.supportsReasoning, 0);
  assert.equal(update.supportsFunctionCalling, 0);
  assert.equal(update.supportsVision, 0);
});
