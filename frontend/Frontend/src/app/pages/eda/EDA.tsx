import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { datasetApi } from "../../../shared/api/datasets";
import { edaApi } from "../../../shared/api/eda";
import { useTaskPolling } from "../../hooks/usePolling";
import TaskMonitor from "../../components/TaskMonitor/TaskMonitor";
import EDAGraphs from "./EDAGraphs";
import "./EDA.css";

/* ── Types ── */
interface ColumnProfile {
  name: string; dtype: string; count: number; null_count: number; null_pct: number;
  unique_count: number; unique_pct: number; is_numeric: boolean; is_categorical: boolean;
  is_text: boolean; stats: Record<string, unknown>; correlation_with: Record<string, number>;
}

interface ProfileData {
  row_count: number; column_count: number; memory_usage_mb: number;
  columns: ColumnProfile[]; numeric_correlations: Record<string, Record<string, number>>;
  warnings: string[];
}

/* ── Mini chart components (no library needed) ── */

function BarChart({ data, color = "var(--dash-text)" }: { data: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="eda-bar-chart">
      {data.map((d, i) => (
        <div key={i} className="eda-bar-chart__row">
          <span className="eda-bar-chart__label" title={d.label}>{d.label}</span>
          <div className="eda-bar-chart__track">
            <div className="eda-bar-chart__fill" style={{ width: `${(d.value / max) * 100}%`, background: color }} />
          </div>
          <span className="eda-bar-chart__value">{typeof d.value === "number" ? d.value.toLocaleString() : d.value}</span>
        </div>
      ))}
    </div>
  );
}

function NullBarChart({ columns }: { columns: ColumnProfile[] }) {
  const sorted = [...columns].sort((a, b) => b.null_pct - a.null_pct).filter(c => c.null_count > 0);
  if (sorted.length === 0) return <p className="eda-no-data">No missing values detected</p>;
  return (
    <BarChart
      data={sorted.slice(0, 15).map(c => ({ label: c.name, value: Math.round(c.null_pct * 10) / 10 }))}
      color="var(--dash-text-muted)"
    />
  );
}

function CorrelationMatrix({ correlations }: { correlations: Record<string, Record<string, number>> }) {
  const cols = Object.keys(correlations);
  if (cols.length === 0) return <p className="eda-no-data">No numeric columns for correlation</p>;
  if (cols.length > 15) return (
    <div>
      <p style={{fontSize: 12, color: "var(--dash-text-muted)", marginBottom: 8}}>Showing top 15 of {cols.length} columns</p>
      <CorrelationMatrixInner cols={cols.slice(0, 15)} correlations={correlations} />
    </div>
  );
  return <CorrelationMatrixInner cols={cols} correlations={correlations} />;
}

function CorrelationMatrixInner({ cols, correlations }: { cols: string[]; correlations: Record<string, Record<string, number>> }) {
  const getColor = (v: number) => {
    if (v >= 0.7) return "var(--dash-text)";
    if (v >= 0.3) return "var(--dash-text)";
    if (v > -0.3) return "var(--dash-surface-active)";
    if (v > -0.7) return "var(--dash-text-muted)";
    return "var(--dash-text-muted)";
  };
  return (
    <div className="eda-corr-matrix" style={{ overflowX: "auto" }}>
      <table className="eda-corr-table">
        <thead>
          <tr>
            <th></th>
            {cols.map(c => <th key={c} title={c}>{c.length > 8 ? c.slice(0, 7) + "..." : c}</th>)}
          </tr>
        </thead>
        <tbody>
          {cols.map(r => (
            <tr key={r}>
              <td className="eda-corr-table__row-label" title={r}>{r.length > 10 ? r.slice(0, 9) + "..." : r}</td>
              {cols.map(c => {
                const v = correlations[r]?.[c] ?? 0;
                return (
                  <td key={c} style={{ background: getColor(v), color: Math.abs(v) > 0.5 ? "#fff" : "#333" }}
                    title={`${r} x ${c}: ${v.toFixed(3)}`}>
                    {v.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoxPlotRow({ col }: { col: ColumnProfile }) {
  if (!col.is_numeric) return null;
  const s = col.stats as Record<string, number>;
  const min = s.min ?? 0, max = s.max ?? 1, q25 = s.q25 ?? 0, q50 = s.q50 ?? 0, q75 = s.q75 ?? 0;
  const range = max - min || 1;
  const pct = (v: number) => ((v - min) / range) * 100;
  return (
    <div className="eda-boxplot-row">
      <span className="eda-boxplot-row__label" title={col.name}>{col.name}</span>
      <div className="eda-boxplot-row__track">
        {/* whisker line */}
        <div className="eda-boxplot__whisker" style={{ left: `${pct(min)}%`, width: `${pct(max) - pct(min)}%` }} />
        {/* IQR box */}
        <div className="eda-boxplot__box" style={{ left: `${pct(q25)}%`, width: `${pct(q75) - pct(q25)}%` }} />
        {/* median line */}
        <div className="eda-boxplot__median" style={{ left: `${pct(q50)}%` }} />
      </div>
      <span className="eda-boxplot-row__range">{min.toFixed(1)} — {max.toFixed(1)}</span>
    </div>
  );
}

function DataTypeChart({ columns }: { columns: ColumnProfile[] }) {
  const counts = { numeric: 0, categorical: 0, text: 0, other: 0 };
  columns.forEach(c => {
    if (c.is_numeric) counts.numeric++;
    else if (c.is_categorical) counts.categorical++;
    else if (c.is_text) counts.text++;
    else counts.other++;
  });
  const items = Object.entries(counts).filter(([, v]) => v > 0);
  const colors: Record<string, string> = { numeric: "var(--dash-text)", categorical: "var(--dash-text)", text: "var(--dash-text-secondary)", other: "var(--dash-text-secondary)" };
  const total = columns.length;
  return (
    <div className="eda-dtype-chart">
      <div className="eda-dtype-chart__bar">
        {items.map(([k, v]) => (
          <div key={k} className="eda-dtype-chart__segment" style={{ width: `${(v / total) * 100}%`, background: colors[k] }}
            title={`${k}: ${v}`} />
        ))}
      </div>
      <div className="eda-dtype-chart__legend">
        {items.map(([k, v]) => (
          <span key={k} className="eda-dtype-chart__legend-item">
            <span className="eda-dtype-chart__dot" style={{ background: colors[k] }} />
            {k} ({v})
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Column detail card ── */
function ColumnCard({ col }: { col: ColumnProfile }) {
  const s = col.stats as Record<string, unknown>;
  return (
    <div className="eda-col-card">
      <div className="eda-col-card__header">
        {/* title attribute lets users hover to see the full column name
            even when the visible text is truncated. The CSS allows the
            text to wrap so long descriptive names are still readable
            inline without forcing a hover. */}
        <span className="eda-col-card__name" title={col.name}>{col.name}</span>
        <span className={`badge badge--sm ${col.is_numeric ? "badge--info" : col.is_categorical ? "badge--warning" : "badge--secondary"}`}>
          {col.is_numeric ? "Numeric" : col.is_categorical ? "Categorical" : col.is_text ? "Text" : col.dtype}
        </span>
      </div>
      <div className="eda-col-card__stats">
        <div className="eda-col-card__stat"><span className="eda-col-card__stat-label">Rows</span><span>{col.count.toLocaleString()}</span></div>
        <div className="eda-col-card__stat"><span className="eda-col-card__stat-label">Nulls</span><span>{col.null_count.toLocaleString()} ({col.null_pct}%)</span></div>
        <div className="eda-col-card__stat"><span className="eda-col-card__stat-label">Unique</span><span>{col.unique_count.toLocaleString()} ({col.unique_pct}%)</span></div>
        {col.is_numeric && (
          <>
            <div className="eda-col-card__stat"><span className="eda-col-card__stat-label">Mean</span><span>{(s.mean as number)?.toFixed(3)}</span></div>
            <div className="eda-col-card__stat"><span className="eda-col-card__stat-label">Std</span><span>{(s.std as number)?.toFixed(3)}</span></div>
            <div className="eda-col-card__stat"><span className="eda-col-card__stat-label">Skew</span><span>{(s.skewness as number)?.toFixed(3)}</span></div>
          </>
        )}
        {col.is_text && (
          <>
            <div className="eda-col-card__stat"><span className="eda-col-card__stat-label">Avg Length</span><span>{s.avg_length as number}</span></div>
            <div className="eda-col-card__stat"><span className="eda-col-card__stat-label">Max Length</span><span>{s.max_length as number}</span></div>
          </>
        )}
      </div>
      {/* Top values for categorical/text */}
      {(s.top_values as Record<string, number> | undefined) && (
        <div style={{marginTop: 8}}>
          <BarChart
            data={Object.entries(s.top_values as Record<string, number>).slice(0, 6).map(([k, v]) => ({ label: k, value: v }))}
            color={col.is_categorical ? "var(--dash-text)" : "var(--dash-text-secondary)"}
          />
        </div>
      )}
    </div>
  );
}

/* ── Main Component ── */
export default function EDA() {
  const [datasets, setDatasets] = useState<Array<{id:string; name:string}>>([]);
  const [datasetId, setDatasetId] = useState("");
  const [runProfiling, setRunProfiling] = useState(true);
  const [runEmbeddings, setRunEmbeddings] = useState(true);
  const [runClustering, setRunClustering] = useState(true);
  const [nClusters, setNClusters] = useState(5);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [results, setResults] = useState<unknown>(null);
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<"overview" | "columns" | "correlations" | "distributions" | "graphs" | "raw">("overview");
  const [showFormatMenu, setShowFormatMenu] = useState(false);
  const { task, steps, stuck, progressPct, rate } = useTaskPolling(taskId);

  const [searchParams] = useSearchParams();

  useEffect(() => {
    datasetApi.list({ limit: 100 }).then((r) => {
      setDatasets((Array.isArray(r.data) ? r.data : r.data.datasets || []).filter((d: {source_type?: string}) => d.source_type !== "image" && d.source_type !== "text"));
    }).catch(() => {});
    const preselect = searchParams.get("dataset");
    if (preselect) setDatasetId(preselect);
  }, [searchParams]);

  const handleDownload = async (format: "json" | "pdf" | "docx" = "json") => {
    if (!datasetId) return;
    const ext = format;
    const mime = format === "json"
      ? "application/json"
      : format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    try {
      const res = await edaApi.download(datasetId, format);
      const blob = new Blob([res.data], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `eda_report_${datasetId.slice(0, 8)}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setShowFormatMenu(false);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      alert(typeof detail === "string"
        ? `Download failed: ${detail}`
        : "Download failed — make sure an EDA run has completed for this dataset.");
    }
  };

  useEffect(() => {
    if (task?.status === "completed" && datasetId) {
      edaApi.getResults(datasetId).then((r) => setResults(r.data)).catch(() => {});
      edaApi.getProfile(datasetId).then((r) => {
        const p = r.data?.profiling || r.data;
        setProfileData(p as ProfileData);
      }).catch(() => {});
      setRunning(false);
    }
    if (task?.status === "failed") setRunning(false);
  }, [task?.status, datasetId]);

  // Auto-load existing results when dataset changes
  useEffect(() => {
    if (!datasetId) return;
    edaApi.getResults(datasetId).then((r) => setResults(r.data)).catch(() => {});
    edaApi.getProfile(datasetId).then((r) => {
      const p = r.data?.profiling || r.data;
      setProfileData(p as ProfileData);
    }).catch(() => {});
  }, [datasetId]);

  const handleRun = async () => {
    if (!datasetId) return;
    setRunning(true); setResults(null); setProfileData(null);
    try {
      const res = await edaApi.run({
        dataset_id: datasetId, run_profiling: runProfiling,
        run_embeddings: runEmbeddings, run_clustering: runClustering, n_clusters: nClusters,
      });
      setTaskId(res.data.task_id);
    } catch { setRunning(false); alert("Failed to start"); }
  };

  const numericCols = profileData?.columns.filter(c => c.is_numeric) || [];
  const catCols = profileData?.columns.filter(c => c.is_categorical || c.is_text) || [];

  return (
    <div>
      <div className="page-header">
        <h1>Exploratory Data Analysis</h1>
        <p>Profile, embed, cluster, and visualize your data</p>
      </div>
      <div className={`two-col${tab === "graphs" ? " two-col--wide-right" : ""}`}>
        {/* ── Left: Config ── */}
        <div className="card">
          <div className="card-header"><h3>Configuration</h3></div>
          <div className="input-group">
            <label>Dataset</label>
            <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
              <option value="">Select a dataset</option>
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div style={{display:"flex", flexDirection:"column", gap: 8, marginBottom: 16}}>
            <label style={{display:"flex", alignItems:"center", gap: 8, fontSize: 13, color: "var(--dash-text-secondary)"}}>
              <input type="checkbox" checked={runProfiling} onChange={(e) => setRunProfiling(e.target.checked)} /> Run Profiling
            </label>
            <label style={{display:"flex", alignItems:"center", gap: 8, fontSize: 13, color: "var(--dash-text-secondary)"}}>
              <input type="checkbox" checked={runEmbeddings} onChange={(e) => setRunEmbeddings(e.target.checked)} /> Run Embeddings
            </label>
            <label style={{display:"flex", alignItems:"center", gap: 8, fontSize: 13, color: "var(--dash-text-secondary)"}}>
              <input type="checkbox" checked={runClustering} onChange={(e) => setRunClustering(e.target.checked)} /> Run Clustering
            </label>
          </div>
          {runClustering && (
            <div className="input-group">
              <label>Number of Clusters</label>
              <input type="number" min={2} max={50} value={nClusters} onChange={(e) => setNClusters(+e.target.value)} />
            </div>
          )}
          <button className="btn btn--primary" onClick={handleRun} disabled={!datasetId || running}>
            {running ? "Running..." : "Run EDA"}
          </button>
          <TaskMonitor rate={rate} task={task} steps={steps} stuck={stuck} progressPct={progressPct} running={running} />

          {/* When EDA results exist: download or continue to Labeling */}
          {profileData && (
            <div style={{display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap", position: "relative"}}>
              <div style={{position: "relative"}}>
                <button className="btn btn--secondary btn--sm"
                  onClick={() => setShowFormatMenu((v) => !v)}
                  aria-haspopup="menu" aria-expanded={showFormatMenu}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                  </svg>
                  Download EDA report
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    style={{marginLeft: 6}}>
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </button>
                {showFormatMenu && (
                  <>
                    {/* invisible scrim to close menu on outside click */}
                    <div onClick={() => setShowFormatMenu(false)}
                      style={{position: "fixed", inset: 0, zIndex: 50}}/>
                    <div role="menu" style={{
                      position: "absolute", top: "calc(100% + 6px)", left: 0,
                      minWidth: 200, background: "var(--dash-surface)",
                      border: "1px solid var(--dash-border)", borderRadius: 10,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                      padding: 6, zIndex: 60,
                    }}>
                      {[
                        { fmt: "pdf", label: "PDF document", sub: "Polished, printable report" },
                        { fmt: "docx", label: "Word document (.docx)", sub: "Editable in Word / Google Docs" },
                        { fmt: "json", label: "Raw JSON", sub: "Full structured data" },
                      ].map((opt) => (
                        <button key={opt.fmt}
                          onClick={() => handleDownload(opt.fmt as "json" | "pdf" | "docx")}
                          style={{
                            display: "block", width: "100%", textAlign: "left",
                            padding: "8px 12px", border: "none", background: "none",
                            borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "var(--dash-surface-hover)"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "none"}>
                          <div style={{fontSize: 13, fontWeight: 600, color: "var(--dash-text)"}}>{opt.label}</div>
                          <div style={{fontSize: 11.5, color: "var(--dash-text-muted)", marginTop: 1}}>{opt.sub}</div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <Link to={`/labeling?dataset=${datasetId}`} className="btn btn--primary btn--sm">
                Continue to Labeling
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 5l7 7-7 7"/>
                </svg>
              </Link>
            </div>
          )}

          {/* Summary stats when profile loaded */}
          {profileData && (
            <div className="eda-summary" style={{marginTop: 20}}>
              <div className="eda-summary__item"><span className="eda-summary__value">{profileData.row_count?.toLocaleString()}</span><span className="eda-summary__label">Rows</span></div>
              <div className="eda-summary__item"><span className="eda-summary__value">{profileData.column_count}</span><span className="eda-summary__label">Columns</span></div>
              <div className="eda-summary__item"><span className="eda-summary__value">{profileData.memory_usage_mb?.toFixed(2)}</span><span className="eda-summary__label">MB</span></div>
              <div className="eda-summary__item"><span className="eda-summary__value">{profileData.warnings?.length || 0}</span><span className="eda-summary__label">Warnings</span></div>
            </div>
          )}
        </div>

        {/* ── Right: Results ── */}
        <div className="card" style={{flex: 2}}>
          <div className="tabs">
            <button className={`tab ${tab === "overview" ? "tab--active" : ""}`} onClick={() => setTab("overview")}>Overview</button>
            <button className={`tab ${tab === "columns" ? "tab--active" : ""}`} onClick={() => setTab("columns")}>Columns</button>
            <button className={`tab ${tab === "correlations" ? "tab--active" : ""}`} onClick={() => setTab("correlations")}>Correlations</button>
            <button className={`tab ${tab === "distributions" ? "tab--active" : ""}`} onClick={() => setTab("distributions")}>Distributions</button>
            <button className={`tab ${tab === "graphs" ? "tab--active" : ""}`} onClick={() => setTab("graphs")}>Graphs</button>
            <button className={`tab ${tab === "raw" ? "tab--active" : ""}`} onClick={() => setTab("raw")}>Raw JSON</button>
          </div>

          {!profileData && !results ? (
            <div className="empty-state"><h3>No results yet</h3><p>Select a dataset and run EDA to see visualizations</p></div>
          ) : (
            <>
              {/* ── Overview ── */}
              {tab === "overview" && profileData && (
                <div className="eda-overview">
                  {/* Data type distribution */}
                  <div className="eda-section">
                    <h4>Column Type Distribution</h4>
                    <DataTypeChart columns={profileData.columns} />
                  </div>

                  {/* Missing values */}
                  <div className="eda-section">
                    <h4>Missing Values</h4>
                    <NullBarChart columns={profileData.columns} />
                  </div>

                  {/* Warnings */}
                  {profileData.warnings && profileData.warnings.length > 0 && (
                    <div className="eda-section">
                      <h4>Data Quality Warnings</h4>
                      <div className="eda-warnings">
                        {profileData.warnings.map((w, i) => (
                          <div key={i} className="eda-warning-item">
                            <span className="eda-warning-icon">&#9888;</span>
                            <span>{w}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Columns ── */}
              {tab === "columns" && profileData && (
                <div className="eda-columns-grid">
                  {profileData.columns.map((col) => <ColumnCard key={col.name} col={col} />)}
                </div>
              )}

              {/* ── Correlations ── */}
              {tab === "correlations" && profileData && (
                <div className="eda-section">
                  <h4>Numeric Correlation Matrix</h4>
                  <CorrelationMatrix correlations={profileData.numeric_correlations || {}} />
                  {/* Top correlations list */}
                  {numericCols.length > 1 && (
                    <div style={{marginTop: 20}}>
                      <h4 style={{marginBottom: 10}}>Strongest Correlations</h4>
                      <div className="eda-top-corrs">
                        {Object.entries(profileData.numeric_correlations || {}).flatMap(([r, row]) =>
                          Object.entries(row).filter(([c]) => c > r).map(([c, v]) => ({ pair: `${r} x ${c}`, value: v }))
                        ).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 10).map((item, i) => (
                          <div key={i} className="eda-top-corrs__row">
                            <span>{item.pair}</span>
                            <span style={{ color: item.value > 0.5 ? "var(--dash-text)" : item.value < -0.5 ? "var(--dash-text-muted)" : "var(--dash-text-muted)", fontWeight: 600 }}>
                              {item.value.toFixed(4)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Distributions (box plots) ── */}
              {tab === "distributions" && profileData && (
                <div className="eda-section">
                  <h4>Numeric Column Distributions (Box Plots)</h4>
                  {numericCols.length > 0 ? (
                    <div className="eda-boxplots">
                      {numericCols.map((col) => <BoxPlotRow key={col.name} col={col} />)}
                    </div>
                  ) : <p className="eda-no-data">No numeric columns found</p>}

                  {catCols.length > 0 && (
                    <div style={{marginTop: 24}}>
                      <h4>Categorical Value Counts</h4>
                      <div className="eda-columns-grid" style={{marginTop: 12}}>
                        {catCols.slice(0, 8).map((col) => <ColumnCard key={col.name} col={col} />)}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Graphs ── */}
              {tab === "graphs" && (
                <div className="eda-section">
                  <EDAGraphs datasetId={datasetId} />
                </div>
              )}

              {/* ── Raw JSON ── */}
              {tab === "raw" && (
                <div>
                  <h4 style={{marginBottom: 8, color: "var(--dash-text)"}}>EDA Results</h4>
                  {results ? (
                    <pre className="eda-json">{JSON.stringify(results, null, 2)}</pre>
                  ) : <p className="eda-no-data">No results</p>}
                  <h4 style={{marginTop: 16, marginBottom: 8, color: "var(--dash-text)"}}>Profile Data</h4>
                  {profileData ? (
                    <pre className="eda-json">{JSON.stringify(profileData, null, 2)}</pre>
                  ) : <p className="eda-no-data">No profile data</p>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
