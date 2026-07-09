import { useState, useEffect, useCallback } from "react";
import { taskApi } from "../../../shared/api/tasks";

interface TaskItem {
  id: string; celery_task_id: string; task_type: string; status: string;
  progress: number; progress_message?: string; dataset_id?: string;
  result?: unknown; error?: string; created_at: string; completed_at?: string;
}

export default function Tasks() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<TaskItem | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    taskApi.list({
      status: statusFilter || undefined,
      task_type: typeFilter || undefined,
      skip: page * 20, limit: 20,
    }).then((r) => {
      setTasks(r.data.tasks || []);
      setTotal(r.data.total || 0);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [statusFilter, typeFilter, page]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const statusColor = (s: string) => {
    if (s === "completed") return "badge--success";
    if (s === "failed") return "badge--danger";
    if (s === "progress" || s === "running" || s === "started") return "badge--warning";
    return "badge--neutral";
  };

  const statusDot = (s: string) => {
    if (s === "completed") return "success";
    if (s === "failed") return "danger";
    if (s === "progress" || s === "running" || s === "started") return "warning";
    return "neutral";
  };

  return (
    <div>
      <div className="page-header">
        <h1>Background Tasks</h1>
        <p>Monitor all async pipeline operations</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Tasks ({total})</h3>
          <div style={{display:"flex", gap: 8}}>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
              style={{padding: "6px 12px", background: "var(--dash-bg)", border: "1px solid var(--dash-border)", borderRadius: 8, color: "var(--dash-text)", fontSize: 13}}>
              <option value="">All status</option>
              <option value="pending">Pending</option>
              <option value="progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
            <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
              style={{padding: "6px 12px", background: "var(--dash-bg)", border: "1px solid var(--dash-border)", borderRadius: 8, color: "var(--dash-text)", fontSize: 13}}>
              <option value="">All types</option>
              <option value="structuring">Structuring</option>
              <option value="eda">EDA</option>
              <option value="labeling">Labeling</option>
              <option value="ai_labeling">AI Labeling</option>
              <option value="image_embeddings">Image Embeddings</option>
              <option value="image_clustering">Image Clustering</option>
              <option value="quality_eval">Quality Eval</option>
              <option value="export">Export</option>
              <option value="workflow">Workflow</option>
            </select>
          </div>
        </div>

        {loading && tasks.length === 0 ? <div className="empty-state"><h3>Loading...</h3></div> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Type</th><th>Status</th><th>Progress</th><th>Created</th><th>Completed</th><th></th></tr></thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td style={{color: "var(--dash-text)", fontWeight: 500}}>{t.task_type}</td>
                    <td>
                      <span className={`badge ${statusColor(t.status)}`}>
                        <span className={`badge-dot badge-dot--${statusDot(t.status)}`} />
                        {t.status}
                      </span>
                    </td>
                    <td>
                      <div style={{display:"flex", alignItems:"center", gap: 8}}>
                        <div className="progress-bar" style={{flex: 1, maxWidth: 100}}>
                          <div className="progress-bar__fill" style={{width: `${Math.round((t.progress || 0) * 100)}%`}} />
                        </div>
                        <span style={{fontSize: 12, color: "var(--dash-text-muted)"}}>{Math.round((t.progress || 0) * 100)}%</span>
                      </div>
                    </td>
                    <td>{new Date(t.created_at).toLocaleString()}</td>
                    <td>{t.completed_at ? new Date(t.completed_at).toLocaleString() : "\u2014"}</td>
                    <td><button className="btn btn--sm btn--secondary" onClick={() => setSelected(t)}>Details</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 20 && (
          <div style={{display:"flex", justifyContent:"center", gap: 12, marginTop: 16}}>
            <button className="btn btn--sm btn--secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
            <span style={{fontSize: 13, color: "var(--dash-text-muted)", padding: "6px 0"}}>Page {page + 1} of {Math.ceil(total / 20)}</span>
            <button className="btn btn--sm btn--secondary" disabled={(page + 1) * 20 >= total} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </div>

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Task Details</h2>
            <div style={{display:"grid", gridTemplateColumns:"120px 1fr", gap: "8px 16px", fontSize: 13, marginBottom: 16}}>
              <span style={{color: "var(--dash-text-muted)"}}>ID:</span><span style={{color: "var(--dash-text)"}}>{selected.id}</span>
              <span style={{color: "var(--dash-text-muted)"}}>Celery ID:</span><span style={{color: "var(--dash-text)", wordBreak: "break-all"}}>{selected.celery_task_id}</span>
              <span style={{color: "var(--dash-text-muted)"}}>Type:</span><span style={{color: "var(--dash-text)"}}>{selected.task_type}</span>
              <span style={{color: "var(--dash-text-muted)"}}>Status:</span><span className={`badge ${statusColor(selected.status)}`}>{selected.status}</span>
              <span style={{color: "var(--dash-text-muted)"}}>Progress:</span><span style={{color: "var(--dash-text)"}}>{selected.progress}%</span>
            </div>
            {selected.error && (
              <div style={{background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8, padding: 12, marginBottom: 16}}>
                <strong style={{color: "var(--dash-danger)", fontSize: 13}}>Error:</strong>
                <pre style={{fontSize: 12, color: "var(--dash-danger)", marginTop: 4, whiteSpace: "pre-wrap"}}>{selected.error}</pre>
              </div>
            )}
            {Boolean(selected.result) && (
              <div>
                <strong style={{fontSize: 13, color: "var(--dash-text)"}}>Result:</strong>
                <pre style={{fontSize: 12, color: "var(--dash-text-secondary)", marginTop: 4, overflow: "auto", maxHeight: 200, whiteSpace: "pre-wrap"}}>
                  {JSON.stringify(selected.result, null, 2)}
                </pre>
              </div>
            )}
            <button className="btn btn--secondary" style={{marginTop: 16}} onClick={() => setSelected(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
