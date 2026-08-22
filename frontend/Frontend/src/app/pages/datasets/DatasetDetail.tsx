import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { datasetApi } from "../../../shared/api/datasets";
import { structuringApi } from "../../../shared/api/structuring";
import { edaApi } from "../../../shared/api/eda";
import { labelingApi } from "../../../shared/api/labeling";
import { workflowApi } from "../../../shared/api/workflows";
import "./DatasetDetail.css";

interface DatasetVersion {
  id: string; version_number: number; file_name: string; file_size?: number;
  file_type: string; row_count?: number; schema_hash?: string; created_at: string;
}

export default function DatasetDetail() {
  const { id } = useParams<{ id: string }>();
  const [dataset, setDataset] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState<DatasetVersion[]>([]);
  const [structResult, setStructResult] = useState<Record<string, unknown> | null>(null);
  const [edaResult, setEdaResult] = useState<Record<string, unknown> | null>(null);
  const [labelResult, setLabelResult] = useState<Record<string, unknown> | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "versions" | "pipeline">("overview");

  useEffect(() => {
    if (!id) return;
    datasetApi.get(id).then((r) => {
      // GET /datasets/{id} returns a {dataset, versions, metadata} wrapper.
      const data = r.data as Record<string, unknown>;
      setDataset((data.dataset as Record<string, unknown>) ?? data);
    }).catch(() => {}).finally(() => setLoading(false));
    datasetApi.getVersions(id).then((r) => {
      const v = Array.isArray(r.data) ? r.data : r.data.versions || [];
      setVersions(v);
    }).catch(() => {});
    structuringApi.getResults(id).then((r) => setStructResult(r.data)).catch(() => {});
    edaApi.getResults(id).then((r) => setEdaResult(r.data)).catch(() => {});
    labelingApi.getResults(id).then((r) => setLabelResult(r.data)).catch(() => {});
  }, [id]);

  const quickStart = async () => {
    if (!id) return;
    try {
      const sourceType = dataset?.source_type ? String(dataset.source_type) : undefined;
      await workflowApi.quickStart(id, sourceType);
      alert("Workflow started! Check the Workflows page.");
    } catch (err) {
      const d = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      alert(`Failed to start workflow: ${typeof d === "string" ? d : JSON.stringify(d ?? err)}`);
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const statusColor = (s: string) => {
    const colors: Record<string, string> = { raw: "var(--dash-text-secondary)", processed: "var(--dash-text)", labeled: "var(--dash-text-secondary)", reviewed: "var(--dash-text)", ready: "var(--dash-text)" };
    return colors[s] || "var(--dash-text-secondary)";
  };

  if (loading) return <div className="empty-state"><h3>Loading...</h3></div>;
  if (!dataset) return <div className="empty-state"><h3>Dataset not found</h3></div>;

  const latestVersion = versions.length > 0
    ? versions.reduce((a, b) => ((a.version_number ?? 0) >= (b.version_number ?? 0) ? a : b))
    : null;
  const totalSize = versions.reduce((sum, v) => sum + (v.file_size || 0), 0);
  const dsStatus = String(dataset.status || "raw");
  const dsSourceType = String(dataset.source_type || "");
  const isImageDs = dsSourceType === "image";
  const isTextDs = dsSourceType === "text";

  return (
    <div>
      {/* ── Header ── */}
      <div className="page-header" style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap: "wrap", gap: 12}}>
        <div>
          <p style={{marginBottom: 4}}><Link to="/datasets" style={{color:"var(--dash-primary)", fontSize: 13}}>&#8592; All Datasets</Link></p>
          <h1>{String(dataset.name)}</h1>
          {Boolean(dataset.description) && <p style={{color: "var(--dash-text-secondary)", maxWidth: 600}}>{String(dataset.description)}</p>}
        </div>
        <div style={{display: "flex", gap: 8}}>
          <button className="btn btn--primary" onClick={quickStart}>Quick Start Pipeline</button>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="dd-stats-grid">
        <div className="dd-stat-card">
          <span className="dd-stat-card__label">Status</span>
          <span className="dd-stat-card__value">
            <span className="dd-status-dot" style={{background: statusColor(dsStatus)}} />
            {dsStatus}
          </span>
        </div>
        <div className="dd-stat-card">
          <span className="dd-stat-card__label">Rows</span>
          <span className="dd-stat-card__value">{latestVersion?.row_count?.toLocaleString() ?? String(dataset.row_count ?? "—")}</span>
        </div>
        <div className="dd-stat-card">
          <span className="dd-stat-card__label">Source Type</span>
          <span className="dd-stat-card__value">{String(dataset.source_type || "—").toUpperCase()}</span>
        </div>
        <div className="dd-stat-card">
          <span className="dd-stat-card__label">Versions</span>
          <span className="dd-stat-card__value">{versions.length}</span>
        </div>
        <div className="dd-stat-card">
          <span className="dd-stat-card__label">Total Size</span>
          <span className="dd-stat-card__value">{formatSize(totalSize)}</span>
        </div>
        <div className="dd-stat-card">
          <span className="dd-stat-card__label">Created</span>
          <span className="dd-stat-card__value" style={{fontSize: 15}}>{new Date(String(dataset.created_at)).toLocaleDateString()}</span>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="tabs" style={{marginBottom: 16}}>
        <button className={`tab ${activeTab === "overview" ? "tab--active" : ""}`} onClick={() => setActiveTab("overview")}>Overview</button>
        <button className={`tab ${activeTab === "versions" ? "tab--active" : ""}`} onClick={() => setActiveTab("versions")}>Versions ({versions.length})</button>
        <button className={`tab ${activeTab === "pipeline" ? "tab--active" : ""}`} onClick={() => setActiveTab("pipeline")}>Pipeline Status</button>
      </div>

      {/* ── Overview Tab ── */}
      {activeTab === "overview" && (
        <div className="two-col">
          {/* Pipeline Actions */}
          <div className="card">
            <div className="card-header"><h3>Pipeline Actions</h3></div>
            <div className="dd-actions">
              {isImageDs && (
                <Link to={`/annotate/${id}`} className="dd-action-card">
                  <span className="dd-action-card__icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="13" height="13" rx="2" />
                      <path d="M20.5 9.5l-8 8L9 21l.5-3.5 8-8 3 3z" />
                    </svg>
                  </span>
                  <div><span className="dd-action-card__title">Annotate Images</span><span className="dd-action-card__desc">Draw boxes &amp; polygons, manage classes, export YOLO/COCO/VOC</span></div>
                </Link>
              )}
              {isTextDs && (
                <Link to={`/text-labeling/${id}`} className="dd-action-card">
                  <span className="dd-action-card__icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M9 13h6M9 17h6" />
                    </svg>
                  </span>
                  <div><span className="dd-action-card__title">Label Text</span><span className="dd-action-card__desc">Classify documents, tag spans, export JSONL/CSV</span></div>
                </Link>
              )}
              {!isTextDs && (
                <>
                  <Link to="/structuring" className="dd-action-card">
                    <span className="dd-action-card__icon">&#9881;</span>
                    <div><span className="dd-action-card__title">Structuring</span><span className="dd-action-card__desc">Clean and normalize data</span></div>
                  </Link>
                  <Link to="/eda" className="dd-action-card">
                    <span className="dd-action-card__icon">&#128200;</span>
                    <div><span className="dd-action-card__title">EDA</span><span className="dd-action-card__desc">Explore and profile</span></div>
                  </Link>
                  <Link to="/labeling" className="dd-action-card">
                    <span className="dd-action-card__icon">&#1AA34A;</span>
                    <div><span className="dd-action-card__title">Rule Labeling</span><span className="dd-action-card__desc">Apply labeling rules</span></div>
                  </Link>
                </>
              )}
              <Link to="/ai-labeling" className="dd-action-card">
                <span className="dd-action-card__icon">&#129302;</span>
                <div><span className="dd-action-card__title">AI Labeling</span><span className="dd-action-card__desc">LLM-powered labeling</span></div>
              </Link>
              <Link to="/images" className="dd-action-card">
                <span className="dd-action-card__icon">&#128247;</span>
                <div><span className="dd-action-card__title">Images</span><span className="dd-action-card__desc">CLIP search & clusters</span></div>
              </Link>
              <Link to="/review" className="dd-action-card">
                <span className="dd-action-card__icon">&#9989;</span>
                <div><span className="dd-action-card__title">Review & Export</span><span className="dd-action-card__desc">Quality check and export</span></div>
              </Link>
            </div>
          </div>

          {/* Latest version info */}
          <div className="card">
            <div className="card-header"><h3>Latest Version</h3></div>
            {latestVersion ? (
              <div className="dd-version-detail">
                <div className="dd-version-detail__row"><span>File</span><span style={{fontWeight: 600}}>{latestVersion.file_name}</span></div>
                <div className="dd-version-detail__row"><span>Version</span><span>v{latestVersion.version_number}</span></div>
                <div className="dd-version-detail__row"><span>Type</span><span>{latestVersion.file_type}</span></div>
                <div className="dd-version-detail__row"><span>Size</span><span>{formatSize(latestVersion.file_size)}</span></div>
                <div className="dd-version-detail__row"><span>Rows</span><span>{latestVersion.row_count?.toLocaleString() ?? "—"}</span></div>
                <div className="dd-version-detail__row"><span>Uploaded</span><span>{new Date(latestVersion.created_at).toLocaleString()}</span></div>
                {latestVersion.schema_hash && (
                  <div className="dd-version-detail__row"><span>Schema Hash</span><span style={{fontSize: 11, fontFamily: "monospace"}}>{latestVersion.schema_hash.slice(0, 16)}...</span></div>
                )}
              </div>
            ) : <div className="empty-state"><p>No versions uploaded yet</p></div>}
          </div>
        </div>
      )}

      {/* ── Versions Tab ── */}
      {activeTab === "versions" && (
        <div className="card">
          {versions.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Version</th><th>File</th><th>Type</th><th>Size</th><th>Rows</th><th>Uploaded</th></tr>
                </thead>
                <tbody>
                  {[...versions].reverse().map((v) => (
                    <tr key={v.id}>
                      <td style={{fontWeight: 600, color: "var(--dash-text)"}}>v{v.version_number}</td>
                      <td>{v.file_name}</td>
                      <td><span className="badge badge--info">{v.file_type}</span></td>
                      <td>{formatSize(v.file_size)}</td>
                      <td>{v.row_count?.toLocaleString() ?? "—"}</td>
                      <td>{new Date(v.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty-state"><h3>No versions</h3><p>Upload a file to create the first version</p></div>}
        </div>
      )}

      {/* ── Pipeline Status Tab ── */}
      {activeTab === "pipeline" && (
        <div className="card">
          <div className="dd-pipeline-steps">
            <PipelineStep name="Structuring" done={!!structResult} result={structResult} />
            <PipelineStep name="EDA / Profiling" done={!!edaResult} result={edaResult} />
            <PipelineStep name="Labeling" done={!!labelResult} result={labelResult} />
          </div>
        </div>
      )}
    </div>
  );
}

function PipelineStep({ name, done, result }: { name: string; done: boolean; result: Record<string, unknown> | null }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`dd-pipeline-step ${done ? "dd-pipeline-step--done" : ""}`}>
      <div className="dd-pipeline-step__header" onClick={() => done && setExpanded(!expanded)}>
        <span className={`dd-pipeline-step__dot ${done ? "dd-pipeline-step__dot--done" : ""}`} />
        <span className="dd-pipeline-step__name">{name}</span>
        <span className={`badge ${done ? "badge--success" : "badge--secondary"}`}>{done ? "Complete" : "Not run"}</span>
        {done && <span className="dd-pipeline-step__toggle">{expanded ? "▲" : "▼"}</span>}
      </div>
      {expanded && result && (
        <div className="dd-pipeline-step__body">
          {Boolean(result.completed_at) && <p style={{fontSize: 12, color: "var(--dash-text-muted)", marginBottom: 8}}>Completed: {new Date(String(result.completed_at)).toLocaleString()}</p>}
          <pre style={{fontSize: 11, color: "var(--dash-text-secondary)", overflow: "auto", maxHeight: 200, whiteSpace: "pre-wrap", background: "var(--dash-surface-hover)", padding: 10, borderRadius: 6}}>
            {JSON.stringify(result.result || result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
