import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { datasetApi } from "../../../shared/api/datasets";
import { workflowApi } from "../../../shared/api/workflows";

interface Workflow {
  id: string; name: string; status: string; current_step: number;
  total_steps: number; message?: string;
}

interface Template {
  id: string; name: string; description?: string; steps: unknown[];
  category?: string; is_builtin: boolean;
}

export default function Workflows() {
  const [tab, setTab] = useState<"list" | "create" | "templates">("list");
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [datasets, setDatasets] = useState<Array<{id:string; name:string}>>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      workflowApi.list().then((r) => setWorkflows(Array.isArray(r.data) ? r.data : [])),
      workflowApi.getTemplates().then((r) => setTemplates(Array.isArray(r.data) ? r.data : [])),
      datasetApi.list({ limit: 100 }).then((r) => setDatasets((Array.isArray(r.data) ? r.data : r.data.datasets || []).filter((d: {source_type?: string}) => d.source_type !== "image"))),
    ]).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!name || !datasetId) return;
    try {
      const tmpl = templates.find((t) => t.id === selectedTemplate);
      await workflowApi.create({
        name, description, dataset_id: datasetId,
        steps: tmpl ? tmpl.steps as Record<string, unknown>[] : [],
        template_id: selectedTemplate || undefined,
      });
      setTab("list"); load();
      setName(""); setDescription(""); setDatasetId("");
    } catch { alert("Failed"); }
  };

  const handlePause = async (id: string) => {
    try { await workflowApi.pause(id); load(); } catch { alert("Failed"); }
  };
  const handleResume = async (id: string) => {
    try { await workflowApi.resume(id); load(); } catch { alert("Failed"); }
  };
  const handleDelete = async (id: string) => {
    if (!confirm("Delete this workflow?")) return;
    try { await workflowApi.delete(id); load(); } catch { alert("Failed"); }
  };

  const statusColor = (s: string) => {
    if (s === "completed") return "badge--success";
    if (s === "failed") return "badge--danger";
    if (s === "running") return "badge--warning";
    if (s === "paused") return "badge--info";
    return "badge--neutral";
  };

  return (
    <div>
      <div className="page-header" style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start"}}>
        <div>
          <h1>Workflows</h1>
          <p>Orchestrate multi-step data pipelines</p>
        </div>
        <button className="btn btn--primary" onClick={() => setTab("create")}>+ New Workflow</button>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "list" ? "tab--active" : ""}`} onClick={() => setTab("list")}>Workflows</button>
        <button className={`tab ${tab === "create" ? "tab--active" : ""}`} onClick={() => setTab("create")}>Create</button>
        <button className={`tab ${tab === "templates" ? "tab--active" : ""}`} onClick={() => setTab("templates")}>Templates</button>
      </div>

      {tab === "list" && (
        loading ? <div className="empty-state"><h3>Loading...</h3></div> :
        workflows.length === 0 ? (
          <div className="empty-state"><h3>No workflows</h3><p>Create your first workflow to get started</p></div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Name</th><th>Status</th><th>Progress</th><th>Actions</th></tr></thead>
                <tbody>
                  {workflows.map((w) => (
                    <tr key={w.id}>
                      <td><Link to={`/workflows/${w.id}`} style={{color: "var(--dash-primary)", fontWeight: 600}}>{w.name}</Link></td>
                      <td><span className={`badge ${statusColor(w.status)}`}>{w.status}</span></td>
                      <td>
                        <div style={{display:"flex", alignItems:"center", gap: 8}}>
                          <div className="progress-bar" style={{flex: 1, maxWidth: 120}}>
                            <div className="progress-bar__fill" style={{width: `${w.total_steps ? (w.current_step / w.total_steps) * 100 : 0}%`}} />
                          </div>
                          <span style={{fontSize: 13, color: "var(--dash-text-muted)"}}>{w.current_step}/{w.total_steps}</span>
                        </div>
                      </td>
                      <td>
                        <div style={{display:"flex", gap: 6}}>
                          {w.status === "running" && <button className="btn btn--sm btn--secondary" onClick={() => handlePause(w.id)}>Pause</button>}
                          {w.status === "paused" && <button className="btn btn--sm btn--primary" onClick={() => handleResume(w.id)}>Resume</button>}
                          <button className="btn btn--sm btn--danger" onClick={() => handleDelete(w.id)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {tab === "create" && (
        <div className="card" style={{maxWidth: 600}}>
          <div className="card-header"><h3>Create Workflow</h3></div>
          <div className="input-group">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My pipeline" />
          </div>
          <div className="input-group">
            <label>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional description" />
          </div>
          <div className="input-group">
            <label>Dataset</label>
            <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
              <option value="">Select dataset</option>
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="input-group">
            <label>Template (optional)</label>
            <select value={selectedTemplate} onChange={(e) => setSelectedTemplate(e.target.value)}>
              <option value="">No template</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <button className="btn btn--primary" onClick={handleCreate} disabled={!name || !datasetId}>Create & Start</button>
        </div>
      )}

      {tab === "templates" && (
        templates.length === 0 ? <div className="empty-state"><h3>No templates available</h3></div> : (
          <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16}}>
            {templates.map((t) => (
              <div key={t.id} className="card">
                <h3 style={{fontSize: 16, marginBottom: 6}}>{t.name}</h3>
                <p style={{fontSize: 14, color: "var(--dash-text-secondary)", marginBottom: 12}}>{t.description || "No description"}</p>
                <div className="chip-list">
                  {t.is_builtin && <span className="chip">Built-in</span>}
                  {t.category && <span className="chip">{t.category}</span>}
                  <span className="chip">{(t.steps as unknown[]).length} steps</span>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
