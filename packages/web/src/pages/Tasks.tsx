import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

interface Task {
  id: string;
  type: string;
  status: string;
  site_id: string;
  variant_id: string;
  site_task_id: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  error: string | null;
  poll_count: number;
  callback_done: boolean;
}

const STATUS_COLOR: Record<string, string> = {
  pending: "#f59e0b",
  processing: "#3b82f6",
  completed: "#10b981",
  failed: "#ef4444",
  timeout: "#a855f7",
};

function fmt(ts: number | null) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

export default function TasksPage() {
  const status = new URLSearchParams(window.location.search).get("status") ?? "";
  const tasks = useQuery({
    queryKey: ["tasks", status],
    queryFn: () => api.get<{ data: Task[] }>(`/admin/tasks${status ? `?status=${status}` : ""}`),
    refetchInterval: 5000,
  });

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>异步任务</h2>
      <div style={{ marginBottom: 12 }}>
        {["", "pending", "processing", "completed", "failed", "timeout"].map((s) => (
          <a
            key={s}
            href={s ? `?status=${s}` : "/admin/tasks"}
            style={{
              display: "inline-block",
              padding: "4px 12px",
              marginRight: 4,
              borderRadius: 4,
              background: status === s ? "#2563eb" : "#f1f5f9",
              color: status === s ? "white" : "#475569",
              textDecoration: "none",
              fontSize: 13,
            }}
          >
            {s || "全部"}
          </a>
        ))}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>类型</th>
            <th>状态</th>
            <th>站点任务 ID</th>
            <th>轮询</th>
            <th>回调</th>
            <th>创建</th>
            <th>完成</th>
            <th>错误</th>
          </tr>
        </thead>
        <tbody>
          {tasks.data?.data.map((t) => (
            <tr key={t.id}>
              <td><code style={{ fontSize: 11 }}>{t.id.slice(0, 18)}…</code></td>
              <td>{t.type}</td>
              <td>
                <span
                  style={{
                    background: STATUS_COLOR[t.status] ?? "#94a3b8",
                    color: "white",
                    padding: "2px 8px",
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                >
                  {t.status}
                </span>
              </td>
              <td><code style={{ fontSize: 11 }}>{t.site_task_id ?? "—"}</code></td>
              <td>{t.poll_count}</td>
              <td>{t.callback_done ? "✓" : "—"}</td>
              <td style={{ fontSize: 12 }}>{fmt(t.created_at)}</td>
              <td style={{ fontSize: 12 }}>{fmt(t.completed_at)}</td>
              <td style={{ fontSize: 12, color: "#ef4444" }}>{t.error ?? ""}</td>
            </tr>
          ))}
          {!tasks.data?.data.length && (
            <tr>
              <td colSpan={9} style={{ textAlign: "center", color: "#94a3b8", padding: 32 }}>
                暂无任务
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
