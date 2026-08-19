import { Routes, Route, NavLink, Link } from "react-router-dom";
import OverviewPage from "./pages/Overview";
import SitesPage from "./pages/Sites";
import ModelsPage from "./pages/Models";
import KeysPage from "./pages/Keys";
import VariantsPage from "./pages/Variants";
import CatalogPage from "./pages/Catalog";
import WizardPage from "./pages/Wizard";
import TasksPage from "./pages/Tasks";

const navGroups = [
  { label: "配置中心", items: [["/admin/sites", "站点"], ["/admin/models", "模型"], ["/admin/variants", "变体"]] },
  { label: "运行管理", items: [["/admin/keys", "虚拟 Key"], ["/admin/tasks", "异步任务"]] },
  { label: "数据与审计", items: [["/admin/catalog", "模型目录"], ["/admin/audit", "审计日志"]] },
];

export default function App() {
  return <div className="app-shell">
    <aside className="sidebar">
      <Link to="/admin" className="brand"><span className="brand-mark">O</span><span><strong>OpenHub</strong><small>Model Gateway</small></span></Link>
      <nav className="nav-groups">
        <NavItem to="/admin" end>概览</NavItem>
        {navGroups.map((group) => <div className="nav-group" key={group.label}><span className="nav-label">{group.label}</span>{group.items.map(([to, label]) => <NavItem key={to} to={to}>{label}</NavItem>)}</div>)}
      </nav>
      <div className="sidebar-footer"><span className="status-dot active" />管理端在线</div>
    </aside>
    <main className="main-content"><Routes>
      <Route path="/admin" element={<OverviewPage />} />
      <Route path="/admin/sites" element={<SitesPage />} />
      <Route path="/admin/models" element={<ModelsPage />} />
      <Route path="/admin/variants" element={<VariantsPage />} />
      <Route path="/admin/keys" element={<KeysPage />} />
      <Route path="/admin/catalog" element={<CatalogPage />} />
      <Route path="/admin/tasks" element={<TasksPage />} />
      <Route path="/admin/audit" element={<AuditPage />} />
      <Route path="/admin/wizard/:modelId" element={<WizardPage />} />
      <Route path="*" element={<OverviewPage />} />
    </Routes></main>
  </div>;
}

function NavItem({ to, end, children }: { to: string; end?: boolean; children: React.ReactNode }) { return <NavLink end={end} to={to} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}><span className="nav-icon">{children === "概览" ? "⌂" : children === "站点" ? "◉" : children === "模型" ? "◇" : children === "变体" ? "◆" : children === "虚拟 Key" ? "⌁" : children === "异步任务" ? "◷" : "▤"}</span>{children}</NavLink>; }

function AuditPage() { return <div className="page-stack"><header className="page-header"><div><p className="eyebrow">OBSERVABILITY</p><h2>审计日志</h2><p className="page-description">记录管理端的创建、删除、撤销和配置操作。</p></div></header><AuditTable /></div>; }
function AuditTable() { const [rows, setRows] = React.useState<Array<{ id: string; actor: string; action: string; resourceType: string | null; status: string; createdAt: string }>>([]); React.useEffect(() => { fetch("/admin/audit?limit=100", { headers: { Authorization: "Basic " + btoa(`${import.meta.env.VITE_ADMIN_USER ?? "admin"}:${import.meta.env.VITE_ADMIN_PASS ?? "admin123"}`) } }).then((r) => r.json()).then((body) => setRows(body.data ?? [])).catch(() => setRows([])); }, []); return <section className="panel"><table className="data-table"><thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>资源</th><th>状态</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleString()}</td><td>{row.actor}</td><td><code>{row.action}</code></td><td>{row.resourceType ?? "—"}</td><td><span className={`badge badge-${row.status === "success" ? "active" : "error"}`}>{row.status}</span></td></tr>)}</tbody></table>{!rows.length && <div className="empty-state">暂无审计记录</div>}</section>; }
import React from "react";
