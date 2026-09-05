export type ModelModality = "llm" | "image" | "audio" | "video" | "embedding" | "unknown";

export interface PublicationInput {
  siteActive: boolean;
  modelStatus: "active" | "degraded" | "offline" | "unknown";
  modality: ModelModality;
  adapterCapabilities: string[];
  protocolReady: boolean;
}

export interface PublicationDecision {
  public: boolean;
  reason:
    | "site_unavailable"
    | "model_unavailable"
    | "unknown_modality"
    | "adapter_capability_missing"
    | "video_protocol_missing"
    | "ready";
}

export function assessPublication(input: PublicationInput): PublicationDecision {
  if (!input.siteActive) return { public: false, reason: "site_unavailable" };
  if (input.modelStatus !== "active") return { public: false, reason: "model_unavailable" };
  if (input.modality === "unknown") return { public: false, reason: "unknown_modality" };

  if (input.modality === "video") {
    if (!input.adapterCapabilities.includes("video.submit") ||
        !input.adapterCapabilities.includes("video.query")) {
      return { public: false, reason: "adapter_capability_missing" };
    }
    return input.protocolReady
      ? { public: true, reason: "ready" }
      : { public: false, reason: "video_protocol_missing" };
  }

  const required = input.modality === "llm"
    ? ["chat"]
    : input.modality === "embedding"
      ? ["embedding"]
      : input.modality === "image"
        ? ["image.generation"]
        : ["audio.speech", "audio.transcription"];
  const hasCapability = input.modality === "audio"
    ? required.some((capability) => input.adapterCapabilities.includes(capability))
    : input.adapterCapabilities.includes(required[0]);

  return hasCapability
    ? { public: true, reason: "ready" }
    : { public: false, reason: "adapter_capability_missing" };
}
