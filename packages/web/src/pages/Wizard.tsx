import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Modality = "llm" | "embedding" | "image" | "audio" | "video";

interface FalSchemaSummary {
  endpointId: string;
  title: string;
  modality: string;
  falCategory: string;
  falSource: string | null;
  pricing: string | null;
  apiDocs: string | null;
  status: string;
  aliasCount: number;
  matchedCount: number;
  parametersCount: number;
  requiredParams: string[];
  durationEnum: string[];
  resolutionEnum: string[];
  aspectRatioEnum: string[];
  generateAudioDefault: boolean | null;
  imageUrlsSupported: boolean;
  videoUrlsSupported: boolean;
  audioUrlsSupported: boolean;
  maxReferenceImages: number | null;
  maxReferenceVideos: number | null;
  maxReferenceAudios: number | null;
}

interface Step1Data {
  modelId: string;
  rawName: string;
  displayName: string | null;
  siteName: string;
  siteStatus: string;
  siteAdapterId: string | null;
  adapterOptions: Array<{ id: string; capabilities: string[] }>;
  suggestedModality: Modality;
  currentFalSchema: string | null;
  falParametersSnapshot: string | null;
  falInputSchemaCapabilities: {
    maxReferenceImages: number | null;
    maxReferenceVideos: number | null;
    maxReferenceAudios: number | null;
    imageUrlsSupported: boolean;
    videoUrlsSupported: boolean;
    audioUrlsSupported: boolean;
    // Optional while a long-running server is still returning the previous response shape.
    referenceImageFields?: string[];
    referenceVideoFields?: string[];
    referenceAudioFields?: string[];
    durationEnum: string[];
    aspectRatioEnum: string[];
    resolutionEnum: string[];
    generateAudioDefault: boolean | null;
  } | null;
  modelInputContract?: {
    fields: string[];
    requiredFields: string[];
    enums: Record<string, string[]>;
    totalReferenceFiles: number | null;
    audioRequiresImageOrVideo: boolean;
  };
  videoDurationEnum: string | null;
  videoAspectRatios: string | null;
  videoResolutions: string | null;
  videoRequiredParams: string | null;
  videoOptionalParams: string | null;
  generateAudioSupported: number;
  prefill: {
    adapterId: string | null;
    endpointCaps: string | null;
    paramCaps: string | null;
    maxDurationSec: number | null;
    supportsStream: number;
    requiresAsync: number;
  };
}

interface VariantForm {
  // Step 2
  modality: Modality;
  adapterId: string;
  endpointCaps: string[];
  // Step 3
  maxDurationSec: number | null;
  // Fal duration enums are not guaranteed to be numeric (for example, "auto").
  selectedDurationSecs: string[];
  selectedAspectRatios: string[];
  selectedResolutions: string[];
  maxReferenceImages: number | null;
  maxReferenceVideos: number | null;
  maxReferenceAudios: number | null;
  generateAudio: boolean;
  supportsStream: boolean;
  requiresAsync: boolean;
  // Step 4
  variantName: string;
  description: string;
  paramOverrides: Record<string, unknown>;
  paramBlocked: string[];
  fieldMapping: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseList(value: string | null | undefined): string[] {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function formatDurationOption(value: string): string {
  return /^\d+(?:\.\d+)?$/.test(value) ? `${value}s` : value;
}

function parseParams(value: string | null): any[] {
  if (!value) return [];
  try {
    const p = JSON.parse(value);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function canonicalAdapterId(value: string | null | undefined): string {
  return value === "openai-compatible" ? "openai" : value ?? "";
}

function endpointCapsForModel(value: string | null | undefined, modality: Modality): string[] {
  const parsed = parseList(value);
  if (parsed.length > 0) return parsed;
  if (modality === "video") return ["video_generation"];
  if (modality === "image") return ["image_generation"];
  if (modality === "llm") return ["chat"];
  if (modality === "audio") return ["tts", "stt"];
  return [];
}

const REFERENCE_FIELD_GROUPS = {
  images: new Set([
    "image_url", "image_urls", "reference_image_url", "reference_image_urls",
    "reference_images", "image_references", "ref_image_urls", "input_image_url",
    "input_image_urls", "end_image_url", "end_image_urls",
  ]),
  videos: new Set([
    "video_url", "video_urls", "reference_video", "reference_videos",
    "reference_video_url", "reference_video_urls",
  ]),
  audios: new Set([
    "audio_url", "audio_urls", "reference_audio", "reference_audios",
    "reference_audio_url", "reference_audio_urls",
  ]),
};

function deriveReferenceFields(snapshot: string | null): {
  images: string[];
  videos: string[];
  audios: string[];
} {
  const names = parseParams(snapshot)
    .map((param) => param?.name)
    .filter((name): name is string => typeof name === "string");
  return {
    images: names.filter((name) => REFERENCE_FIELD_GROUPS.images.has(name)),
    videos: names.filter((name) => REFERENCE_FIELD_GROUPS.videos.has(name)),
    audios: names.filter((name) => REFERENCE_FIELD_GROUPS.audios.has(name)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function WizardPage() {
  const { modelId } = useParams<{ modelId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(1);

  // ── Step 1: fal schema browser state ────────────────────────────────────
  const [schemaQ, setSchemaQ] = useState("");
  const [schemaModality, setSchemaModality] = useState<Modality | "">("");
  const [selectedSchema, setSelectedSchema] = useState<FalSchemaSummary | null>(null);

  // ── Step 2-4: form state ────────────────────────────────────────────────
  const [form, setForm] = useState<VariantForm>({
    modality: "video",
    adapterId: "",
    endpointCaps: ["video_generation"],
    maxDurationSec: null,
    selectedDurationSecs: [],
    selectedAspectRatios: [],
    selectedResolutions: [],
    maxReferenceImages: null,
    maxReferenceVideos: null,
    maxReferenceAudios: null,
    generateAudio: false,
    supportsStream: true,
    requiresAsync: false,
    variantName: "",
    description: "",
    paramOverrides: {},
    paramBlocked: [],
    fieldMapping: {},
  });

  const [overridesJson, setOverridesJson] = useState("{}");
  const [blockedJson, setBlockedJson] = useState("[]");
  const [mappingJson, setMappingJson] = useState("{}");
  const [adapterConfigJson, setAdapterConfigJson] = useState("{}");
  const [error, setError] = useState("");

  // ── Data fetching ───────────────────────────────────────────────────────
  const modelQuery = useQuery({
    queryKey: ["wizard-model", modelId],
    queryFn: () => api.get<{ data: Step1Data }>(`/admin/wizard/${modelId}/step1`),
    enabled: !!modelId,
  });

  const schemaQuery = useQuery({
    queryKey: ["fal-schemas", schemaQ, schemaModality],
    queryFn: () => {
      const params = new URLSearchParams();
      if (schemaQ) params.set("q", schemaQ);
      if (schemaModality) params.set("modality", schemaModality);
      params.set("limit", "30");
      return api.get<{ data: FalSchemaSummary[] }>(`/admin/catalog/schema?${params}`);
    },
  });

  // Apply fal schema to model
  const applySchema = useMutation({
    mutationFn: ({ endpointId, modality }: { endpointId: string; modality: string }) =>
      api.post<{ data: { applied: boolean; endpointId: string; modality: string; maxDurationSec: number | null; maxReferenceImages: number | null; maxReferenceVideos: number | null; maxReferenceAudios: number | null } }>(
        `/admin/wizard/${modelId}/apply-schema`,
        { endpointId, modality },
      ),
    onSuccess: async (res) => {
      const data = res.data;
      // Refresh the wizard snapshot before step 2 so it cannot keep showing
      // the schema that was attached before this apply request.
      await qc.invalidateQueries({ queryKey: ["wizard-model", modelId] });
      const refreshed = await modelQuery.refetch();
      const refreshedData = refreshed.data?.data;
      const refreshedCaps = refreshedData?.falInputSchemaCapabilities;
      setForm((prev) => ({
        ...prev,
        modality: data.modality as Modality,
        adapterId: prev.adapterId || canonicalAdapterId(refreshedData?.prefill.adapterId),
        endpointCaps: endpointCapsForModel(refreshedData?.prefill.endpointCaps, data.modality as Modality),
        maxDurationSec: data.maxDurationSec ?? null,
        maxReferenceImages: data.maxReferenceImages ?? refreshedCaps?.maxReferenceImages ?? null,
        maxReferenceVideos: data.maxReferenceVideos ?? refreshedCaps?.maxReferenceVideos ?? null,
        maxReferenceAudios: data.maxReferenceAudios ?? refreshedCaps?.maxReferenceAudios ?? null,
        selectedDurationSecs: parseList(refreshedData?.videoDurationEnum),
        selectedAspectRatios: parseList(refreshedData?.videoAspectRatios),
        selectedResolutions: parseList(refreshedData?.videoResolutions),
        generateAudio: refreshedCaps?.generateAudioDefault ?? refreshedData?.generateAudioSupported === 1,
        supportsStream: refreshedData?.prefill.supportsStream == null
          ? prev.supportsStream
          : refreshedData.prefill.supportsStream === 1,
        requiresAsync: refreshedData?.prefill.requiresAsync == null
          ? prev.requiresAsync
          : refreshedData.prefill.requiresAsync === 1,
      }));
      setStep(2);
    },
    onError: (e: any) => setError(e?.message ?? "应用 schema 失败"),
  });

  // Confirm wizard
  const confirm = useMutation({
    mutationFn: (payload: unknown) =>
      api.post(`/admin/wizard/${modelId}/confirm`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["models"] });
      qc.invalidateQueries({ queryKey: ["variants"] });
      navigate("/admin/variants");
    },
    onError: (e: any) => setError(e?.message ?? "提交失败"),
  });

  // ── Derived: current model data ─────────────────────────────────────────
  const modelData = modelQuery.data?.data;
  const adapterOptions = modelData?.adapterOptions ?? [];
  const suggestedAdapterId =
    canonicalAdapterId(modelData?.prefill?.adapterId ?? modelData?.siteAdapterId ?? adapterOptions[0]?.id);
  const selectedAdapterId = form.adapterId || suggestedAdapterId;
  const currentParams = modelData?.falParametersSnapshot
    ? parseParams(modelData.falParametersSnapshot)
    : [];

  const currentDurationEnum = parseList(modelData?.videoDurationEnum);
  const currentAspectRatios = parseList(modelData?.videoAspectRatios);
  const currentResolutions = parseList(modelData?.videoResolutions);
  const currentRequired = parseList(modelData?.videoRequiredParams);
  const currentOptional = parseList(modelData?.videoOptionalParams);
  const caps = modelData?.falInputSchemaCapabilities ?? null;
  const modelInputContract = modelData?.modelInputContract ?? null;
  // Older running servers do not return reference*Fields yet. Derive the exact
  // provider field names from the persisted Fal parameter snapshot instead of
  // silently hiding them until the backend is restarted.
  const derivedReferenceFields = deriveReferenceFields(modelData?.falParametersSnapshot ?? null);
  const referenceImageFields = caps?.referenceImageFields ?? derivedReferenceFields.images;
  const referenceVideoFields = caps?.referenceVideoFields ?? derivedReferenceFields.videos;
  const referenceAudioFields = caps?.referenceAudioFields ?? derivedReferenceFields.audios;
  const imageUrlsSupported = caps?.imageUrlsSupported ?? false;
  const videoUrlsSupported = caps?.videoUrlsSupported ?? false;
  const audioUrlsSupported = caps?.audioUrlsSupported ?? false;
  // 优先用已保存的 schema 能力，Step1 选中时用选中的 schema 覆盖
  const maxRefImages = selectedSchema?.maxReferenceImages ?? caps?.maxReferenceImages ?? null;
  const maxRefVideos = selectedSchema?.maxReferenceVideos ?? caps?.maxReferenceVideos ?? null;
  const maxRefAudios = selectedSchema?.maxReferenceAudios ?? caps?.maxReferenceAudios ?? null;

  // ── When a schema is selected from the list ────────────────────────────
  const handleSchemaSelect = (schema: FalSchemaSummary) => {
    setSelectedSchema(schema);
    // 自动回填 fal schema 的 maxItems 作为初始值
    if (schema.maxReferenceImages != null) setForm((f) => ({ ...f, maxReferenceImages: schema.maxReferenceImages }));
    if (schema.maxReferenceVideos != null) setForm((f) => ({ ...f, maxReferenceVideos: schema.maxReferenceVideos }));
    if (schema.maxReferenceAudios != null) setForm((f) => ({ ...f, maxReferenceAudios: schema.maxReferenceAudios }));
  };

  const handleApplySchema = () => {
    if (!selectedSchema) return;
    setError("");
    applySchema.mutate({
      endpointId: selectedSchema.endpointId,
      modality: selectedSchema.modality,
    });
  };

  const handleApplyCurrent = () => {
    // Use whatever is already on the model (from previous discover / manual edit)
    const modality = modelData?.suggestedModality ?? "video";
    setForm((prev) => ({
      ...prev,
      modality,
      adapterId: prev.adapterId || canonicalAdapterId(modelData?.prefill.adapterId),
      endpointCaps: endpointCapsForModel(modelData?.prefill.endpointCaps, modality),
      maxDurationSec: modelData?.prefill.maxDurationSec ?? null,
      selectedDurationSecs: currentDurationEnum,
      selectedAspectRatios: currentAspectRatios,
      selectedResolutions: currentResolutions,
      maxReferenceImages: caps?.maxReferenceImages ?? null,
      maxReferenceVideos: caps?.maxReferenceVideos ?? null,
      maxReferenceAudios: caps?.maxReferenceAudios ?? null,
      generateAudio: caps?.generateAudioDefault ?? modelData?.generateAudioSupported === 1,
      supportsStream: modelData?.prefill.supportsStream === 1,
      requiresAsync: modelData?.prefill.requiresAsync === 1,
    }));
    setStep(2);
  };

  const handleSkip = () => {
    // No schema at all — use model-level modality inference only
    setForm((prev) => ({
      ...prev,
      modality: modelData?.suggestedModality ?? "llm",
    }));
    setStep(2);
  };

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = () => {
    try {
      if (!form.variantName.trim()) throw new Error("请填写变体名称");
      const parsedOverrides = JSON.parse(overridesJson);
      const parsedBlocked = JSON.parse(blockedJson);
      const parsedMapping = JSON.parse(mappingJson);
      const parsedAdapterConfig = JSON.parse(adapterConfigJson);
      const paramLimits: Record<string, string[]> = {
        ...(form.selectedDurationSecs.length > 0 ? { duration: form.selectedDurationSecs.map(String) } : {}),
        ...(form.selectedAspectRatios.length > 0 ? { aspect_ratio: form.selectedAspectRatios } : {}),
        ...(form.selectedResolutions.length > 0 ? { resolution: form.selectedResolutions } : {}),
      };
      if (Array.isArray(parsedOverrides)) throw new Error("覆盖规则必须是对象");
      if (!Array.isArray(parsedBlocked)) throw new Error("禁止参数必须是数组");
      if (!parsedMapping || typeof parsedMapping !== "object" || Array.isArray(parsedMapping)) throw new Error("字段映射必须是对象");
      if (!parsedAdapterConfig || typeof parsedAdapterConfig !== "object" || Array.isArray(parsedAdapterConfig)) throw new Error("适配器配置必须是对象");
      if (!selectedAdapterId) throw new Error("请选择适配器");
      setError("");

      confirm.mutate({
        step2: {
          modality: form.modality,
          catalogId: null,
          endpointCaps: form.endpointCaps,
          paramCaps: [],
        },
        step3: {
          adapterId: selectedAdapterId,
          variantName: form.variantName.trim(),
          description: form.description,
          paramOverrides: parsedOverrides,
          paramBlocked: parsedBlocked,
          fieldMapping: parsedMapping,
          paramLimits,
          adapterConfig: parsedAdapterConfig,
          maxDurationSec: form.maxDurationSec,
          selectedDurationSecs: form.selectedDurationSecs,
          selectedAspectRatios: form.selectedAspectRatios,
          selectedResolutions: form.selectedResolutions,
          maxReferenceImages: form.maxReferenceImages,
          maxReferenceVideos: form.maxReferenceVideos,
          maxReferenceAudios: form.maxReferenceAudios,
          generateAudio: form.generateAudio,
          supportsStream: form.supportsStream,
          requiresAsync: form.requiresAsync,
          isPublic: true,
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "参数格式错误");
    }
  };

  if (!modelId) return <div className="empty-state">缺少模型 ID</div>;
  if (modelQuery.isLoading) return <div className="empty-state">正在读取模型…</div>;
  if (modelQuery.error || !modelData) {
    return <div className="empty-state">无法读取向导数据</div>;
  }

  return (
    <div className="page-stack wizard">
      <header className="page-header">
        <div>
          <p className="eyebrow">GUIDED CONFIGURATION</p>
          <h2>模型配置向导</h2>
          <p className="page-description">
            <code>{modelData.displayName ?? modelData.rawName}</code>
            {" @ "}{modelData.siteName}
            <span style={{ marginLeft: 12, color: "#7a8898", fontSize: 13 }}>
              （原始名称不可修改）
            </span>
          </p>
        </div>
        <button className="btn" onClick={() => navigate("/admin/models")}>取消</button>
      </header>

      {/* Step indicator */}
      <div className="wizard-steps">
        {["Fal Schema 匹配", "能力确认", "参数微调", "生成变体"].map((label, i) => (
          <div key={label} className={step === i + 1 ? "current" : step > i + 1 ? "complete" : ""}>
            <span>{i + 1}</span>
            {label}
          </div>
        ))}
      </div>

      {/* ── Step 1: Fal Schema Browser ── */}
      {step === 1 && (
        <section className="panel wizard-panel">
          <h3>查找 Fal.ai Schema</h3>
          <p className="section-copy">
            在 fal.ai 目录中搜索对应的模型 Schema，选择后系统会自动填充该模型的所有参数（时长、分辨率、比例等）。
          </p>

          {/* Search bar */}
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <input
              className="input"
              placeholder="搜索模型名称，如 seedance、kling、sora、veo…"
              value={schemaQ}
              onChange={(e) => setSchemaQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && schemaQuery.refetch()}
            />
            <select
              className="input"
              style={{ width: 120 }}
              value={schemaModality}
              onChange={(e) => setSchemaModality(e.target.value as any)}
            >
              <option value="">全部类型</option>
              <option value="video">视频</option>
              <option value="image">图像</option>
              <option value="llm">LLM</option>
              <option value="audio">音频</option>
            </select>
            <button className="btn" onClick={() => schemaQuery.refetch()}>搜索</button>
          </div>

          {/* Schema list */}
          {schemaQuery.isLoading && <div className="empty-state">加载中…</div>}

          <div className="selection-list">
            {schemaQuery.data?.data?.map((s) => (
              <div
                key={s.endpointId}
                className={`selection-row ${selectedSchema?.endpointId === s.endpointId ? "selected" : ""}`}
                style={{
                  cursor: "pointer",
                  background: selectedSchema?.endpointId === s.endpointId ? "#edf8f6" : undefined,
                }}
                onClick={() => handleSchemaSelect(s)}
              >
                <input
                  type="radio"
                  name="schema"
                  checked={selectedSchema?.endpointId === s.endpointId}
                  onChange={() => handleSchemaSelect(s)}
                  style={{ marginTop: 3 }}
                />
                <div style={{ flex: 1 }}>
                  <strong>{s.title}</strong>
                  <small style={{ display: "block", marginTop: 2 }}>
                    <code>{s.endpointId}</code>
                    {" · "}
                    <span style={{ color: "#64748b" }}>{s.modality}</span>
                    {" · "}
                    <span style={{ color: "#64748b" }}>{s.falCategory}</span>
                    {s.falSource && (
                      <span style={{ marginLeft: 6, color: s.falSource === "queue" ? "#f59e0b" : "#64748b" }}>
                        [{s.falSource}]
                      </span>
                    )}
                    {s.pricing && (
                      <span style={{ marginLeft: 6, color: "#4ade80" }}>{s.pricing}</span>
                    )}
                  </small>
                  <small style={{ display: "block", marginTop: 3 }}>
                    {s.durationEnum.length > 0 && (
                      <span style={{ marginRight: 10 }}>
                        ⏱ {s.durationEnum.length}个时长
                      </span>
                    )}
                    {s.resolutionEnum.length > 0 && (
                      <span style={{ marginRight: 10 }}>
                        📐 {s.resolutionEnum.length}种分辨率
                      </span>
                    )}
                    {s.aspectRatioEnum.length > 0 && (
                      <span style={{ marginRight: 10 }}>
                        📏 {s.aspectRatioEnum.length}种比例
                      </span>
                    )}
                    {s.generateAudioDefault !== null && (
                      <span style={{ marginRight: 10 }}>
                        🔊 {s.generateAudioDefault ? "生成音频" : "无音频"}
                      </span>
                    )}
                    {s.imageUrlsSupported && <span style={{ marginRight: 10 }}>🖼 {s.maxReferenceImages != null ? `最多${s.maxReferenceImages}张` : "支持图片"}</span>}
                    {s.videoUrlsSupported && <span style={{ marginRight: 10 }}>🎬 {s.maxReferenceVideos != null ? `最多${s.maxReferenceVideos}个` : "支持视频"}</span>}
                    {s.audioUrlsSupported && <span style={{ marginRight: 10 }}>🎵 {s.maxReferenceAudios != null ? `最多${s.maxReferenceAudios}个` : "支持音频"}</span>}
                  </small>
                </div>
                <small style={{ color: "#94a3b8", fontSize: 11, whiteSpace: "nowrap" }}>
                  {s.parametersCount}个参数
                </small>
              </div>
            ))}
            {!schemaQuery.isLoading && schemaQuery.data?.data?.length === 0 && (
              <div className="empty-state" style={{ padding: 24 }}>
                没有找到匹配的 Fal Schema。可以尝试其他关键词，或跳过此步骤。
              </div>
            )}
          </div>

          {selectedSchema && (
            <div style={{ marginTop: 12, padding: 14, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6 }}>
              <strong style={{ color: "#166534", fontSize: 13 }}>
                已选择: {selectedSchema.title}
              </strong>
              <div style={{ marginTop: 6, fontSize: 12, color: "#15803d" }}>
                {selectedSchema.durationEnum.length > 0 && `⏱ 时长: ${selectedSchema.durationEnum.slice(0, 5).join(", ")}${selectedSchema.durationEnum.length > 5 ? "…" : ""} `}
                {selectedSchema.resolutionEnum.length > 0 && `📐 分辨率: ${selectedSchema.resolutionEnum.join(", ")} `}
                {selectedSchema.aspectRatioEnum.length > 0 && `📏 比例: ${selectedSchema.aspectRatioEnum.join(", ")}`}
              </div>
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          <div className="modal-actions" style={{ justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={handleSkip}>跳过（无 Schema）</button>
              {modelData.currentFalSchema && (
                <button className="btn" onClick={handleApplyCurrent}>
                  使用当前配置
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" disabled={!selectedSchema || applySchema.isPending} onClick={handleApplySchema}>
                {applySchema.isPending ? "应用中…" : "应用并下一步"}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Step 2: Capability Confirmation ── */}
      {step === 2 && (
        <section className="panel wizard-panel">
          <h3>确认模型能力</h3>
          <p className="section-copy">
            来自 fal Schema 的参数已应用。请确认模态和能力标签，如有需要后续步骤可微调。
          </p>

          {/* Schema attribution */}
          {modelData.currentFalSchema && (
            <div style={{ marginBottom: 16, padding: "10px 14px", background: "#f0f9ff", border: "1px solid #93c5fd", borderRadius: 6, fontSize: 12 }}>
              <span style={{ color: "#1d4ed8" }}>
                ✅ 已关联 fal Schema: <code>{modelData.currentFalSchema}</code>
              </span>
            </div>
          )}

          <div className="form-grid">
            <Field label="模态">
              <select
                className="input"
                value={form.modality}
                onChange={(e) => setForm({ ...form, modality: e.target.value as Modality })}
              >
                <option value="video">视频 (video)</option>
                <option value="image">图像 (image)</option>
                <option value="llm">LLM</option>
                <option value="audio">音频 (audio)</option>
                <option value="embedding">嵌入 (embedding)</option>
              </select>
            </Field>
            <Field label="适配器">
              <select
                className="input"
                value={selectedAdapterId}
                onChange={(e) => setForm({ ...form, adapterId: e.target.value })}
              >
                {adapterOptions.map((adapter) => (
                  <option key={adapter.id} value={adapter.id}>
                    {adapter.id}
                  </option>
                ))}
              </select>
              <small className="field-hint">
                运行时使用模型适配器；站点适配器只作为旧数据兜底。
              </small>
            </Field>
          </div>

          <CapabilityGroup
            title="端点能力"
            values={form.endpointCaps}
            options={
              form.modality === "video"
                ? ["video_generation"]
                : form.modality === "image"
                  ? ["image_generation", "image_editing"]
                  : form.modality === "llm"
                    ? ["chat", "vision", "function_calling"]
                    : ["tts", "stt"]
            }
            onToggle={(v) =>
              setForm({
                ...form,
                endpointCaps: form.endpointCaps.includes(v)
                  ? form.endpointCaps.filter((x) => x !== v)
                  : [...form.endpointCaps, v],
              })
            }
          />

          {/* 调用方式 */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "#516170", fontWeight: 650, marginBottom: 6 }}>调用方式</div>
            <div className="toggle-row">
              <label>
                <input
                  type="checkbox"
                  checked={form.supportsStream}
                  onChange={(e) => setForm({ ...form, supportsStream: e.target.checked })}
                />
                支持流式
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.requiresAsync}
                  onChange={(e) => setForm({ ...form, requiresAsync: e.target.checked })}
                />
                需要异步任务
              </label>
            </div>
          </div>

          {error && <div className="form-error">{error}</div>}

          <StepActions
            previous={() => setStep(1)}
            next={() => {
              setForm((prev) => ({
                ...prev,
                selectedDurationSecs: currentDurationEnum,
                selectedAspectRatios: currentAspectRatios,
                selectedResolutions: currentResolutions,
              }));
              setStep(3);
            }}
          />
        </section>
      )}

      {/* ── Step 3: Fine-tune ── */}
      {step === 3 && (
        <section className="panel wizard-panel">
          <h3>微调参数限制</h3>
          <p className="section-copy">
            从 fal Schema 自动获取的完整参数列表。可在此处筛选允许的子集（如只开放 5s、10s 时长；只开放 16:9 比例）。
            全部勾选 = 不限制。
          </p>

          {/* 参考资源数量：来自 fal inputSchema 的 image_urls / video_urls / audio_urls maxItems */}
          {(imageUrlsSupported || maxRefImages != null) && (
            <div style={{ marginBottom: 18 }}>
              <Field label={"参考图最多" + (maxRefImages != null ? ` — 模型支持 ${maxRefImages} 张` : "")}>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={maxRefImages ?? undefined}
                  value={form.maxReferenceImages ?? ""}
                  placeholder="不限制"
                  onChange={(e) =>
                    setForm({ ...form, maxReferenceImages: e.target.value ? Number(e.target.value) : null })
                  }
                />
                {referenceImageFields.length > 0 && (
                  <small className="field-hint">Fal 字段：<code>{referenceImageFields.join(", ")}</code></small>
                )}
              </Field>
            </div>
          )}

          {(videoUrlsSupported || maxRefVideos != null) && (
            <div style={{ marginBottom: 18 }}>
              <Field label={"参考视频最多" + (maxRefVideos != null ? ` — 模型支持 ${maxRefVideos} 个` : "")}>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={maxRefVideos ?? undefined}
                  value={form.maxReferenceVideos ?? ""}
                  placeholder="不限制"
                  onChange={(e) =>
                    setForm({ ...form, maxReferenceVideos: e.target.value ? Number(e.target.value) : null })
                  }
                />
                {referenceVideoFields.length > 0 && (
                  <small className="field-hint">Fal 字段：<code>{referenceVideoFields.join(", ")}</code></small>
                )}
              </Field>
            </div>
          )}

          {(audioUrlsSupported || maxRefAudios != null) && (
            <div style={{ marginBottom: 18 }}>
              <Field label={"参考音频最多" + (maxRefAudios != null ? ` — 模型支持 ${maxRefAudios} 个` : "")}>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={maxRefAudios ?? undefined}
                  value={form.maxReferenceAudios ?? ""}
                  placeholder="不限制"
                  onChange={(e) =>
                    setForm({ ...form, maxReferenceAudios: e.target.value ? Number(e.target.value) : null })
                  }
                />
                {referenceAudioFields.length > 0 && (
                  <small className="field-hint">Fal 字段：<code>{referenceAudioFields.join(", ")}</code></small>
                )}
              </Field>
            </div>
          )}

          {modelInputContract?.totalReferenceFiles != null && (
            <div className="field-hint" style={{ marginBottom: 14 }}>
              Fal 总约束：三类参考文件合计最多 {modelInputContract.totalReferenceFiles} 个。
              {modelInputContract.audioRequiresImageOrVideo ? " 提供参考音频时，至少还要有一张参考图或一个参考视频。" : ""}
            </div>
          )}

          {/* 时长枚举选择 */}
          {currentDurationEnum.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, color: "#516170", fontWeight: 650, marginBottom: 8 }}>
                允许的时长/模式 — fal Schema: {currentDurationEnum.join(", ")}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {currentDurationEnum.map((sec) => (
                  <label
                    key={sec}
                    style={{
                      display: "flex",
                      gap: 5,
                      alignItems: "center",
                      padding: "5px 9px",
                      border: "1px solid #d7e0e5",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontSize: 12,
                      background: form.selectedDurationSecs.includes(sec) ? "#edf8f6" : "white",
                      borderColor: form.selectedDurationSecs.includes(sec) ? "#67afa5" : undefined,
                      color: form.selectedDurationSecs.includes(sec) ? "#176c64" : "#5e6f7f",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={form.selectedDurationSecs.includes(sec)}
                      onChange={() =>
                        setForm({
                          ...form,
                          selectedDurationSecs: form.selectedDurationSecs.includes(sec)
                            ? form.selectedDurationSecs.filter((s) => s !== sec)
                            : [...form.selectedDurationSecs, sec],
                        })
                      }
                    />
                    {formatDurationOption(sec)}
                  </label>
                ))}
                <button
                  className="btn btn-small"
                  style={{ fontSize: 11 }}
                  onClick={() =>
                    setForm({ ...form, selectedDurationSecs: [...currentDurationEnum] })
                  }
                >
                  全选
                </button>
                <button
                  className="btn btn-small"
                  style={{ fontSize: 11 }}
                  onClick={() => setForm({ ...form, selectedDurationSecs: [] })}
                >
                  清空
                </button>
              </div>
            </div>
          )}

          {/* 宽高比选择 */}
          {currentAspectRatios.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, color: "#516170", fontWeight: 650, marginBottom: 8 }}>
                允许的宽高比 — fal Schema: {currentAspectRatios.join(", ")}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {currentAspectRatios.map((ratio) => (
                  <label
                    key={ratio}
                    style={{
                      display: "flex",
                      gap: 5,
                      alignItems: "center",
                      padding: "5px 9px",
                      border: "1px solid #d7e0e5",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontSize: 12,
                      background: form.selectedAspectRatios.includes(ratio) ? "#edf8f6" : "white",
                      borderColor: form.selectedAspectRatios.includes(ratio) ? "#67afa5" : undefined,
                      color: form.selectedAspectRatios.includes(ratio) ? "#176c64" : "#5e6f7f",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={form.selectedAspectRatios.includes(ratio)}
                      onChange={() =>
                        setForm({
                          ...form,
                          selectedAspectRatios: form.selectedAspectRatios.includes(ratio)
                            ? form.selectedAspectRatios.filter((r) => r !== ratio)
                            : [...form.selectedAspectRatios, ratio],
                        })
                      }
                    />
                    {ratio}
                  </label>
                ))}
                <button className="btn btn-small" style={{ fontSize: 11 }} onClick={() => setForm({ ...form, selectedAspectRatios: [...currentAspectRatios] })}>全选</button>
                <button className="btn btn-small" style={{ fontSize: 11 }} onClick={() => setForm({ ...form, selectedAspectRatios: [] })}>清空</button>
              </div>
            </div>
          )}

          {/* 分辨率选择 */}
          {currentResolutions.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, color: "#516170", fontWeight: 650, marginBottom: 8 }}>
                允许的分辨率 — fal Schema: {currentResolutions.join(", ")}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {currentResolutions.map((res) => (
                  <label
                    key={res}
                    style={{
                      display: "flex",
                      gap: 5,
                      alignItems: "center",
                      padding: "5px 9px",
                      border: "1px solid #d7e0e5",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontSize: 12,
                      background: form.selectedResolutions.includes(res) ? "#edf8f6" : "white",
                      borderColor: form.selectedResolutions.includes(res) ? "#67afa5" : undefined,
                      color: form.selectedResolutions.includes(res) ? "#176c64" : "#5e6f7f",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={form.selectedResolutions.includes(res)}
                      onChange={() =>
                        setForm({
                          ...form,
                          selectedResolutions: form.selectedResolutions.includes(res)
                            ? form.selectedResolutions.filter((r) => r !== res)
                            : [...form.selectedResolutions, res],
                        })
                      }
                    />
                    {res}
                  </label>
                ))}
                <button className="btn btn-small" style={{ fontSize: 11 }} onClick={() => setForm({ ...form, selectedResolutions: [...currentResolutions] })}>全选</button>
                <button className="btn btn-small" style={{ fontSize: 11 }} onClick={() => setForm({ ...form, selectedResolutions: [] })}>清空</button>
              </div>
            </div>
          )}

          {/* generate_audio 开关 */}
          {(currentRequired.includes("generate_audio") || currentOptional.includes("generate_audio")) && (
            <div style={{ marginBottom: 14 }}>
              <div className="toggle-row">
                <label>
                  <input
                    type="checkbox"
                    checked={form.generateAudio}
                    onChange={(e) => setForm({ ...form, generateAudio: e.target.checked })}
                  />
                  生成音频（generate_audio）
                </label>
              </div>
            </div>
          )}

          {/* 提示：无参数可调 */}
          {currentParams.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: "#7b8996", fontSize: 13 }}>
              当前模型无 fal Schema 参数可微调，可直接进入下一步。
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          <StepActions previous={() => setStep(2)} next={() => setStep(4)} />
        </section>
      )}

      {/* ── Step 4: Variant name + confirm ── */}
      {step === 4 && (
        <section className="panel wizard-panel">
          <h3>生成变体</h3>
          <p className="section-copy">
            变体是对外暴露的调用名称，与站点原始模型名称无关。
            <strong style={{ color: "#c0392b" }}> 站点原始名称不会被修改。</strong>
          </p>

          {/* Summary of what will be applied */}
          <div style={{ marginBottom: 16, padding: "12px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 12 }}>
            <div style={{ fontWeight: 650, marginBottom: 6 }}>配置摘要</div>
            <div>模态: <strong>{form.modality}</strong> · 端点: <strong>{form.endpointCaps.join(", ")}</strong></div>
            {form.selectedDurationSecs.length > 0 && (
              <div>允许时长/模式: {form.selectedDurationSecs.map(formatDurationOption).join(", ")}</div>
            )}
            {form.selectedAspectRatios.length > 0 && (
              <div>允许比例: {form.selectedAspectRatios.join(", ")}</div>
            )}
            {form.selectedResolutions.length > 0 && (
              <div>允许分辨率: {form.selectedResolutions.join(", ")}</div>
            )}
            {form.maxReferenceImages != null && <div>最多参考图: {form.maxReferenceImages}</div>}
            {form.maxReferenceVideos != null && <div>最多参考视频: {form.maxReferenceVideos}</div>}
            {form.maxReferenceAudios != null && <div>最多参考音频: {form.maxReferenceAudios}</div>}
            {modelInputContract?.totalReferenceFiles != null && <div>参考文件总数上限: {modelInputContract.totalReferenceFiles}</div>}
            {referenceImageFields.length > 0 ? <div>参考图字段: <code>{referenceImageFields.join(", ")}</code></div> : null}
            {referenceVideoFields.length > 0 ? <div>参考视频字段: <code>{referenceVideoFields.join(", ")}</code></div> : null}
            {referenceAudioFields.length > 0 ? <div>参考音频字段: <code>{referenceAudioFields.join(", ")}</code></div> : null}
            {(form.maxReferenceImages != null || form.maxReferenceVideos != null || form.maxReferenceAudios != null) &&
              referenceImageFields.length === 0 && referenceVideoFields.length === 0 && referenceAudioFields.length === 0 ? (
                <div style={{ color: "#a15c00" }}>Fal 字段名未返回，当前只显示数量限制；请重新匹配 Schema。</div>
              ) : null}
            {form.generateAudio && <div>生成音频: 开启</div>}
          </div>

          <div className="form-grid">
            <Field label="变体名称（对外调用名）">
              <input
                className="input"
                placeholder="如 production-seedance-2-0-v1"
                value={form.variantName}
                onChange={(e) => setForm({ ...form, variantName: e.target.value })}
              />
              <small className="field-hint">这是 API 调用时使用的 model 名称</small>
            </Field>
            <Field label="描述">
              <input
                className="input"
                placeholder="可选描述"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>
          </div>

          <p className="section-copy" style={{ marginBottom: 12 }}>
            上方的参考资源限制会单独保存，并在视频请求进入任务队列前校验；不需要写进下面三个 JSON。只有调用方字段名与上方 fal 字段不一致时，才填写字段映射。
          </p>
          <div className="config-grid">
            <JsonField label={`适配器配置（${selectedAdapterId || "未选择"}）`} value={adapterConfigJson} onChange={setAdapterConfigJson} />
            <JsonField label="强制参数覆盖" value={overridesJson} onChange={setOverridesJson} />
            <JsonField label="禁止参数" value={blockedJson} onChange={setBlockedJson} />
            <JsonField label="字段映射" value={mappingJson} onChange={setMappingJson} />
          </div>
          {form.modality === "video" && selectedAdapterId === "openai" && (
            <small className="field-hint" style={{ display: "block", marginTop: 8 }}>
              OpenAI 视频适配器必须填写端点，例如 {`{"video":{"endpoint":"videos"}}`}；系统不会替你猜测上游端点。
            </small>
          )}

          {error && <div className="form-error">{error}</div>}

          <StepActions previous={() => setStep(3)} next={handleSubmit} nextLabel={confirm.isPending ? "生成中…" : "确认生成变体"} nextDisabled={confirm.isPending} />
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function CapabilityGroup({
  title,
  values,
  options,
  onToggle,
}: {
  title: string;
  values: string[];
  options: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="field" style={{ marginTop: 14 }}>
      <label className="label">{title}</label>
      <div className="choice-grid">
        {options.map((opt) => (
          <label
            key={opt}
            className={`choice ${values.includes(opt) ? "selected" : ""}`}
          >
            <input
              type="checkbox"
              checked={values.includes(opt)}
              onChange={() => onToggle(opt)}
            />
            {opt}
          </label>
        ))}
      </div>
    </div>
  );
}

function JsonField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <textarea
        className="input code-input"
        rows={5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function StepActions({
  previous,
  next,
  nextLabel = "下一步",
  nextDisabled = false,
}: {
  previous: () => void;
  next: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <div className="modal-actions">
      <button className="btn" onClick={previous}>上一步</button>
      <button className="btn btn-primary" disabled={nextDisabled} onClick={next}>
        {nextLabel}
      </button>
    </div>
  );
}
