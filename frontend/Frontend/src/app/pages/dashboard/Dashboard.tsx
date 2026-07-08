import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { taskApi } from "../../../shared/api/tasks";
import "./Dashboard.css";

// Phase C — single-user dashboard. The admin-stats grid (total_users,
// active_users, etc.) is gone with the rest of the multi-tenant surface.
// What remains is Quick Actions + Recent Tasks, which is the useful bit
// for a single user.

const QUICK_ACTIONS = [
  {
    to: "/datasets", label: "New Dataset", desc: "Ingest a CSV or JSON file",
    color: "indigo", icon: "M12 5v14M5 12h14",
  },
  {
    to: "/workflows", label: "Run Workflow", desc: "Orchestrate a pipeline",
    color: "cyan", icon: "M8 5v14l11-7z",
  },
  {
    to: "/llm", label: "Configure LLM", desc: "Connect model providers",
    color: "amber", icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  },
  {
    to: "/images", label: "Image Pipeline", desc: "Upload & embed images",
    color: "emerald", icon: "M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 21",
  },
];

export default function Dashboard() {
  const [recentTasks, setRecentTasks] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    taskApi.list({ limit: 8 }).then((r) => setRecentTasks(r.data.tasks || [])).catch(() => {});
  }, []);

  const statusColor = (s: string) => {
    if (s === "completed") return "badge--success";
    if (s === "failed") return "badge--danger";
    if (s === "running" || s === "started") return "badge--warning";
    return "badge--neutral";
  };

  return (
    <div>
      <div className="page-header">
        <h1>Welcome back</h1>
        <p>Here’s what’s happening across your workspace</p>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-header">
            <h3>Quick Actions</h3>
          </div>
          <div className="qa-grid">
            {QUICK_ACTIONS.map((a) => (
              <Link key={a.to} to={a.to} className="qa-tile">
                <span className={`qa-tile__icon qa-tile__icon--${a.color}`}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d={a.icon} />
                  </svg>
                </span>
                <span className="qa-tile__text">
                  <span className="qa-tile__label">{a.label}</span>
                  <span className="qa-tile__desc">{a.desc}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Recent Tasks</h3>
            <Link to="/tasks" className="btn btn--sm btn--secondary">View all</Link>
          </div>
          {recentTasks.length === 0 ? (
            <div className="empty-state"><h3>No tasks yet</h3></div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Type</th><th>Status</th><th>Created</th></tr></thead>
                <tbody>
                  {recentTasks.map((t) => (
                    <tr key={String(t.id)}>
                      <td style={{color: "var(--dash-text)"}}>{String(t.task_type)}</td>
                      <td><span className={`badge ${statusColor(String(t.status))}`}>
                        <span className={`badge-dot badge-dot--${String(t.status) === "completed" ? "success" : String(t.status) === "failed" ? "danger" : "warning"}`} />
                        {String(t.status)}
                      </span></td>
                      <td>{new Date(String(t.created_at)).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
