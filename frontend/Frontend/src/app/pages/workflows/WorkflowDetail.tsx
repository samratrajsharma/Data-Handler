import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { workflowApi } from "../../../shared/api/workflows";

interface WorkflowStep {
  name: string; step_type?: string; type?: string; status: string; result?: unknown;
}

export default function WorkflowDetail() {
  const { id } = useParams<{ id: string }>();
  const [workflow, setWorkflow] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = () => {
      workflowApi.get(id)
        .then((r) => {
          if (cancelled) return;
          setWorkflow(r.data);
          setLoading(false);
          const s = String((r.data as { status?: string })?.status || "");
          if (s !== "completed" && s !== "failed") {
            timer = setTimeout(poll, 5000);
          }
        })
        .catch(() => {
          if (!cancelled) setLoading(false);
        });
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  if (loading) return <div className="empty-state"><h3>Loading...</h3></div>;
  if (!workflow) return <div className="empty-state"><h3>Workflow not found</h3></div>;

  const steps = (workflow.steps as WorkflowStep[]) || [];
  const statusColor = (s: string) => {
    if (s === "completed") return "var(--dash-success)";
    if (s === "failed") return "var(--dash-danger)";
    if (s === "running") return "var(--dash-warning)";
    return "var(--dash-text-muted)";
  };

  return (
    <div>
      <div className="page-header">
        <p style={{marginBottom:4}}><Link to="/workflows" style={{color:"var(--dash-primary)"}}>\u2190 Workflows</Link></p>
        <h1>{String(workflow.name)}</h1>
        <p>{String(workflow.description || "")}</p>
      </div>

      <div className="stats-grid" style={{gridTemplateColumns: "repeat(4, 1fr)"}}>
        <div className="stat-card">
          <div className="stat-card__label">Status</div>
          <div className="stat-card__value" style={{fontSize: 18, color: statusColor(String(workflow.status))}}>{String(workflow.status)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">Progress</div>
          <div className="stat-card__value">{String(workflow.current_step)}/{steps.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">Started</div>
          <div className="stat-card__value" style={{fontSize: 15}}>{workflow.started_at ? new Date(String(workflow.started_at)).toLocaleString() : "\u2014"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">Completed</div>
          <div className="stat-card__value" style={{fontSize: 15}}>{workflow.completed_at ? new Date(String(workflow.completed_at)).toLocaleString() : "\u2014"}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>Pipeline Steps</h3></div>
        <div style={{display:"flex", flexDirection:"column", gap: 2}}>
          {steps.map((step, i) => (
            <div key={i} style={{display:"flex", alignItems:"center", gap: 16, padding: "14px 16px",
              background: step.status === "running" ? "var(--dash-primary-dim)" : "transparent", borderRadius: 8}}>
              <div style={{width: 28, height: 28, borderRadius: "50%", display:"flex", alignItems:"center", justifyContent:"center",
                background: step.status === "completed" ? "var(--dash-success)" : step.status === "running" ? "var(--dash-warning)" :
                  step.status === "failed" ? "var(--dash-danger)" : "var(--dash-surface-hover)",
                color: step.status !== "pending" ? "#fff" : "var(--dash-text-secondary)", fontSize: 13, fontWeight: 700}}>
                {step.status === "completed" ? "\u2713" : i + 1}
              </div>
              <div style={{flex: 1}}>
                <div style={{fontWeight: 600, fontSize: 15, color: "var(--dash-text)"}}>{step.name || step.step_type || step.type}</div>
                <div style={{fontSize: 13, color: "var(--dash-text-muted)"}}>{step.step_type || step.type}</div>
              </div>
              <span className={`badge ${step.status === "completed" ? "badge--success" : step.status === "running" ? "badge--warning" :
                step.status === "failed" ? "badge--danger" : "badge--neutral"}`}>{step.status}</span>
            </div>
          ))}
        </div>
      </div>

      {Boolean(workflow.result) && (
        <div className="card" style={{marginTop: 20}}>
          <div className="card-header"><h3>Result</h3></div>
          <pre style={{fontSize: 13, color: "var(--dash-text-secondary)", overflow: "auto", maxHeight: 300, whiteSpace: "pre-wrap"}}>
            {JSON.stringify(workflow.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
