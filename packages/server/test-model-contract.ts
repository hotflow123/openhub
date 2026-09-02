import assert from "node:assert/strict";
import test from "node:test";
import {
  validateModelRequest,
  validateVariantLimits,
  validateParameterLimitsAgainstModel,
  readModelInputContract,
  deriveModelIdentity,
  buildCapabilityContract,
  modelEvidenceState,
  deriveExecutionStatus,
  validateVariantParameterPolicy,
} from "./src/lib/model-contract";
import { inferModelCapability } from "./src/engine/infer";

const model = {
  schemaMatchStatus: "confirmed",
  falParametersSnapshot: JSON.stringify([
    { name: "prompt", required: true },
    { name: "duration", enum: ["5", "10"] },
    { name: "audio_urls", description: "At least one reference image or video is required when audio is supplied." },
  ]),
  falInputSchemaSnapshot: JSON.stringify({
    type: "object",
    properties: {
      image_urls: { type: "array", maxItems: 9 },
      video_urls: { type: "array", maxItems: 3 },
      audio_urls: { type: "array", maxItems: 3, description: "Total files across all modalities must not exceed 12. At least one reference image or video is required when audio is supplied." },
    },
    required: ["prompt"],
  }),
  videoRequiredParams: null,
  videoOptionalParams: null,
  maxReferenceImages: 9,
  maxReferenceVideos: 3,
  maxReferenceAudios: 3,
  maxDurationSec: 10,
};

test("reads Fal fields, per-modality limits, total limit, and dependency", () => {
  const contract = readModelInputContract(model);
  assert.deepEqual(contract.fields.sort(), ["audio_urls", "duration", "image_urls", "prompt", "video_urls"].sort());
  assert.equal(contract.maxReferenceImages, 9);
  assert.equal(contract.maxReferenceVideos, 3);
  assert.equal(contract.maxReferenceAudios, 3);
  assert.equal(contract.totalReferenceFiles, 12);
  assert.equal(contract.audioRequiresImageOrVideo, true);
});

test("enforces model limits when the variant has no override", () => {
  assert.match(
    validateModelRequest(
      { model: "variant", prompt: "x", image_urls: Array(10).fill("i") },
      model,
      {},
    ) ?? "",
    /received 10, limit is 9/,
  );
  assert.match(
    validateModelRequest(
      { model: "variant", prompt: "x", image_urls: Array(9).fill("i"), video_urls: Array(3).fill("v"), audio_urls: ["a"] },
      model,
      {},
    ) ?? "",
    /received 13, limit is 12/,
  );
});

test("validates required, enum, and audio dependency rules before forwarding", () => {
  assert.match(validateModelRequest({ model: "variant" }, model, {}) ?? "", /Missing required model parameter: prompt/);
  assert.match(validateModelRequest({ model: "variant", prompt: "x", duration: "7" }, model, {}) ?? "", /Invalid duration/);
  assert.match(validateModelRequest({ model: "variant", prompt: "x", audio_urls: ["a"] }, model, {}) ?? "", /requires at least one/);
  assert.equal(validateModelRequest({ model: "variant", prompt: "x", duration: "5" }, model, {}), null);
});

test("keeps allowed-value limits separate from forced overrides", () => {
  const widerDurationModel = {
    ...model,
    falParametersSnapshot: JSON.stringify([
      { name: "prompt", required: true },
      { name: "duration", enum: ["4", "5", "10"] },
    ]),
  };
  assert.equal(validateParameterLimitsAgainstModel({ duration: ["5", "10"] }, widerDurationModel), null);
  assert.match(
    validateModelRequest({ model: "variant", prompt: "x", duration: "4" }, widerDurationModel, {}, {}, { duration: ["5", "10"] }) ?? "",
    /Invalid duration for this variant/,
  );
  assert.equal(
    validateModelRequest({ model: "variant", prompt: "x", duration: "5" }, widerDurationModel, {}, {}, { duration: ["5", "10"] }),
    null,
  );
});

test("rejects a variant limit above the model contract", () => {
  assert.match(
    validateVariantLimits({ maxReferenceImages: 10, maxReferenceVideos: null, maxReferenceAudios: null, maxDurationSec: null }, model) ?? "",
    /limit 10 exceeds this model's limit 9/,
  );
  assert.equal(
    validateVariantLimits({ maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, maxDurationSec: null }, model),
    null,
  );
});

test("does not treat a candidate Schema as a provider contract", () => {
  const candidate = { ...model, schemaMatchStatus: "candidate" };
  const contract = readModelInputContract(candidate);

  assert.deepEqual(contract.fields, []);
  assert.equal(contract.maxReferenceImages, null);
  assert.equal(contract.maxReferenceVideos, null);
  assert.equal(contract.maxReferenceAudios, null);
  assert.equal(
    validateModelRequest(
      { model: "variant", image_urls: Array(10).fill("i") },
      candidate,
      {},
    ),
    null,
  );
});

test("does not mark an untested media model as unavailable", () => {
  assert.equal(deriveExecutionStatus({
    identityStatus: "recognized",
    capabilityContractStatus: "confirmed",
    adapterValidationStatus: "ready",
    adapterConfigStatus: "valid",
    runtimeProbeStatus: "unknown",
    requiredCapability: "video.submit",
    requireRuntimeProbe: true,
  }), "needs_review");
  assert.equal(deriveExecutionStatus({
    identityStatus: "recognized",
    capabilityContractStatus: "confirmed",
    adapterValidationStatus: "ready",
    adapterConfigStatus: "valid",
    runtimeProbeStatus: "unsupported",
    requiredCapability: "video.submit",
    requireRuntimeProbe: true,
  }), "unavailable");
});

test("merges an applied Fal template into the confirmed runtime contract", () => {
  const contract = readModelInputContract({
    ...model,
    capabilityContractStatus: "confirmed",
    capabilityContractSnapshot: JSON.stringify({
      modality: "video",
      version: "1",
      input: {
        type: "object",
        properties: {
          model: { type: "string", required: true },
          prompt: { type: "string", required: true },
        },
      },
      output: { type: "object" },
      lifecycle: "async",
      source: "adapter",
      status: "confirmed",
      identityStatus: "recognized",
      identitySource: "runtime",
      parameterCoverage: "partial",
      executionStatus: "ready",
      reason: "runtime_model_contract",
    }),
  });

  assert.ok(contract.fields.includes("duration"));
  assert.equal(contract.defaults.duration, undefined);
  assert.deepEqual(contract.enums.duration, ["5", "10"]);
  assert.equal(contract.maxReferenceImages, 9);
});

test("allows supported variant media-count changes and rejects unknown fields", () => {
  assert.equal(
    validateVariantParameterPolicy(
      { reference_image_urls: "image_urls" },
      { aspect_ratio: "9:16", resolution: "1080p" },
      model,
    ),
    null,
  );
  assert.match(
    validateVariantParameterPolicy({}, { made_up_parameter: true }, model) ?? "",
    /not in the model contract/,
  );
});

test("keeps a dated model name as a candidate when runtime metadata only exposes modality", () => {
  const identity = deriveModelIdentity({
    runtimeInference: {
      inferredVendor: "Unknown",
      inferredFamily: "",
      modality: "llm",
      confidence: 0.98,
      classificationSource: "runtime",
      classificationConfidence: "high",
    },
    nameInference: {
      inferredVendor: "OpenAI",
      inferredFamily: "gpt",
      modality: "llm",
      confidence: 0.7,
      classificationSource: "keyword",
      classificationConfidence: "medium",
    },
    runtimeMetadata: { model_type: "chat" },
  });

  assert.deepEqual(identity, {
    status: "ambiguous",
    source: "name",
    reason: "model_name_family_candidate",
  });
});

test("recognizes a strong name identity when runtime inference only supplies modality", () => {
  const identity = deriveModelIdentity({
    runtimeInference: {
      inferredVendor: "Unknown",
      inferredFamily: "",
      modality: "image",
      confidence: 0.98,
      classificationSource: "runtime",
      classificationConfidence: "high",
    },
    nameInference: {
      inferredVendor: "Black Forest Labs",
      inferredFamily: "flux",
      modality: "image",
      confidence: 0.9,
      classificationSource: "keyword",
      classificationConfidence: "high",
    },
  });

  assert.equal(identity.status, "recognized");
  assert.equal(identity.source, "name");
  assert.equal(identity.reason, "model_name_identity_match");
});

test("recognizes a model name when runtime metadata omits vendor", async () => {
  const inferred = await inferModelCapability("gpt-5.5-pro-2026-04-23", {
    runtimeMetadata: { model_type: "chat" },
  });
  const identity = deriveModelIdentity({
    runtimeInference: inferred,
    nameInference: await inferModelCapability("gpt-5.5-pro-2026-04-23"),
    runtimeMetadata: { model_type: "chat" },
  });

  assert.equal(identity.status, "recognized");
  assert.equal(identity.source, "name");
  assert.equal(identity.reason, "model_name_identity_match");
});

test("recognizes provider families from names without upstream vendor metadata", async () => {
  const cases = [
    ["gemini-embedding-2-preview", "Google", "embedding"],
    ["speech-2.6-hd", "MiniMax", "audio"],
    ["z-image-turbo", "Alibaba", "image"],
    ["happyhorse-1.0-i2v", "Alibaba", "video"],
    ["netease-youdao/bce-reranker-base_v1", "NetEase Youdao", "embedding"],
  ] as const;

  for (const [name, vendor, modality] of cases) {
    const inferred = await inferModelCapability(name);
    assert.equal(inferred.inferredVendor, vendor, name);
    assert.equal(inferred.modality, modality, name);
    assert.equal(inferred.classificationConfidence, "high", name);
  }
});

test("downgrades legacy name-only identity without changing the raw model id", () => {
  const evidence = modelEvidenceState({
    ...model,
    modelIdentityStatus: "recognized",
    modelIdentitySource: "name",
    modelIdentityReason: "model_name_family_rule",
    capabilityContractStatus: "confirmed",
    adapterValidationStatus: "ready",
  }, { status: "available", capability: "chat" });

  assert.equal(evidence.identityStatus, "ambiguous");
  assert.equal(evidence.executionStatus, "needs_review");
});

test("keeps a newly confirmed name identity in the API evidence state", () => {
  const evidence = modelEvidenceState({
    ...model,
    modelIdentityStatus: "recognized",
    modelIdentitySource: "name",
    modelIdentityReason: "model_name_identity_match",
    capabilityContractStatus: "confirmed",
    adapterValidationStatus: "ready",
  }, { status: "available", capability: "chat" });

  assert.equal(evidence.identityStatus, "recognized");
  assert.equal(evidence.executionStatus, "ready");
});

test("keeps a recognized structured catalog identity", () => {
  const evidence = modelEvidenceState({
    ...model,
    catalogMatchSource: "structured",
    modelIdentityStatus: "recognized",
    modelIdentitySource: "catalog",
    capabilityContractStatus: "confirmed",
    adapterValidationStatus: "ready",
  }, { status: "available", capability: "chat" });

  assert.equal(evidence.identityStatus, "recognized");
  assert.equal(evidence.executionStatus, "ready");
});

test("allows a contract-ready model before a billable runtime probe", () => {
  const evidence = modelEvidenceState({
    ...model,
    modelIdentityStatus: "recognized",
    modelIdentitySource: "catalog",
    catalogMatchSource: "exact",
    capabilityContractStatus: "confirmed",
    adapterValidationStatus: "ready",
  });

  assert.equal(evidence.executionStatus, "ready");
  assert.equal(evidence.runtimeStatus, "unverified");
});

test("marks an unsupported adapter modality unavailable instead of pending", () => {
  const evidence = modelEvidenceState({
    ...model,
    modelIdentityStatus: "recognized",
    modelIdentitySource: "name",
    modelIdentityReason: "model_name_identity_match",
    capabilityContractStatus: "unverified",
    capabilityContractReason: "adapter_does_not_implement_modality",
    adapterValidationStatus: "ready",
  });

  assert.equal(evidence.identityStatus, "recognized");
  assert.equal(evidence.executionStatus, "unavailable");
});

test("keeps a weak structured catalog identity ambiguous", () => {
  const evidence = modelEvidenceState({
    ...model,
    catalogMatchSource: "structured",
    modelIdentityStatus: "ambiguous",
    modelIdentitySource: "catalog",
    capabilityContractStatus: "confirmed",
    adapterValidationStatus: "ready",
  });

  assert.equal(evidence.identityStatus, "ambiguous");
  assert.equal(evidence.executionStatus, "needs_review");
});

test("builds a confirmed baseline contract without inventing private parameters", () => {
  const identity = {
    status: "recognized" as const,
    source: "admin" as const,
    reason: "admin_confirmed",
  };
  const contract = buildCapabilityContract({
    modality: "llm",
    identity,
    inferred: {
      modality: "llm",
      confidence: 0.7,
      endpointCaps: ["chat", "stream"],
    },
    adapterCapabilities: ["chat", "chat.stream"],
    adapterValidationStatus: "ready",
  });

  assert.equal(contract?.status, "confirmed");
  assert.equal(contract?.parameterCoverage, "partial");
  assert.equal(contract?.executionStatus, "ready");
  assert.equal(contract?.input.properties?.messages?.required, true);
  assert.equal(contract?.input.properties?.temperature, undefined);
});

test("uses runtime parameter evidence when it is present", () => {
  const contract = buildCapabilityContract({
    modality: "image",
    identity: { status: "recognized", source: "runtime", reason: "runtime_model_identity" },
    inferred: { modality: "image", confidence: 0.98, endpointCaps: ["image_generation"] },
    runtimeMetadata: {
      parameters: [{ name: "size", enum: ["1024x1024", "1792x1024"] }],
    },
    adapterCapabilities: ["image.generation"],
    adapterValidationStatus: "ready",
  });

  assert.equal(contract?.source, "runtime");
  assert.deepEqual(contract?.input.properties?.size?.enum, ["1024x1024", "1792x1024"]);
  assert.equal(contract?.executionStatus, "ready");
});

test("does not make a video model executable when the adapter lacks task lifecycle", () => {
  const contract = buildCapabilityContract({
    modality: "video",
    identity: { status: "recognized", source: "name", reason: "model_name_family_rule" },
    inferred: { modality: "video", confidence: 0.9, endpointCaps: ["video_generation"] },
    adapterCapabilities: ["chat"],
    adapterValidationStatus: "ready",
  });

  assert.equal(contract?.status, "unverified");
  assert.equal(contract?.executionStatus, "unavailable");
});

test("does not confirm video protocol from adapter capabilities alone", () => {
  const contract = buildCapabilityContract({
    modality: "video",
    identity: { status: "recognized", source: "catalog", reason: "exact_catalog_match" },
    inferred: { modality: "video", confidence: 0.99, endpointCaps: ["video_generation"] },
    adapterCapabilities: ["video.submit", "video.query"],
    adapterValidationStatus: "ready",
  });

  assert.equal(contract?.status, "candidate");
  assert.equal(contract?.executionStatus, "needs_review");
  assert.equal(contract?.reason, "video_protocol_evidence_missing");
});

test("does not trust a legacy confirmed video snapshot without a valid contract", () => {
  const state = modelEvidenceState({
    modality: "video",
    modelIdentityStatus: "recognized",
    modelIdentitySource: "admin",
    capabilityContractStatus: "confirmed",
    capabilityContractSnapshot: JSON.stringify({ modality: "video", status: "confirmed" }),
    adapterValidationStatus: "ready",
  } as never);
  assert.equal(state.contractStatus, "candidate");
  assert.notEqual(state.executionStatus, "ready");
});

test("allows a valid adapter video contract without a parameter template", () => {
  const state = modelEvidenceState({
    modality: "video",
    modelIdentityStatus: "recognized",
    modelIdentitySource: "adapter-manifest",
    capabilityContractStatus: "confirmed",
    capabilityContractSnapshot: JSON.stringify({
      modality: "video",
      version: "adapter.video.v1",
      input: { type: "object", properties: { prompt: { type: "string" } } },
      output: { type: "object", properties: { id: { type: "string" } } },
      lifecycle: "async",
      source: "adapter",
      status: "confirmed",
      identityStatus: "recognized",
      identitySource: "adapter-manifest",
      parameterCoverage: "partial",
      executionStatus: "ready",
      reason: "adapter_protocol_baseline",
    }),
    adapterValidationStatus: "ready",
  } as never);
  assert.equal(state.contractStatus, "confirmed");
  assert.equal(state.executionStatus, "ready");
  assert.equal(state.runtimeStatus, "unverified");
});
