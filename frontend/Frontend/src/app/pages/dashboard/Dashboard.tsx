import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { taskApi } from "../../../shared/api/tasks";
import "./Dashboard.css";

// Phase C — single-user dashboard. The admin-stats grid (total_users,
// active_users, etc.) is gone with the rest of the multi-tenant surface.
// What remains is Quick Actions + Recent Tasks, which is the useful bit
// for a single user.

// Aligned to the actual flow: bring data in, then one entry point per mode.
const QUICK_ACTIONS = [
  {
    to: "/datasets", label: "New dataset", desc: "Add CSV, images, or text",
    color: "indigo", icon: "M12 5v14M5 12h14",
  },
  {
    to: "/structuring", label: "Structure & clean", desc: "Tidy tabular data",
    color: "cyan", icon: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  },
  {
    to: "/annotate", label: "Annotate images", desc: "Draw boxes & labels",
    color: "emerald", icon: "M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 21",
  },
  {
    to: "/text-labeling", label: "Label text", desc: "Document classes & spans",
    color: "amber", icon: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M16 13H8M16 17H8M10 9H8",
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
        <p>Bring data in, label it, and export it — pick up where you left off below.</p>
      </div>

      <div className="dash-stack">
        <div className="card">
          <div className="card-header">
            <h3>Quick actions</h3>
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
            <h3>Recent tasks</h3>
            <Link to="/tasks" className="btn btn--sm btn--secondary">View all</Link>
          </div>
          {recentTasks.length === 0 ? (
            <div className="empty-state"><h3>No tasks yet</h3><p>Runs you kick off — cleaning, labelling, exports — show up here.</p></div>
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
