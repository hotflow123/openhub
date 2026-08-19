import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

interface Site { id: string; name: string; status: string; lastError: string | null; }
interface Model { id: string; rawName: string; displayName: string | null; status: string; modality: string; siteName: string | null; }
interface Variant { id: string; name: string; modelId: string; }
interface Task { id: string; status: string; type: string; error: string | null; }

export default function OverviewPage() {
  const [sites, models, variants, tasks] = useQueries({ queries: [
    { queryKey: ["sites"], queryFn: () => api.get<{ data: Site[] }>("/admin/sites") },
    { queryKey: ["models"], queryFn: () => api.get<{ data: Model[] }>("/admin/models") },
    { queryKey: ["variants"], queryFn: () => api.get<{ data: Variant[] }>("/admin/variants") },
    { queryKey: ["tasks", "overview"], queryFn: () => api.get<{ data: Task[] }>("/admin/tasks") },
  ] });
  const siteRows = sites.data?.data ?? [];
  const modelRows = models.data?.data ?? [];
  const variantRows = variants.data?.data ?? [];
  const taskRows = tasks.data?.data ?? [];
  const activeTasks = taskRows.filter((task) => ["pending", "processing"].includes(task.status));
  const unknownModels = modelRows.filter((model) => model.status === "unknown" || model.status === "degraded");

  return <div className="page-stack">
    <header className="page-header">
      <div><p className="eyebrow">OPENHUB ADMIN</p><h2>运行概览</h2><p className="page-description">从站点接入开始，发现模型、确认能力，再生成可供调用的变体。</p></div>
      <Link className="btn btn-primary" to="/admin/sites">添加第一个站点</Link>
    </header>
    <section className="stat-grid">
      <Stat label="站点" value={siteRows.length} hint="New API 接入点" tone="blue" />
      <Stat label="已发现模型" value={modelRows.length} hint={`${unknownModels.length} 个需要确认`} tone="purple" />
      <Stat label="可调用变体" value={variantRows.length} hint="对外暴露的模型 ID" tone="green" />
      <Stat label="进行中任务" value={activeTasks.length} hint="每 5 秒自动刷新" tone="orange" />
    </section>
    <div className="overview-grid">
      <section className="panel"><div className="panel-heading"><div><h3>推荐操作</h3><p>按这条路径完成首次配置</p></div></div>
        <div className="workflow-list">
          <WorkflowStep number="01" title="添加 New API 站点" detail="填写 Base URL 和上游 API Key，系统会自动发现模型。" to="/admin/sites" done={siteRows.length > 0} />
          <WorkflowStep number="02" title="确认模型能力" detail="检查目录匹配、模态和端点能力，不确定的模型进入向导。" to="/admin/models" done={modelRows.length > 0 && unknownModels.length === 0} />
          <WorkflowStep number="03" title="生成调用变体" detail="配置默认参数、字段映射和业务限制，得到对外 model ID。" to="/admin/variants" done={variantRows.length > 0} />
          <WorkflowStep number="04" title="创建虚拟 Key" detail="限制 Key 可访问的变体，然后交给 OpenAI SDK 使用。" to="/admin/keys" done={false} />
        </div>
      </section>
      <section className="panel"><div className="panel-heading"><div><h3>站点健康</h3><p>连接状态和最近错误</p></div><Link to="/admin/sites" className="text-link">管理站点</Link></div>
        {siteRows.length ? <div className="compact-list">{siteRows.slice(0, 5).map((site) => <div className="compact-row" key={site.id}><span className={`status-dot ${site.status}`} /><div className="compact-main"><strong>{site.name}</strong><small>{site.lastError ?? site.status === "active" ? "连接正常" : "需要检查"}</small></div><span className={`badge badge-${site.status}`}>{site.status}</span></div>)}</div> : <Empty text="还没有站点，从添加站点开始。" to="/admin/sites" />}
      </section>
    </div>
    <section className="panel"><div className="panel-heading"><div><h3>待处理模型</h3><p>能力未知或状态异常的模型</p></div><Link to="/admin/models" className="text-link">查看全部</Link></div>
      {unknownModels.length ? <div className="compact-list">{unknownModels.slice(0, 6).map((model) => <div className="compact-row" key={model.id}><div className="compact-main"><strong>{model.displayName ?? model.rawName}</strong><small>{model.siteName ?? "未知站点"} · {model.modality}</small></div><Link className="btn btn-small" to={`/admin/wizard/${model.id}`}>配置向导</Link></div>)}</div> : <Empty text="当前没有待处理模型。" to="/admin/models" />}
    </section>
  </div>;
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint: string; tone: string }) { return <div className={`stat-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>; }
function WorkflowStep({ number, title, detail, to, done }: { number: string; title: string; detail: string; to: string; done: boolean }) { return <Link className="workflow-step" to={to}><span className="step-number">{done ? "✓" : number}</span><span><strong>{title}</strong><small>{detail}</small></span><span className="step-arrow">→</span></Link>; }
function Empty({ text, to }: { text: string; to: string }) { return <div className="empty-state"><span>{text}</span><Link className="text-link" to={to}>去处理</Link></div>; }
