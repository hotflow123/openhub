import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

interface Model {
  id: string;
  siteId: string;
  rawName: string;
  displayName: string | null;
  vendor: string | null;
  family: string | null;
  modelVersion: string | null;
  modality: string;
  endpointCaps: string;
  paramCaps: string;
  catalogModelId: string | null;
  catalogMatchSource: string | null;
  catalogMatchConfidence: string | null;
  catalogSyncedAt: Date | null;
  schemaEndpointId: string | null;
  schemaMatchSource: string | null;
  schemaSyncedAt: Date | null;
  // fal.ai 快照
  falParametersSnapshot: string | null;
  falInputSchemaSnapshot: string | null;
  falPricing: string | null;
  falDescription: string | null;
  falSource: string | null;
  // 视频参数
  videoDurationEnum: string | null;
  videoAspectRatios: string | null;
  videoResolutions: string | null;
  videoRequiredParams: string | null;
  videoOptionalParams: string | null;
  generateAudioSupported: number;
  // LLM 能力
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsReasoning: number;
  supportsFunctionCalling: number;
  supportsVision: number;
  // 媒体限制
  supportedSizes: string | null;
  maxDurationSec: number | null;
  maxReferenceImages: number | null;
  maxReferenceVideos: number | null;
  maxReferenceAudios: number | null;
  supportsStream: number;
  requiresAsync: number;
  capsOverridden: number;
  lastLatencyMs: number | null;
  avgLatencyMs: number | null;
  status: string;
  statusReason: string | null;
  siteName: string | null;
}

interface ParsedParameters {
  name: string;
  type: string;
  required: boolean;
  nullable?: boolean;
  default?: unknown;
  enum?: unknown[];
  description?: string;
  examples?: unknown[];
}

const endpointOptions = [
  "chat",
  "embedding",
  "vision",
  "function_calling",
  "json_mode",
  "image_generation",
  "image_editing",
  "tts",
  "stt",
  "video_generation",
  "video_editing",
];
const paramOptions = ["stream", "tool_choice", "response_format", "seed", "temperature", "top_p"];

function parseList(value: string | null | undefined): string[] {
  try {
    return value ? JSON.parse(value) : [];
  } catch {
    return [];
  }
}

function extractReferenceCaps(model: Model): {
  maxReferenceImages: number | null;
  maxReferenceVideos: number | null;
  maxReferenceAudios: number | null;
} {
  const result = {
    maxReferenceImages: model.maxReferenceImages ?? null,
    maxReferenceVideos: model.maxReferenceVideos ?? null,
    maxReferenceAudios: model.maxReferenceAudios ?? null,
  };
  if (!model.falInputSchemaSnapshot) return result;
  try {
    const schema = JSON.parse(model.falInputSchemaSnapshot);
    const targets = [
      ["maxReferenceImages", ["image_url", "image_urls", "reference_image_url", "reference_image_urls", "reference_images", "image_references", "ref_image_urls"]],
      ["maxReferenceVideos", ["video_url", "video_urls", "reference_video", "reference_videos", "reference_video_url", "reference_video_urls"]],
      ["maxReferenceAudios", ["audio_url", "audio_urls", "reference_audio", "reference_audios", "reference_audio_url", "reference_audio_urls"]],
    ] as const;
    const walk = (value: unknown): Record<string, unknown>[] => {
      if (!value || typeof value !== "object") return [];
      const obj = value as Record<string, unknown>;
      const out = [obj];
      for (const child of Object.values(obj)) {
        if (Array.isArray(child)) for (const item of child) out.push(...walk(item));
        else out.push(...walk(child));
      }
      return out;
    };
    const objects = walk(schema);
    for (const [key, names] of targets) {
      if (result[key] != null) continue;
      for (const obj of objects) {
        const props = obj.properties;
        if (!props || typeof props !== "object") continue;
        for (const name of names) {
          const prop = (props as Record<string, any>)[name];
          if (typeof prop?.maxItems === "number") {
            result[key] = prop.maxItems;
            break;
          }
        }
        if (result[key] != null) break;
      }
    }
  } catch {
    // Snapshot is advisory; the API columns remain the primary source.
  }
  return result;
}

function labelStatus(status: string) {
  return (
    {
      active: "正常",
      degraded: "降级",
      offline: "离线",
      unknown: "未知",
    } as Record<string, string>
  )[status] ?? status;
}

// 根据 modality 和 endpointCaps 渲染单元格内容
function ModelLimits({ model }: { model: Model }) {
  const caps = parseList(model.endpointCaps);
  const isVideo = caps.includes("video_generation") || model.modality === "video";
  const isImage = caps.includes("image_generation") || model.modality === "image";
  const isLLM = caps.includes("chat") || model.modality === "llm";

  if (isVideo) {
    const durationEnum = parseList(model.videoDurationEnum);
    const aspectRatios = parseList(model.videoAspectRatios);
    const resolutions = parseList(model.videoResolutions);
    const requiredParams = parseList(model.videoRequiredParams);
    const optionalParams = parseList(model.videoOptionalParams);
    const maxSec = model.maxDurationSec;

    const referenceCaps = extractReferenceCaps(model);

    return (
      <>
        <small>
          {maxSec ? `最长 ${maxSec}s` : "时长—"}
          {durationEnum.length > 0 && durationEnum.length < 10
            ? ` (${durationEnum.join(", ")})`
            : durationEnum.length >= 10
              ? ` (${durationEnum.length} 个选项)`
              : ""}
        </small>
        {resolutions.length > 0 && (
          <small className="cell-sub">分辨率 {resolutions.slice(0, 3).join(", ")}{resolutions.length > 3 ? "…" : ""}</small>
        )}
        {aspectRatios.length > 0 && (
          <small className="cell-sub">比例 {aspectRatios.slice(0, 4).join(", ")}{aspectRatios.length > 4 ? "…" : ""}</small>
        )}
        {model.generateAudioSupported === 1 && (
          <small className="cell-sub" style={{ color: "#4ade80" }}>🎵 支持 audio</small>
        )}
        {referenceCaps.maxReferenceImages != null && (
           <small className="cell-sub">🖼 参考图 {referenceCaps.maxReferenceImages}张</small>
        )}
        {referenceCaps.maxReferenceVideos != null && (
           <small className="cell-sub">🎬 参考视频 {referenceCaps.maxReferenceVideos}个</small>
        )}
        {referenceCaps.maxReferenceAudios != null && (
           <small className="cell-sub">🎵 参考音频 {referenceCaps.maxReferenceAudios}个</small>
        )}
        {model.requiresAsync === 1 && <small className="cell-sub">异步</small>}
      </>
    );
  }

  if (isImage) {
    const sizes = parseList(model.supportedSizes);
    return (
      <>
        <small>尺寸 {sizes.length > 0 ? sizes[0] : "—"}</small>
        {sizes.length > 1 && <small className="cell-sub">等 {sizes.length} 种</small>}
      </>
    );
  }

  if (isLLM) {
    return (
      <>
        <small>上下文 {model.contextWindow ? `${(model.contextWindow / 1000).toFixed(0)}K` : "—"}</small>
        <small className="cell-sub">输出 {model.maxOutputTokens ?? "—"}</small>
        {model.supportsReasoning === 1 && <small className="cell-sub">🧠 推理</small>}
        {model.supportsFunctionCalling === 1 && <small className="cell-sub">🔧 函数调用</small>}
        {model.supportsVision === 1 && <small className="cell-sub">👁 视觉</small>}
      </>
    );
  }

  return <small>—</small>;
}

// 双击展开的详情模态框
function ModelDetailModal({ model, onClose }: { model: Model; onClose: () => void }) {
  const caps = parseList(model.endpointCaps);
  const referenceCaps = extractReferenceCaps(model);
  const isVideo = caps.includes("video_generation") || model.modality === "video";
  const params: ParsedParameters[] = (() => {
    if (!model.falParametersSnapshot) return [];
    try {
      return JSON.parse(model.falParametersSnapshot);
    } catch {
      return [];
    }
  })();

  const durationEnum = parseList(model.videoDurationEnum);
  const aspectRatios = parseList(model.videoAspectRatios);
  const resolutions = parseList(model.videoResolutions);
  const requiredParams = parseList(model.videoRequiredParams);
  const optionalParams = parseList(model.videoOptionalParams);

  return (
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          zIndex: 100,
          backdropFilter: "blur(2px)",
        }}
        onClick={onClose}
      />
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(900px, 95vw)",
          maxHeight: "88vh",
          background: "var(--bg-secondary, #1e1e2e)",
          border: "1px solid var(--border-color, #3a3a4a)",
          borderRadius: 12,
          zIndex: 101,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 24px",
            borderBottom: "1px solid var(--border-color, #3a3a4a)",
            display: "flex",
            alignItems: "flex-start",
            gap: 16,
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span className={`badge badge-${model.modality === "video" ? "active" : model.modality === "image" ? "neutral" : "disabled"}`}>
                {model.modality}
              </span>
              {caps.map((cap) => (
                <span key={cap} className="badge badge-neutral" style={{ fontSize: 10 }}>
                  {cap}
                </span>
              ))}
              {model.schemaEndpointId && (
                <span className="badge badge-active" style={{ fontSize: 10 }}>已匹配 Schema</span>
              )}
              {model.capsOverridden === 1 && (
                <span className="badge" style={{ fontSize: 10, background: "rgba(251,191,36,0.15)", color: "#fbbf24" }}>
                  人工确认
                </span>
              )}
              {model.falSource && (
                <span className={`badge ${model.falSource === "queue" ? "badge-active" : "badge-neutral"}`} style={{ fontSize: 10 }}>
                  {model.falSource}
                </span>
              )}
            </div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{model.displayName ?? model.rawName}</h3>
            <code style={{ fontSize: 11, color: "#64748b", marginTop: 4, display: "block" }}>
              {model.rawName}
            </code>
            {model.vendor && (
              <small style={{ color: "#64748b", fontSize: 12 }}>
                {model.vendor}
                {model.family ? ` · ${model.family}` : ""}
                {model.modelVersion ? ` · ${model.modelVersion}` : ""}
              </small>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {model.schemaEndpointId && (
              <span style={{ fontSize: 11, color: "#64748b", alignSelf: "center" }}>
                Schema: <code style={{ fontSize: 11 }}>{model.schemaEndpointId}</code>
              </span>
            )}
            <button className="btn btn-sm" onClick={onClose}>关闭</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
          {/* fal.ai pricing + description */}
          {(model.falPricing || model.falDescription) && (
            <div style={{ marginBottom: 16 }}>
              {model.falPricing && (
                <div
                  style={{
                    display: "inline-block",
                    background: "rgba(34,197,94,0.1)",
                    border: "1px solid rgba(34,197,94,0.3)",
                    borderRadius: 6,
                    padding: "4px 10px",
                    fontSize: 12,
                    color: "#4ade80",
                    marginBottom: model.falDescription ? 8 : 0,
                  }}
                >
                  💰 {model.falPricing}
                </div>
              )}
              {model.falDescription && (
                <p style={{ color: "#94a3b8", fontSize: 13, margin: "8px 0 0", lineHeight: 1.6 }}>
                  {model.falDescription}
                </p>
              )}
            </div>
          )}

          {/* 视频参数完整信息 */}
          {isVideo && (
            <div style={{ marginBottom: 20 }}>
              <h4 style={{ margin: "0 0 10px", fontSize: 13, color: "#94a3b8" }}>
                视频能力（来自 fal.ai Schema）
              </h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>时长枚举</div>
                  <div style={{ fontSize: 12, color: "#a5f3fc" }}>
                    {durationEnum.length > 0
                      ? durationEnum.length >= 10
                        ? `${durationEnum[0]} ~ ${durationEnum[durationEnum.length - 1]} (${durationEnum.length}个)`
                        : durationEnum.join(", ")
                      : model.maxDurationSec ? `${model.maxDurationSec}s` : "—"}
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>分辨率</div>
                  <div style={{ fontSize: 12, color: "#a5f3fc" }}>
                    {resolutions.length > 0 ? resolutions.join(", ") : "—"}
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>宽高比</div>
                  <div style={{ fontSize: 12, color: "#a5f3fc" }}>
                    {aspectRatios.length > 0 ? aspectRatios.join(", ") : "—"}
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>参考图上限</div>
                  <div style={{ fontSize: 12, color: referenceCaps.maxReferenceImages != null ? "#a5f3fc" : "#64748b" }}>
                    {referenceCaps.maxReferenceImages != null ? `最多 ${referenceCaps.maxReferenceImages} 张` : "—"}
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>参考视频上限</div>
                  <div style={{ fontSize: 12, color: referenceCaps.maxReferenceVideos != null ? "#a5f3fc" : "#64748b" }}>
                    {referenceCaps.maxReferenceVideos != null ? `最多 ${referenceCaps.maxReferenceVideos} 个` : "—"}
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>参考音频上限</div>
                  <div style={{ fontSize: 12, color: referenceCaps.maxReferenceAudios != null ? "#a5f3fc" : "#64748b" }}>
                    {referenceCaps.maxReferenceAudios != null ? `最多 ${referenceCaps.maxReferenceAudios} 个` : "—"}
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>支持生成 Audio</div>
                  <div style={{ fontSize: 12, color: model.generateAudioSupported === 1 ? "#4ade80" : "#64748b" }}>
                    {model.generateAudioSupported === 1 ? "✅ 支持" : model.generateAudioSupported === 0 ? "❌ 不支持" : "—"}
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>调用方式</div>
                  <div style={{ fontSize: 12, color: model.requiresAsync === 1 ? "#fb923c" : "#64748b" }}>
                    {model.requiresAsync === 1 ? "异步 (queue)" : "同步"}
                  </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>关联 Schema</div>
                  <div style={{ fontSize: 11, color: "#60a5fa" }}>
                    {model.schemaEndpointId ?? "—"}
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                      {model.schemaMatchSource ?? ""}
                    </div>
                  </div>
                </div>
              </div>

              {requiredParams.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <span style={{ fontSize: 11, color: "#64748b", marginRight: 6 }}>必填参数：</span>
                  {requiredParams.map((p) => (
                    <span key={p} className="badge badge-error" style={{ fontSize: 10, marginRight: 4 }}>
                      {p}
                    </span>
                  ))}
                </div>
              )}
              {optionalParams.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: "#64748b", marginRight: 6 }}>可选参数：</span>
                  {optionalParams.map((p) => (
                    <span key={p} className="badge badge-neutral" style={{ fontSize: 10, marginRight: 4 }}>
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* fal Parameters 完整列表 */}
          {params.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ margin: "0 0 10px", fontSize: 13, color: "#94a3b8" }}>
                fal.ai Parameters 完整列表 ({params.length} 个)
              </h4>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.04)", borderBottom: "1px solid var(--border-color, #3a3a4a)" }}>
                    <th style={{ padding: "6px 10px", textAlign: "left", color: "#94a3b8" }}>参数名</th>
                    <th style={{ padding: "6px 10px", textAlign: "left", color: "#94a3b8" }}>类型</th>
                    <th style={{ padding: "6px 10px", textAlign: "left", color: "#94a3b8" }}>必填</th>
                    <th style={{ padding: "6px 10px", textAlign: "left", color: "#94a3b8" }}>默认值</th>
                    <th style={{ padding: "6px 10px", textAlign: "left", color: "#94a3b8" }}>枚举</th>
                    <th style={{ padding: "6px 10px", textAlign: "left", color: "#94a3b8" }}>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {params.map((p) => (
                    <tr key={p.name} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ padding: "6px 10px" }}>
                        <code style={{ fontSize: 11, color: p.required ? "#fb923c" : "#60a5fa", fontWeight: p.required ? 600 : 400 }}>
                          {p.name}
                        </code>
                      </td>
                      <td style={{ padding: "6px 10px", color: "#94a3b8" }}>{p.type}</td>
                      <td style={{ padding: "6px 10px" }}>
                        {p.required ? (
                          <span style={{ color: "#f87171", fontSize: 11, fontWeight: 600 }}>必填</span>
                        ) : (
                          <span style={{ color: "#64748b", fontSize: 11 }}>可选</span>
                        )}
                      </td>
                      <td style={{ padding: "6px 10px", color: "#94a3b8", fontSize: 11 }}>
                        {p.default !== undefined && p.default !== null ? JSON.stringify(p.default) : "—"}
                      </td>
                      <td style={{ padding: "6px 10px", color: "#94a3b8", fontSize: 11 }}>
                        {p.enum && Array.isArray(p.enum) ? (
                          p.enum.length <= 6 ? (
                            p.enum.map((v) => (
                              <span
                                key={String(v)}
                                style={{
                                  display: "inline-block",
                                  background: "rgba(96,165,250,0.1)",
                                  border: "1px solid rgba(96,165,250,0.3)",
                                  borderRadius: 4,
                                  padding: "1px 5px",
                                  marginRight: 3,
                                  fontSize: 10,
                                  color: "#60a5fa",
                                }}
                              >
                                {String(v)}
                              </span>
                            ))
                          ) : (
                            `${p.enum.length} 个值`
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ padding: "6px 10px", color: "#94a3b8", fontSize: 11, maxWidth: 200 }}>
                        {p.description ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 没有 fal 快照时 */}
          {!params.length && !isVideo && (
            <div style={{ textAlign: "center", padding: 32, color: "#64748b", fontSize: 13 }}>
              该模型未匹配 fal.ai Schema，暂无 parameters 快照。
            </div>
          )}

          {/* 匹配信息 */}
          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>OpenRouter Catalog 匹配</div>
              <div style={{ fontSize: 12 }}>
                {model.catalogModelId ? (
                  <>
                    <code style={{ fontSize: 11 }}>{model.catalogModelId}</code>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                      {model.catalogMatchSource} · {model.catalogMatchConfidence ?? "—"}
                    </div>
                  </>
                ) : (
                  <span style={{ color: "#64748b" }}>未匹配</span>
                )}
              </div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>fal.ai Schema 匹配</div>
              <div style={{ fontSize: 12 }}>
                {model.schemaEndpointId ? (
                  <>
                    <code style={{ fontSize: 11 }}>{model.schemaEndpointId}</code>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                      {model.schemaMatchSource ?? "—"}
                    </div>
                  </>
                ) : (
                  <span style={{ color: "#64748b" }}>未匹配</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function ModelsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Model | null>(null);
  const [detailModel, setDetailModel] = useState<Model | null>(null);
  const [filter, setFilter] = useState("");
  const siteId = new URLSearchParams(window.location.search).get("site") ?? "";

  const models = useQuery({
    queryKey: ["models", siteId],
    queryFn: () =>
      api.get<{ data: Model[] }>(
        `/admin/models${siteId ? `?site_id=${siteId}` : ""}`,
      ),
  });

  const rows = (models.data?.data ?? []).filter((m) =>
    `${m.rawName} ${m.displayName ?? ""} ${m.vendor ?? ""} ${m.siteName ?? ""} ${m.schemaEndpointId ?? ""} ${m.catalogModelId ?? ""}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );

  const probe = useMutation({
    mutationFn: (id: string) => api.post(`/admin/probes/${id}`, { mode: "safe" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["models"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/admin/models/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["models"] }),
  });

  const openDetail = useCallback((m: Model) => setDetailModel(m), []);
  const closeDetail = useCallback(() => setDetailModel(null), []);

  return (
    <div className="page-stack">
      {detailModel && <ModelDetailModal model={detailModel} onClose={closeDetail} />}

      <header className="page-header">
        <div>
          <p className="eyebrow">MODEL REGISTRY</p>
          <h2>模型实例</h2>
          <p className="page-description">
            每条记录代表一个站点上的模型。目录只提供建议，能力和状态以这里的确认结果为准。
            双击任意行查看 fal.ai 完整参数。
          </p>
        </div>
        <div className="header-actions">
          <button
            className="btn"
            disabled={probe.isPending}
            onClick={() =>
              api.post("/admin/probes/batch", { mode: "safe", limit: 20 }).then(() =>
                qc.invalidateQueries({ queryKey: ["models"] }),
              )
            }
          >
            {probe.isPending ? "探测中..." : "批量探测"}
          </button>
          <Link className="btn btn-primary" to="/admin/sites">
            管理站点
          </Link>
        </div>
      </header>

      <div className="toolbar">
        <input
          className="input search-input"
          placeholder="搜索模型、厂商、站点、Schema ID..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="toolbar-meta">
          共 {rows.length} 个模型
        </span>
      </div>

      <section className="panel table-panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>模型</th>
              <th>站点</th>
              <th>模态 / 能力</th>
              <th>Catalog 匹配</th>
              <th>Schema 匹配</th>
              <th>限制 / 参数</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const caps = parseList(m.endpointCaps);
              return (
                <tr
                  key={m.id}
                  onDoubleClick={() => openDetail(m)}
                  style={{ cursor: "pointer" }}
                  title="双击查看完整参数"
                >
                  <td>
                    <strong>{m.displayName ?? m.rawName}</strong>
                    <small className="cell-sub">
                      {m.rawName}
                      {m.vendor ? ` · ${m.vendor}` : ""}
                      {m.family ? ` · ${m.family}` : ""}
                    </small>
                  </td>
                  <td>{m.siteName ?? m.siteId}</td>
                  <td>
                    <span className="badge badge-neutral">{m.modality}</span>
                    <div className="chip-list">
                      {caps.slice(0, 4).map((cap) => (
                        <span className="chip" key={cap}>
                          {cap}
                        </span>
                      ))}
                      {caps.length > 4 && <span className="chip">+{caps.length - 4}</span>}
                    </div>
                    {m.falSource && (
                      <small className="cell-sub" style={{ color: "#64748b" }}>
                        fal:{m.falSource}
                      </small>
                    )}
                  </td>
                  <td>
                    {m.catalogModelId ? (
                      <>
                        <code style={{ fontSize: 11 }}>{m.catalogModelId}</code>
                        <small className="cell-sub">
                          {m.catalogMatchSource} · {m.catalogMatchConfidence ?? "—"}
                        </small>
                      </>
                    ) : (
                      <span className="muted">未匹配</span>
                    )}
                  </td>
                  <td>
                    {m.schemaEndpointId ? (
                      <>
                        <code style={{ fontSize: 11 }}>{m.schemaEndpointId}</code>
                        <small className="cell-sub">{m.schemaMatchSource ?? ""}</small>
                      </>
                    ) : (
                      <span className="muted">未匹配</span>
                    )}
                  </td>
                  <td>
                    <ModelLimits model={m} />
                  </td>
                  <td>
                    <span
                      className={`badge badge-${m.status === "active" ? "active" : m.status === "unknown" ? "disabled" : "error"}`}
                    >
                      {labelStatus(m.status)}
                    </span>
                    {m.capsOverridden === 1 && (
                      <small className="cell-sub">已确认</small>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-small" onClick={() => setEditing(m)}>
                        编辑
                      </button>
                      <button
                        className="btn btn-small"
                        disabled={probe.isPending}
                        onClick={() => probe.mutate(m.id)}
                      >
                        探测
                      </button>
                      <Link className="btn btn-small" to={`/admin/wizard/${m.id}`}>
                        向导
                      </Link>
                      <button
                        className="icon-danger"
                        title="删除模型"
                        onClick={() => {
                          if (confirm("删除此模型及其变体？")) remove.mutate(m.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty-state">
            没有匹配的模型。先到站点页面创建连接并发现模型。
          </div>
        )}
      </section>

      {editing && (
        <EditModel
          model={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["models"] });
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit Modal
// ─────────────────────────────────────────────────────────────────────────────

function EditModel({
  model,
  onClose,
  onSaved,
}: {
  model: Model;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    displayName: model.displayName ?? "",
    vendor: model.vendor ?? "",
    family: model.family ?? "",
    modality: model.modality,
    contextWindow: model.contextWindow?.toString() ?? "",
    maxOutputTokens: model.maxOutputTokens?.toString() ?? "",
    maxDurationSec: model.maxDurationSec?.toString() ?? "",
    supportedSizes: parseList(model.supportedSizes).join(", "),
    status: model.status,
    statusReason: model.statusReason ?? "",
    endpointCaps: parseList(model.endpointCaps),
    paramCaps: parseList(model.paramCaps),
    supportsReasoning: !!model.supportsReasoning,
    supportsFunctionCalling: !!model.supportsFunctionCalling,
    supportsVision: !!model.supportsVision,
    supportsStream: !!model.supportsStream,
    requiresAsync: !!model.requiresAsync,
    falPricing: model.falPricing ?? "",
    falDescription: model.falDescription ?? "",
  });

  // ── Fal Schema 选择（独立于表单保存）──────────────────────────────────
  const [schemaQ, setSchemaQ] = useState("");
  const [schemaModality, setSchemaModality] = useState("");
  const [pickedSchema, setPickedSchema] = useState<{
    endpointId: string;
    title: string;
    modality: string;
    falCategory: string;
    falSource: string | null;
    durationEnum: string[];
    resolutionEnum: string[];
    aspectRatioEnum: string[];
    generateAudioDefault: boolean | null;
    imageUrlsSupported: boolean;
    videoUrlsSupported: boolean;
    audioUrlsSupported: boolean;
    parametersCount: number;
  } | null>(null);
  const [applyError, setApplyError] = useState("");

  const schemaQuery = useQuery({
    queryKey: ["fal-schemas-edit", schemaQ, schemaModality],
    queryFn: () => {
      const params = new URLSearchParams();
      if (schemaQ) params.set("q", schemaQ);
      if (schemaModality) params.set("modality", schemaModality);
      params.set("limit", "20");
      return api.get<{ data: any[] }>(`/admin/catalog/schema?${params}`);
    },
  });

  const applySchema = useMutation({
    mutationFn: () =>
      api.post(`/admin/wizard/${model.id}/apply-schema`, {
        endpointId: pickedSchema!.endpointId,
        modality: pickedSchema!.modality,
      }),
    onSuccess: () => {
      onSaved();
    },
    onError: (e: any) => setApplyError(e?.message ?? "应用 Schema 失败"),
  });

  const clearSchema = useMutation({
    mutationFn: () =>
      api.patch(`/admin/models/${model.id}`, {
        schemaEndpointId: null,
        schemaMatchSource: null,
        falParametersSnapshot: null,
        videoDurationEnum: null,
        videoAspectRatios: null,
        videoResolutions: null,
        videoRequiredParams: null,
        videoOptionalParams: null,
        generateAudioSupported: 0,
        falPricing: null,
        falDescription: null,
      }),
    onSuccess: () => {
      onSaved();
    },
    onError: (e: any) => setApplyError(e?.message ?? "解除关联失败"),
  });

  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/admin/models/${model.id}`, {
        ...form,
        contextWindow: form.contextWindow ? Number(form.contextWindow) : null,
        maxOutputTokens: form.maxOutputTokens ? Number(form.maxOutputTokens) : null,
        maxDurationSec: form.maxDurationSec ? Number(form.maxDurationSec) : null,
        supportedSizes: form.supportedSizes
          ? form.supportedSizes.split(",").map((s) => s.trim()).filter(Boolean)
          : null,
        supportsReasoning: Number(form.supportsReasoning),
        supportsFunctionCalling: Number(form.supportsFunctionCalling),
        supportsVision: Number(form.supportsVision),
        supportsStream: Number(form.supportsStream),
        requiresAsync: Number(form.requiresAsync),
      }),
    onSuccess: onSuccess,
    onError: (e: any) => setError(e.message ?? "保存失败"),
  });

  function onSuccess() {
    onSaved();
  }

  const toggle = (key: "endpointCaps" | "paramCaps", value: string) =>
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((item) => item !== value)
        : [...current[key], value],
    }));

  const caps = parseList(model.endpointCaps);
  const isLLM = caps.includes("chat") || model.modality === "llm" || form.modality === "llm";
  const isVideo = caps.includes("video_generation") || form.modality === "video";
  const isImage = caps.includes("image_generation") || form.modality === "image";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          <h3>编辑模型能力</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <p className="modal-help">
          修改能力后会标记为人工确认，后续目录同步不会覆盖这些能力。
        </p>

        {/* ─── Fal Schema 关联面板 ─── */}
        <div
          style={{
            marginBottom: 18,
            padding: 14,
            border: "1px solid #d1d5db",
            borderRadius: 6,
            background: "#f8fafc",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 650, color: "#1e293b" }}>
                🔗 Fal Schema 关联
              </div>
              <small className="field-hint" style={{ display: "block", marginTop: 3 }}>
                关联后该模型的视频时长/比例/分辨率等参数会从 fal.ai 目录自动同步。
              </small>
            </div>
            {model.schemaEndpointId && (
              <button
                className="btn btn-small"
                disabled={clearSchema.isPending}
                onClick={() => {
                  if (confirm(`确认解除 fal Schema 关联？\n${model.schemaEndpointId}`)) {
                    clearSchema.mutate();
                  }
                }}
                style={{ color: "#dc2626" }}
              >
                {clearSchema.isPending ? "解除中…" : "解除关联"}
              </button>
            )}
          </div>

          {model.schemaEndpointId ? (
            <div
              style={{
                padding: "10px 12px",
                background: "#ecfdf5",
                border: "1px solid #86efac",
                borderRadius: 5,
                fontSize: 12,
                color: "#065f46",
                marginBottom: 10,
              }}
            >
              <div>
                ✅ 当前关联: <code style={{ background: "white", padding: "1px 4px" }}>{model.schemaEndpointId}</code>
                {model.schemaMatchSource && (
                  <span style={{ marginLeft: 8, color: "#64748b" }}>
                    (来源: {model.schemaMatchSource})
                  </span>
                )}
              </div>
              {parseList(model.videoDurationEnum).length > 0 && (
                <div style={{ marginTop: 6 }}>
                  ⏱ 时长: {parseList(model.videoDurationEnum).join(", ")}s
                  {model.maxDurationSec != null && (
                    <span style={{ color: "#64748b" }}> · 最长 {model.maxDurationSec}s</span>
                  )}
                </div>
              )}
              {parseList(model.videoAspectRatios).length > 0 && (
                <div style={{ marginTop: 3 }}>
                  📏 比例: {parseList(model.videoAspectRatios).join(", ")}
                </div>
              )}
              {parseList(model.videoResolutions).length > 0 && (
                <div style={{ marginTop: 3 }}>
                  📐 分辨率: {parseList(model.videoResolutions).join(", ")}
                </div>
              )}
              {model.generateAudioSupported === 1 && (
                <div style={{ marginTop: 3 }}>🔊 生成音频: 开启</div>
              )}
            </div>
          ) : (
            <div
              style={{
                padding: "10px 12px",
                background: "#fef3c7",
                border: "1px solid #fde68a",
                borderRadius: 5,
                fontSize: 12,
                color: "#92400e",
                marginBottom: 10,
              }}
            >
              ⚠ 未关联 Fal Schema，时长/比例/分辨率均为空。
            </div>
          )}

          {/* 搜索替换 */}
          <div style={{ fontSize: 12, color: "#475569", fontWeight: 600, marginBottom: 6 }}>
            {model.schemaEndpointId ? "更换为：" : "搜索 Fal Schema："}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              className="input"
              placeholder="如 seedance、kling、sora、veo…"
              value={schemaQ}
              onChange={(e) => setSchemaQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && schemaQuery.refetch()}
            />
            <select
              className="input"
              style={{ width: 110 }}
              value={schemaModality}
              onChange={(e) => setSchemaModality(e.target.value)}
            >
              <option value="">全部</option>
              <option value="video">视频</option>
              <option value="image">图像</option>
              <option value="llm">LLM</option>
              <option value="audio">音频</option>
            </select>
            <button className="btn" onClick={() => schemaQuery.refetch()}>搜索</button>
          </div>

          <div
            className="selection-list"
            style={{ maxHeight: 200, marginBottom: pickedSchema ? 10 : 0 }}
          >
            {schemaQuery.isLoading && (
              <div className="empty-state" style={{ padding: 16 }}>搜索中…</div>
            )}
            {schemaQuery.data?.data?.map((s) => (
              <div
                key={s.endpointId}
                className={`selection-row ${pickedSchema?.endpointId === s.endpointId ? "selected" : ""}`}
                style={{ cursor: "pointer" }}
                onClick={() => setPickedSchema(s)}
              >
                <input
                  type="radio"
                  name="schema"
                  checked={pickedSchema?.endpointId === s.endpointId}
                  onChange={() => setPickedSchema(s)}
                  style={{ marginTop: 3 }}
                />
                <div style={{ flex: 1 }}>
                  <strong>{s.title}</strong>
                  <small style={{ display: "block", marginTop: 2, color: "#64748b", fontSize: 11 }}>
                    <code>{s.endpointId}</code>
                    {" · "}
                    {s.modality}
                    {s.falCategory && ` · ${s.falCategory}`}
                    {s.durationEnum?.length > 0 && (
                      <span style={{ marginLeft: 6 }}>�{s.durationEnum.length}</span>
                    )}
                    {s.resolutionEnum?.length > 0 && (
                      <span style={{ marginLeft: 6 }}>📐{s.resolutionEnum.length}</span>
                    )}
                    {s.aspectRatioEnum?.length > 0 && (
                      <span style={{ marginLeft: 6 }}>📏{s.aspectRatioEnum.length}</span>
                    )}
                  </small>
                </div>
              </div>
            ))}
            {!schemaQuery.isLoading && schemaQuery.data?.data?.length === 0 && (
              <div className="empty-state" style={{ padding: 16, fontSize: 12 }}>
                未找到匹配的 Fal Schema
              </div>
            )}
          </div>

          {pickedSchema && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <small style={{ color: "#475569", fontSize: 11 }}>
                将应用 <code>{pickedSchema.endpointId}</code>：
                {pickedSchema.durationEnum?.length > 0 && ` 时长${pickedSchema.durationEnum.length}个 `}
                {pickedSchema.resolutionEnum?.length > 0 && ` 分辨率${pickedSchema.resolutionEnum.length}种 `}
                {pickedSchema.aspectRatioEnum?.length > 0 && ` 比例${pickedSchema.aspectRatioEnum.length}种`}
              </small>
              <button
                className="btn btn-primary btn-small"
                disabled={applySchema.isPending}
                onClick={() => applySchema.mutate()}
              >
                {applySchema.isPending ? "应用中…" : "应用此 Schema"}
              </button>
            </div>
          )}

          {applyError && (
            <div className="form-error" style={{ marginTop: 8 }}>{applyError}</div>
          )}
        </div>

        <div className="form-grid">
          <Field label="展示名称">
            <input
              className="input"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </Field>
          <Field label="厂商">
            <input
              className="input"
              value={form.vendor}
              onChange={(e) => setForm({ ...form, vendor: e.target.value })}
            />
          </Field>
          <Field label="Family">
            <input
              className="input"
              value={form.family}
              onChange={(e) => setForm({ ...form, family: e.target.value })}
            />
          </Field>
          <Field label="模态">
            <select
              className="input"
              value={form.modality}
              onChange={(e) => setForm({ ...form, modality: e.target.value })}
            >
              <option value="llm">LLM</option>
              <option value="image">图像</option>
              <option value="video">视频</option>
              <option value="audio">音频</option>
              <option value="embedding">嵌入</option>
            </select>
          </Field>
          <Field label="状态">
            <select
              className="input"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="active">正常</option>
              <option value="degraded">降级</option>
              <option value="offline">离线</option>
              <option value="unknown">未知</option>
            </select>
          </Field>
        </div>

        {/* LLM 字段 */}
        {isLLM && (
          <div className="form-grid">
            <Field label="上下文窗口 (tokens)">
              <input
                className="input"
                type="number"
                value={form.contextWindow}
                onChange={(e) => setForm({ ...form, contextWindow: e.target.value })}
              />
            </Field>
            <Field label="最大输出 tokens">
              <input
                className="input"
                type="number"
                value={form.maxOutputTokens}
                onChange={(e) => setForm({ ...form, maxOutputTokens: e.target.value })}
              />
            </Field>
          </div>
        )}

        {/* 视频字段 */}
        {isVideo && (
          <div className="form-grid">
            <Field label="最大时长 (秒)">
              <input
                className="input"
                type="number"
                value={form.maxDurationSec}
                onChange={(e) => setForm({ ...form, maxDurationSec: e.target.value })}
                placeholder="10"
              />
            </Field>
          </div>
        )}

        {/* 图片字段 */}
        {isImage && (
          <div className="form-grid">
            <Field label="支持的尺寸">
              <input
                className="input"
                value={form.supportedSizes}
                onChange={(e) => setForm({ ...form, supportedSizes: e.target.value })}
                placeholder="512x512, 1024x1024"
              />
              <small className="field-hint">用逗号分隔多个尺寸</small>
            </Field>
          </div>
        )}

        {/* fal.ai 快照字段 */}
        {(form.falPricing || form.falDescription || model.falParametersSnapshot) && (
          <div className="form-grid">
            <Field label="fal.ai 定价">
              <input
                className="input"
                value={form.falPricing}
                onChange={(e) => setForm({ ...form, falPricing: e.target.value })}
                placeholder="$0.05/秒..."
              />
            </Field>
            <Field label="fal.ai 描述">
              <input
                className="input"
                value={form.falDescription}
                onChange={(e) => setForm({ ...form, falDescription: e.target.value })}
                placeholder="fal.ai 描述..."
              />
            </Field>
          </div>
        )}

        <CapabilityGroup
          title="端点能力"
          values={form.endpointCaps}
          options={endpointOptions}
          onToggle={(value) => toggle("endpointCaps", value)}
        />
        <CapabilityGroup
          title="参数能力"
          values={form.paramCaps}
          options={paramOptions}
          onToggle={(value) => toggle("paramCaps", value)}
        />

        <div className="toggle-row">
          <label>
            <input
              type="checkbox"
              checked={form.supportsReasoning}
              onChange={(e) => setForm({ ...form, supportsReasoning: e.target.checked })}
            />
            支持推理
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.supportsFunctionCalling}
              onChange={(e) => setForm({ ...form, supportsFunctionCalling: e.target.checked })}
            />
            支持函数调用
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.supportsVision}
              onChange={(e) => setForm({ ...form, supportsVision: e.target.checked })}
            />
            支持视觉
          </label>
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
            需要异步
          </label>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "保存中..." : "保存修改"}
          </button>
        </div>
      </div>
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
  onToggle: (value: string) => void;
}) {
  return (
    <div className="field">
      <label className="label">{title}</label>
      <div className="choice-grid">
        {options.map((option) => (
          <label
            className={`choice ${values.includes(option) ? "selected" : ""}`}
            key={option}
          >
            <input
              type="checkbox"
              checked={values.includes(option)}
              onChange={() => onToggle(option)}
            />
            {option}
          </label>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
