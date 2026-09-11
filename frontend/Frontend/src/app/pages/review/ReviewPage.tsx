import { useState, useEffect } from "react";
import { datasetApi } from "../../../shared/api/datasets";
import { reviewApi } from "../../../shared/api/review";
import { useTaskPolling } from "../../hooks/usePolling";
import TaskMonitor from "../../components/TaskMonitor/TaskMonitor";

export default function ReviewPage() {
  const [datasets, setDatasets] = useState<Array<{id:string; name:string}>>([]);
  const [datasetId, setDatasetId] = useState("");
  const [tab, setTab] = useState<"quality" | "review" | "export">("quality");
  const [qualityResult, setQualityResult] = useState<unknown>(null);
  const [reviewStatus, setReviewStatus] = useState<Record<string, unknown> | null>(null);
  const [exportResult, setExportResult] = useState<unknown>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [exportFormat, setExportFormat] = useState("csv");
  const [expectedLabels, setExpectedLabels] = useState("");
  const [reviewActions, setReviewActions] = useState<Array<{item_id: string; action: string; new_label?: string}>>([]);
  const [newAction, setNewAction] = useState({item_id: "", action: "approve", new_label: ""});
  const [datasetStatus, setDatasetStatus] = useState("");
  const { task, steps, stuck, progressPct, rate } = useTaskPolling(taskId);

  useEffect(() => {
    datasetApi.list({ limit: 100 }).then((r) => {
      setDatasets((Array.isArray(r.data) ? r.data : r.data.datasets || []).filter((d: {source_type?: string}) => d.source_type !== "image" && d.source_type !== "text"));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (task?.status === "completed") {
      setRunning(false);
      if (datasetId) {
        reviewApi.getQuality(datasetId).then((r) => setQualityResult(r.data)).catch(() => {});
        reviewApi.getStatus(datasetId).then((r) => setReviewStatus(r.data)).catch(() => {});
        reviewApi.getExport(datasetId).then((r) => setExportResult(r.data)).catch(() => {});
      }
    }
    if (task?.status === "failed") setRunning(false);
  }, [task?.status, datasetId]);

  const loadResults = () => {
    if (!datasetId) return;
    reviewApi.getQuality(datasetId).then((r) => setQualityResult(r.data)).catch(() => {});
    reviewApi.getStatus(datasetId).then((r) => setReviewStatus(r.data)).catch(() => {});
    reviewApi.getExport(datasetId).then((r) => setExportResult(r.data)).catch(() => {});
  };

  useEffect(() => { if (datasetId) loadResults(); }, [datasetId]);

  const runQuality = async () => {
    if (!datasetId) return;
    setRunning(true);
    try {
      const labels = expectedLabels ? expectedLabels.split(",").map((l) => l.trim()) : undefined;
      const res = await reviewApi.runQuality(datasetId, labels);
      setTaskId(res.data.task_id);
    } catch { setRunning(false); alert("Failed"); }
  };

  const addAction = () => {
    if (!newAction.item_id) return;
    setReviewActions([...reviewActions, {...newAction}]);
    setNewAction({item_id: "", action: "approve", new_label: ""});
  };

  const submitReview = async () => {
    if (!datasetId || reviewActions.length === 0) return;
    try {
      const res = await reviewApi.submitActions({ dataset_id: datasetId, actions: reviewActions });
      alert(`Done: ${JSON.stringify(res.data.summary)}`);
      setReviewActions([]);
      loadResults();
    } catch { alert("Failed"); }
  };

  const runExport = async () => {
    if (!datasetId) return;
    setRunning(true);
    try {
      const res = await reviewApi.exportDataset(datasetId, exportFormat);
      setTaskId(res.data.task_id);
    } catch { setRunning(false); alert("Failed"); }
  };

  const updateStatus = async () => {
    if (!datasetId || !datasetStatus) return;
    try {
      const res = await reviewApi.updateDatasetStatus(datasetId, datasetStatus);
      alert(res.data.message);
    } catch { alert("Failed"); }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Review & Export</h1>
        <p>Evaluate quality, review labels, and export datasets</p>
      </div>

      <div className="card" style={{marginBottom: 20}}>
        <div style={{display:"flex", gap: 12, alignItems:"flex-end"}}>
          <div className="input-group" style={{flex: 1, marginBottom: 0}}>
            <label>Dataset</label>
            <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
              <option value="">Select a dataset</option>
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          {reviewStatus && (
            <div style={{display:"flex", gap: 8}}>
              <span className="badge badge--info">Reviewed: {String(reviewStatus.total_reviewed || 0)}</span>
              <span className="badge badge--success">Approved: {String(reviewStatus.approved || 0)}</span>
              <span className="badge badge--danger">Rejected: {String(reviewStatus.rejected || 0)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "quality" ? "tab--active" : ""}`} onClick={() => setTab("quality")}>Quality Eval</button>
        <button className={`tab ${tab === "review" ? "tab--active" : ""}`} onClick={() => setTab("review")}>Review Actions</button>
        <button className={`tab ${tab === "export" ? "tab--active" : ""}`} onClick={() => setTab("export")}>Export</button>
      </div>

      {tab === "quality" && (
        <div className="two-col">
          <div className="card">
            <div className="card-header"><h3>Run Quality Evaluation</h3></div>
            <div className="input-group">
              <label>Expected Labels (optional, comma-separated)</label>
              <input value={expectedLabels} onChange={(e) => setExpectedLabels(e.target.value)} placeholder="positive, negative, neutral" />
            </div>
            <button className="btn btn--primary" onClick={runQuality} disabled={!datasetId || running}>
              {running ? "Evaluating..." : "Evaluate Quality"}
            </button>
            <TaskMonitor rate={rate} task={task} steps={steps} stuck={stuck} progressPct={progressPct} running={running} />
          </div>
          <div className="card">
            <div className="card-header"><h3>Quality Results</h3></div>
            {qualityResult ? (
              <pre style={{fontSize: 12, color: "var(--dash-text-secondary)", overflow: "auto", maxHeight: 400, whiteSpace: "pre-wrap"}}>
                {JSON.stringify(qualityResult, null, 2)}
              </pre>
            ) : <div className="empty-state"><h3>No quality data yet</h3></div>}
          </div>
        </div>
      )}

      {tab === "review" && (
        <div className="card">
          <div className="card-header">
            <h3>Review Actions</h3>
            <button className="btn btn--sm btn--primary" onClick={submitReview} disabled={reviewActions.length === 0}>
              Submit ({reviewActions.length})
            </button>
          </div>
          <div style={{display:"flex", gap: 10, marginBottom: 16, alignItems: "flex-end"}}>
            <div className="input-group" style={{flex: 1, marginBottom: 0}}>
              <label>Item ID</label>
              <input value={newAction.item_id} onChange={(e) => setNewAction({...newAction, item_id: e.target.value})} />
            </div>
            <div className="input-group" style={{flex: 1, marginBottom: 0}}>
              <label>Action</label>
              <select value={newAction.action} onChange={(e) => setNewAction({...newAction, action: e.target.value})}>
                <option value="approve">Approve</option>
                <option value="reject">Reject</option>
                <option value="relabel">Relabel</option>
              </select>
            </div>
            {newAction.action === "relabel" && (
              <div className="input-group" style={{flex: 1, marginBottom: 0}}>
                <label>New Label</label>
                <input value={newAction.new_label} onChange={(e) => setNewAction({...newAction, new_label: e.target.value})} />
              </div>
            )}
            <button className="btn btn--sm btn--secondary" onClick={addAction}>Add</button>
          </div>
          {reviewActions.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Item</th><th>Action</th><th>New Label</th><th></th></tr></thead>
                <tbody>
                  {reviewActions.map((a, i) => (
                    <tr key={i}>
                      <td style={{color: "var(--dash-text)"}}>{a.item_id}</td>
                      <td><span className={`badge ${a.action === "approve" ? "badge--success" : a.action === "reject" ? "badge--danger" : "badge--warning"}`}>{a.action}</span></td>
                      <td>{a.new_label || "\u2014"}</td>
                      <td><button className="btn btn--sm btn--danger" onClick={() => setReviewActions(reviewActions.filter((_, j) => j !== i))}>\u2715</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--dash-border)"}}>
            <h3 style={{fontSize: 14, marginBottom: 12}}>Update Dataset Status</h3>
            <div style={{display:"flex", gap: 12}}>
              <select value={datasetStatus} onChange={(e) => setDatasetStatus(e.target.value)}
                style={{padding: "8px 12px", background: "var(--dash-bg)", border: "1px solid var(--dash-border)", borderRadius: 8, color: "var(--dash-text)", fontSize: 13}}>
                <option value="">Select status</option>
                <option value="labeled">Labeled</option>
                <option value="reviewed">Reviewed</option>
                <option value="ready">Ready</option>
              </select>
              <button className="btn btn--sm btn--primary" onClick={updateStatus} disabled={!datasetStatus}>Update</button>
            </div>
          </div>
        </div>
      )}

      {tab === "export" && (
        <div className="two-col">
          <div className="card">
            <div className="card-header"><h3>Export Dataset</h3></div>
            <div className="input-group">
              <label>Format</label>
              <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
                <option value="coco">COCO</option>
                <option value="yolo">YOLO</option>
              </select>
            </div>
            <button className="btn btn--primary" onClick={runExport} disabled={!datasetId || running}>
              {running ? "Exporting..." : "Export"}
            </button>
          </div>
          <div className="card">
            <div className="card-header"><h3>Export Result</h3></div>
            {exportResult ? (
              <pre style={{fontSize: 12, color: "var(--dash-text-secondary)", overflow: "auto", maxHeight: 300, whiteSpace: "pre-wrap"}}>
                {JSON.stringify(exportResult, null, 2)}
              </pre>
            ) : <div className="empty-state"><h3>No export yet</h3></div>}
          </div>
        </div>
      )}
    </div>
  );
}
