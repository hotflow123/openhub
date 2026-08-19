import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

interface SyncRun {
  id: string;
  status: "running" | "success" | "failed";
  totalRecords: number | null;
  addedRecords: number | null;
  updatedRecords: number | null;
  removedRecords: number | null;
  errorMessage: string | null;
  syncStartedAt: string;
  syncCompletedAt: string | null;
}

interface SchemaSyncRun {
  id: string;
  status: "running" | "success" | "failed";
  sourceFile: string | null;
  recordCount: number | null;
  changedCount: number | null;
  aliasCount: number | null;
  errorMessage: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  triggeredBy: string | null;
  updated?: number;
}

interface CatalogEntry {
  id: string;
  name: string;
  family: string | null;
  contextLimit: number | null;
  outputLimit: number | null;
  modalitiesIn: string | null;
  modalitiesOut: string | null;
}

interface SchemaEntry {
  endpointId: string;
  title: string;
  modality: string;
  falCategory: string | null;
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
}

interface SchemaDetail {
  endpointId: string;
  title: string;
  modality: string;
  falCategory: string | null;
  falSource: string | null;
  description: string | null;
  pricing: string | null;
  apiDocs: string | null;
  status: string;
  parameters: Array<{
    name: string;
    type: string;
    required: boolean;
    nullable?: boolean;
    default?: unknown;
    enum?: unknown[];
    description?: string;
    examples?: unknown[];
  }>;
  inputSchema: object | null;
  outputSchema: object | null;
}

interface SchemaSyncResult {
  status: "success" | "failed";
  total: number;
  added: number;
  updated: number;
  aliases: number;
  errorMessage?: string;
  durationMs: number;
}

export default function CatalogPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [schemaQ, setSchemaQ] = useState("");
  const [activeTab, setActiveTab] = useState<"openrouter" | "fal">("openrouter");
  const [detailModel, setDetailModel] = useState<SchemaEntry | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const runs = useQuery({
    queryKey: ["catalog", "runs"],
    queryFn: () => api.get<{ data: SyncRun[] }>("/admin/catalog/runs"),
  });

  const schemaRuns = useQuery({
    queryKey: ["catalog", "schema-runs"],
    queryFn: () => api.get<{ data: SchemaSyncRun[] }>("/admin/catalog/schema-runs"),
    enabled: activeTab === "fal",
  });

  const catalog = useQuery({
    queryKey: ["catalog", "list", q],
    queryFn: () => api.get<{ data: CatalogEntry[] }>(`/admin/catalog?q=${encodeURIComponent(q)}`),
    enabled: activeTab === "openrouter",
  });

  const schemas = useQuery({
    queryKey: ["catalog", "schema", schemaQ],
    queryFn: () =>
      api.get<{ data: SchemaEntry[] }>(
        `/admin/catalog/schema?q=${encodeURIComponent(schemaQ)}&limit=100`,
      ),
    enabled: activeTab === "fal",
  });

  const sync = useMutation({
    mutationFn: () => api.post<{ data: SyncRun }>("/admin/catalog/sync"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalog"] });
      qc.invalidateQueries({ queryKey: ["models"] });
    },
  });

  const rematch = useMutation({
    mutationFn: () => api.post("/admin/catalog/rematch"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["models"] }),
  });

  const syncSchema = useMutation({
    mutationFn: () => api.post<{ data: SchemaSyncResult }>("/admin/catalog/sync-schema"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalog"] });
      qc.invalidateQueries({ queryKey: ["models"] });
    },
  });

  const openDetail = useCallback(
    async (entry: SchemaEntry) => {
      setDetailModel(entry);
      setDetailLoading(true);
      try {
        const res = await api.get<{ data: SchemaDetail }>(
          `/admin/catalog/schema/${encodeURIComponent(entry.endpointId)}`,
        );
        setDetailModel(res.data as unknown as SchemaEntry);
      } catch {
        /* ignore */
      } finally {
        setDetailLoading(false);
      }
    },
    [],
  );

  const closeDetail = () => {
    setDetailModel(null);
    setDetailLoading(false);
  };

  return (
    <div className="page-stack">
      {/* ── Detail Modal ── */}
      {detailModel && (
        <SchemaDetailModal
          entry={detailModel as unknown as SchemaEntry}
          detail={detailModel as unknown as SchemaDetail}
          loading={detailLoading}
          onClose={closeDetail}
        />
      )}

      <header className="page-header">
        <div>
          <p className="eyebrow">MODEL CATALOG</p>
          <h2>模型目录</h2>
          <p className="page-description">
            管理从 OpenRouter 和 fal.ai 同步的模型能力数据。目录为实例匹配提供参考。
          </p>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-primary"
            disabled={sync.isPending}
            onClick={() => sync.mutate()}
          >
            {sync.isPending ? "同步中..." : "立即同步"}
          </button>
          <button
            className="btn"
            disabled={rematch.isPending}
            onClick={() => rematch.mutate()}
          >
            {rematch.isPending ? "处理中..." : "重新匹配"}
          </button>
        </div>
      </header>

      <div className="catalog-tabs">
        <button
          className={`tab-button ${activeTab === "openrouter" ? "active" : ""}`}
          onClick={() => setActiveTab("openrouter")}
        >
          OpenRouter 目录
        </button>
        <button
          className={`tab-button ${activeTab === "fal" ? "active" : ""}`}
          onClick={() => setActiveTab("fal")}
        >
          fal.ai Schema
          <button
            className="btn btn-sm btn-outline"
            style={{ marginLeft: 8, padding: "2px 8px" }}
            disabled={syncSchema.isPending}
            onClick={(e) => {
              e.stopPropagation();
              syncSchema.mutate();
            }}
          >
            {syncSchema.isPending ? "同步中..." : "同步 Schema"}
          </button>
        </button>
      </div>

      {activeTab === "openrouter" ? (
        <>
          <section className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-heading">
              <div>
                <h3>最近同步</h3>
                <p>OpenRouter 目录同步历史</p>
              </div>
            </div>
            {runs.data?.data.length === 0 ? (
              <div className="empty-state">暂无同步记录</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>开始时间</th>
                    <th>状态</th>
                    <th>总数</th>
                    <th>新增</th>
                    <th>更新</th>
                    <th>远端移除</th>
                    <th>耗时</th>
                    <th>错误</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.data?.data.map((r) => (
                    <tr key={r.id}>
                      <td>{new Date(r.syncStartedAt).toLocaleString()}</td>
                      <td>
                        <span className={`badge badge-${r.status === "success" ? "active" : "error"}`}>
                          {r.status}
                        </span>
                      </td>
                      <td>{r.totalRecords ?? "—"}</td>
                      <td>{r.addedRecords ?? "—"}</td>
                      <td>{r.updatedRecords ?? "—"}</td>
                      <td>{r.removedRecords ?? "—"}</td>
                      <td>
                        {r.syncCompletedAt
                          ? `${(new Date(r.syncCompletedAt).getTime() - new Date(r.syncStartedAt).getTime()) / 1000}s`
                          : "—"}
                      </td>
                      <td style={{ color: "#dc2626", fontSize: 12 }}>{r.errorMessage ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <div className="toolbar">
            <input
              className="input search-input"
              placeholder="按名称搜索..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="toolbar-meta">共 {catalog.data?.data.length ?? 0} 条记录</span>
          </div>

          <section className="panel table-panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>名称</th>
                  <th>Family</th>
                  <th>Context</th>
                  <th>输出</th>
                  <th>输入模态</th>
                  <th>输出模态</th>
                </tr>
              </thead>
              <tbody>
                {catalog.data?.data.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <code style={{ fontSize: 12 }}>{c.id}</code>
                    </td>
                    <td>{c.name}</td>
                    <td>{c.family ?? "—"}</td>
                    <td>{c.contextLimit ?? "—"}</td>
                    <td>{c.outputLimit ?? "—"}</td>
                    <td>{safeJson(c.modalitiesIn)}</td>
                    <td>{safeJson(c.modalitiesOut)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!catalog.data?.data.length && <div className="empty-state">暂无数据</div>}
          </section>
        </>
      ) : (
        <>
          <section className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-heading">
              <div>
                <h3>fal.ai Schema 同步历史</h3>
                <p>从本地 fal_model_encyclopedia.json 同步 · 双击任意行查看完整参数</p>
              </div>
            </div>
            {schemaRuns.data?.data.length === 0 ? (
              <div className="empty-state">暂无同步记录，请点击上方"同步 Schema"按钮</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>开始时间</th>
                    <th>状态</th>
                    <th>总数</th>
                    <th>新增</th>
                    <th>更新</th>
                    <th>别名</th>
                    <th>耗时</th>
                    <th>错误</th>
                  </tr>
                </thead>
                <tbody>
                  {schemaRuns.data?.data.map((r) => (
                    <tr key={r.id}>
                      <td>{r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}</td>
                      <td>
                        <span className={`badge badge-${r.status === "success" ? "active" : "error"}`}>
                          {r.status}
                        </span>
                      </td>
                      <td>{r.recordCount ?? "—"}</td>
                      <td>{r.changedCount ? r.changedCount - (r.updated ?? 0) : "—"}</td>
                      <td>{r.updated ?? "—"}</td>
                      <td>{r.aliasCount ?? "—"}</td>
                      <td>
                        {r.startedAt && r.finishedAt
                          ? `${((r.finishedAt - r.startedAt) / 1000).toFixed(2)}s`
                          : "—"}
                      </td>
                      <td style={{ color: "#dc2626", fontSize: 12 }}>{r.errorMessage ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <div className="toolbar">
            <input
              className="input search-input"
              placeholder="搜索 fal.ai 模型（标题、endpointId）..."
              value={schemaQ}
              onChange={(e) => setSchemaQ(e.target.value)}
            />
            <span className="toolbar-meta">
              共 {schemas.data?.data.length ?? 0} 条记录 · 双击行查看完整参数
            </span>
          </div>

          <section className="panel table-panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>标题</th>
                  <th>Endpoint ID</th>
                  <th>模态</th>
                  <th>分类</th>
                  <th>Source</th>
                  <th>参数</th>
                  <th>必填参数</th>
                  <th>分辨率</th>
                  <th>时长</th>
                  <th>定价</th>
                  <th>关联</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {schemas.data?.data.map((s) => (
                  <tr
                    key={s.endpointId}
                    onDoubleClick={() => openDetail(s)}
                    style={{ cursor: "pointer" }}
                    title="双击查看完整参数"
                  >
                    <td>
                      <strong>{s.title}</strong>
                    </td>
                    <td>
                      <code style={{ fontSize: 10 }}>{s.endpointId}</code>
                    </td>
                    <td>
                      <span className="badge badge-neutral">{s.modality}</span>
                    </td>
                    <td>
                      <small style={{ color: "#64748b" }}>{s.falCategory ?? "—"}</small>
                    </td>
                    <td>
                      {s.falSource ? (
                        <span
                          className={`badge ${s.falSource === "queue" ? "badge-active" : "badge-neutral"}`}
                        >
                          {s.falSource}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <span className="badge badge-neutral">{s.parametersCount}</span>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                        {s.requiredParams.length > 0 ? (
                          s.requiredParams.map((p) => (
                            <span key={p} className="badge badge-error" style={{ fontSize: 10 }}>
                              {p}
                            </span>
                          ))
                        ) : (
                          <span style={{ color: "#64748b", fontSize: 11 }}>—</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                        {s.resolutionEnum.length > 0 ? (
                          s.resolutionEnum.slice(0, 3).map((r) => (
                            <span key={r} className="badge badge-neutral" style={{ fontSize: 10 }}>
                              {r}
                            </span>
                          ))
                        ) : s.resolutionEnum.length > 3 ? (
                          <span style={{ color: "#64748b", fontSize: 11 }}>
                            +{s.resolutionEnum.length - 3}
                          </span>
                        ) : (
                          <span style={{ color: "#64748b", fontSize: 11 }}>—</span>
                        )}
                      </div>
                    </td>
                    <td>
                      {s.durationEnum.length > 0 ? (
                        <span style={{ color: "#64748b", fontSize: 11 }}>
                          {s.durationEnum.length === 28
                            ? `4–30s`
                            : s.durationEnum.length > 1
                              ? `${s.durationEnum[0]}…${s.durationEnum[s.durationEnum.length - 1]}`
                              : String(s.durationEnum[0])}
                        </span>
                      ) : (
                        <span style={{ color: "#64748b", fontSize: 11 }}>—</span>
                      )}
                    </td>
                    <td>
                      <span style={{ color: "#64748b", fontSize: 11 }}>
                        {s.pricing
                          ? (s.pricing as string).substring(0, 20) + ((s.pricing as string).length > 20 ? "…" : "")
                          : "—"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        <span title="别名数" style={{ fontSize: 11 }}>
                          <span style={{ color: "#64748b" }}>别</span> {s.aliasCount}
                        </span>
                        <span title="已关联模型数" style={{ fontSize: 11 }}>
                          <span style={{ color: "#64748b" }}>关</span> {s.matchedCount}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className={`badge badge-${s.status === "ok" ? "active" : "error"}`}>
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!schemas.data?.data.length && <div className="empty-state">暂无数据</div>}
          </section>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema Detail Modal
// ─────────────────────────────────────────────────────────────────────────────

function SchemaDetailModal({
  entry,
  detail,
  loading,
  onClose,
}: {
  entry: SchemaEntry;
  detail: SchemaEntry | SchemaDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  const d = detail ?? entry;
  const params: SchemaDetail["parameters"] =
    "parameters" in d && Array.isArray((d as SchemaDetail).parameters)
      ? (d as SchemaDetail).parameters
      : [];

  const inputSchema =
    "inputSchema" in d && (d as SchemaDetail).inputSchema
      ? (d as SchemaDetail).inputSchema
      : null;
  const outputSchema =
    "outputSchema" in d && (d as SchemaDetail).outputSchema
      ? (d as SchemaDetail).outputSchema
      : null;

  return (
    <>
      {/* Backdrop */}
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

      {/* Modal */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(860px, 95vw)",
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
              <span className={`badge badge-${d.modality === "video" ? "active" : "neutral"}`}>
                {d.modality}
              </span>
              <span style={{ color: "#64748b", fontSize: 12 }}>{d.falCategory}</span>
              {d.falSource && (
                <span
                  className={`badge ${d.falSource === "queue" ? "badge-active" : "badge-neutral"}`}
                  style={{ fontSize: 10 }}
                >
                  {d.falSource}
                </span>
              )}
              <span className={`badge badge-${d.status === "ok" ? "active" : "error"}`}>
                {d.status}
              </span>
            </div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{d.title}</h3>
            <code style={{ fontSize: 11, color: "#64748b", marginTop: 4, display: "block" }}>
              {d.endpointId}
            </code>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {d.apiDocs && (
              <a
                href={d.apiDocs as string}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-sm"
              >
                API 文档
              </a>
            )}
            <button className="btn btn-sm" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>
              加载参数详情…
            </div>
          ) : (
            <>
              {/* Meta */}
              {(d as SchemaDetail).description && (
                <p
                  style={{
                    color: "#94a3b8",
                    fontSize: 13,
                    margin: "0 0 16px",
                    lineHeight: 1.6,
                  }}
                >
                  {(d as SchemaDetail).description}
                </p>
              )}

              {(d as SchemaDetail).pricing && (
                <div
                  style={{
                    display: "inline-block",
                    background: "rgba(34,197,94,0.1)",
                    border: "1px solid rgba(34,197,94,0.3)",
                    borderRadius: 6,
                    padding: "4px 10px",
                    fontSize: 12,
                    color: "#4ade80",
                    marginBottom: 16,
                  }}
                >
                  💰 {(d as SchemaDetail).pricing}
                </div>
              )}

              {/* Parameters Table */}
              {params.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <h4 style={{ margin: "0 0 10px", fontSize: 13, color: "#94a3b8" }}>
                    输入参数 ({params.length})
                  </h4>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 12,
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          background: "rgba(255,255,255,0.04)",
                          borderBottom: "1px solid var(--border-color, #3a3a4a)",
                        }}
                      >
                        <th style={{ padding: "6px 10px", textAlign: "left", color: "#94a3b8" }}>
                          参数名
                        </th>
                        <th style={{ padding: "6px 10px", textAlign: "left", color: "#94a3b8" }}>
                          类型
                        </th>
                        <th style={{ padding: "6px 10px", textAlign: "left", color: "#94a3b8" }}>
                          必填
                        </th>
                        <th style={{ padding: "6px 10px", textAlign: "left", color: "#94a3b8" }}>
                          默认值
                        </th>
                        <th style={{ padding: "6px 10px", textAlign: "left", color: "#94a3b8" }}>
                          枚举 / 约束
                        </th>
                        <th style={{ padding: "6px 10px", textAlign: "left", color: "#94a3b8" }}>
                          说明
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {params.map((p) => (
                        <tr
                          key={p.name}
                          style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                        >
                          <td style={{ padding: "6px 10px" }}>
                            <code
                              style={{
                                fontSize: 11,
                                color: p.required ? "#fb923c" : "#60a5fa",
                                fontWeight: p.required ? 600 : 400,
                              }}
                            >
                              {p.name}
                            </code>
                          </td>
                          <td style={{ padding: "6px 10px", color: "#94a3b8" }}>{p.type}</td>
                          <td style={{ padding: "6px 10px" }}>
                            {p.required ? (
                              <span
                                style={{
                                  color: "#f87171",
                                  fontSize: 11,
                                  fontWeight: 600,
                                }}
                              >
                                必填
                              </span>
                            ) : (
                              <span style={{ color: "#64748b", fontSize: 11 }}>可选</span>
                            )}
                          </td>
                          <td style={{ padding: "6px 10px", color: "#94a3b8", fontSize: 11 }}>
                            {p.default !== undefined && p.default !== null
                              ? JSON.stringify(p.default)
                              : "—"}
                          </td>
                          <td style={{ padding: "6px 10px", color: "#94a3b8", fontSize: 11 }}>
                            {p.enum && Array.isArray(p.enum) ? (
                              <span>
                                {p.enum.length <= 6
                                  ? p.enum.map((v) => (
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
                                  : `${p.enum.length} 个值`}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td
                            style={{
                              padding: "6px 10px",
                              color: "#94a3b8",
                              fontSize: 11,
                              maxWidth: 200,
                            }}
                          >
                            {p.description ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Input Schema JSON */}
              {inputSchema && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "#94a3b8" }}>
                    Input Schema（完整 JSON）
                  </h4>
                  <pre
                    style={{
                      background: "rgba(0,0,0,0.3)",
                      border: "1px solid var(--border-color, #3a3a4a)",
                      borderRadius: 6,
                      padding: 12,
                      fontSize: 11,
                      color: "#a5f3fc",
                      overflow: "auto",
                      maxHeight: 200,
                      margin: 0,
                      lineHeight: 1.5,
                    }}
                  >
                    {JSON.stringify(inputSchema, null, 2)}
                  </pre>
                </div>
              )}

              {/* Output Schema JSON */}
              {outputSchema && (
                <div>
                  <h4 style={{ margin: "0 0 8px", fontSize: 13, color: "#94a3b8" }}>
                    Output Schema（完整 JSON）
                  </h4>
                  <pre
                    style={{
                      background: "rgba(0,0,0,0.3)",
                      border: "1px solid var(--border-color, #3a3a4b)",
                      borderRadius: 6,
                      padding: 12,
                      fontSize: 11,
                      color: "#86efac",
                      overflow: "auto",
                      maxHeight: 200,
                      margin: 0,
                      lineHeight: 1.5,
                    }}
                  >
                    {JSON.stringify(outputSchema, null, 2)}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function safeJson(s: string | null): string {
  if (!s) return "—";
  try {
    return (JSON.parse(s) as string[]).join(", ");
  } catch {
    return s;
  }
}
