import assert from "node:assert/strict";
import test from "node:test";
import { inferModelCapability } from "./src/engine/infer";
import { inferModalityFromCatalog } from "./src/engine/catalog/modality";

test("uses MemeFast runtime metadata before model-name rules", async () => {
  const result = await inferModelCapability("kling-audio", {
    runtimeMetadata: {
      model_type: "audio",
      supported_endpoint_types: ["audio.speech"],
      tags: ["tts"],
    },
  });

  assert.equal(result.modality, "audio");
  assert.equal(result.classificationSource, "runtime");
  assert.deepEqual(result.endpointCaps, ["tts"]);
});

test("prefers an audio endpoint over a generic video type", async () => {
  const result = await inferModelCapability("kling-audio", {
    runtimeMetadata: {
      model_type: "video",
      supported_endpoint_types: ["audio.speech"],
      tags: ["audio"],
    },
  });

  assert.equal(result.modality, "audio");
  assert.deepEqual(result.endpointCaps, ["tts"]);
});

test("classifies MemeFast embedding, image, and video metadata", async () => {
  const embedding = await inferModelCapability("text-embedding-v1", {
    runtimeMetadata: { model_type: "embedding" },
  });
  assert.equal(embedding.modality, "embedding");
  assert.deepEqual(embedding.endpointCaps, ["embedding"]);

  const image = await inferModelCapability("provider-image", {
    runtimeMetadata: {
      model_type: "image",
      supported_endpoint_types: ["images.generations"],
    },
  });
  assert.equal(image.modality, "image");
  assert.deepEqual(image.endpointCaps, ["image_generation"]);

  const video = await inferModelCapability("provider-video", {
    runtimeMetadata: {
      model_type: "video",
      supported_endpoint_types: ["videos.generations"],
    },
  });
  assert.equal(video.modality, "video");
  assert.deepEqual(video.endpointCaps, ["video_generation"]);
});

test("does not default an unrecognized model to llm", async () => {
  const result = await inferModelCapability("vendor-private-model", {
    runtimeMetadata: { model_type: "future_type", tags: [] },
  });

  assert.equal(result.modality, "unknown");
  assert.equal(result.classificationSource, "unknown");
  assert.deepEqual(result.endpointCaps, []);
});

test("uses strong name rules only when runtime metadata is absent", async () => {
  const embedding = await inferModelCapability("bge-embedding-v1");
  assert.equal(embedding.modality, "embedding");
  assert.equal(embedding.classificationSource, "keyword");

  const audio = await inferModelCapability("speech-transcription-v2");
  assert.equal(audio.modality, "audio");
  assert.equal(audio.classificationSource, "keyword");

  const unknown = await inferModelCapability("vendor-private-model");
  assert.equal(unknown.modality, "unknown");
});

test("recognizes common model families without model-specific aliases", async () => {
  const cases = [
    ["ERNIE-4.0-8K", "Baidu", "ernie", "llm"],
    ["llama-3.1-8b", "Meta", "llama", "llm"],
    ["qwen3-vl-32b-instruct", "Alibaba", "qwen", "llm"],
    ["glm-4-flash", "Zhipu AI", "glm", "llm"],
    ["qwen3-rerank", "Alibaba", "qwen-reranker", "embedding"],
    ["happyhorse-1.0-i2v", "Unknown", "happyhorse", "video"],
    ["pixverse-lipsync", "PixVerse", "pixverse", "video"],
    ["suno_music_open", "Suno", "suno", "audio"],
    ["viduq3-pro", "ShengShu", "vidu", "video"],
  ] as const;

  for (const [name, vendor, family, modality] of cases) {
    const result = await inferModelCapability(name);
    assert.equal(result.inferredVendor, vendor, name);
    assert.equal(result.inferredFamily, family, name);
    assert.equal(result.modality, modality, name);
    assert.equal(result.classificationSource, "keyword", name);
  }
});

test("recognizes service endpoints without pretending they are catalog models", async () => {
  const result = await inferModelCapability("MiniMax-Voice-Clone");

  assert.equal(result.inferredVendor, "MiniMax");
  assert.equal(result.inferredFamily, "minimax");
  assert.equal(result.modality, "unknown");
  assert.deepEqual(result.endpointCaps, ["service_endpoint"]);
});

test("does not invent provider limits from model names", async () => {
  const llm = await inferModelCapability("gpt-4o");
  assert.equal(llm.modality, "llm");
  assert.equal(llm.llm, undefined);

  const image = await inferModelCapability("flux-image");
  assert.equal(image.image?.supportedSizes, undefined);

  const video = await inferModelCapability("kling-video");
  assert.equal(video.video?.maxDurationSec, undefined);
  assert.equal(video.video?.requiresAsync, undefined);
});

test("uses catalog modality only when catalog output is explicit", () => {
  assert.equal(inferModalityFromCatalog('["text"]', '["image"]'), "image");
  assert.equal(inferModalityFromCatalog('["audio"]', '[]'), "audio");
  assert.equal(inferModalityFromCatalog('["text"]', '["pdf"]'), null);
  assert.equal(inferModalityFromCatalog('[]', '["pdf"]'), null);
});
