import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { datasetApi } from "../../../shared/api/datasets";
import { structuringApi } from "../../../shared/api/structuring";
import type { StructuringRecommendations } from "../../../shared/api/structuring";
import { useTaskPolling } from "../../hooks/usePolling";
import TaskMonitor from "../../components/TaskMonitor/TaskMonitor";
import "./Structuring.css";

interface CleaningStep {
  step: string; description: string; rows_before: number; rows_after: number;
  rows_affected: number; columns_affected: string[];
}

interface CleaningReport {
  original_rows: number; original_columns: number; final_rows: number;
  final_columns: number; steps: CleaningStep[]; total_rows_removed: number;
  total_nulls_filled: number;
}

/** Shape of the `result` JSON stored by the structuring Celery task. */
interface StructuringResult {
  cleaning?: CleaningReport;
  quality?: { overall_score?: number; grade?: string };
  schema?: { row_count?: number; column_count?: number };
  cleaned_file_path?: string;
  original_rows?: number;
  final_rows?: number;
}

const NULL_STRATEGIES = [
  { value: "fill_mode", label: "Fill with Mode", desc: "Replace nulls with the most frequent value in each column" },
  { value: "fill_mean", label: "Fill with Mean", desc: "Replace nulls with column mean (numeric only)" },
  { value: "fill_median", label: "Fill with Median", desc: "Replace nulls with column median (numeric only)" },
  { value: "fill_empty", label: "Fill Empty", desc: "Replace nulls with empty string or zero" },
  { value: "drop_rows", label: "Drop Rows", desc: "Remove any row that contains null values" },
];

export default function Structuring() {
  const [datasets, setDatasets] = useState<Array<{id:string; name:string}>>([]);
  const [datasetId, setDatasetId] = useState("");
  const [nullStrategy, setNullStrategy] = useState("fill_mode");
  const [removeDups, setRemoveDups] = useState(true);
  const [handleOutliers, setHandleOutliers] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);
  const [dropCols, setDropCols] = useState<string[]>([]);
  const [caseNormalize, setCaseNormalize] = useState<"none" | "lower" | "upper" | "title">("none");
  const [standardizeCols, setStandardizeCols] = useState(false);
  const [encodeRows, setEncodeRows] = useState<Array<{ column: string; mode: "onehot" | "label" }>>([]);
  const [searchParams] = useSearchParams();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [results, setResults] = useState<{result?: StructuringResult} | null>(null);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<"visual" | "steps" | "raw">("visual");
  const { task, steps, stuck, progressPct, rate } = useTaskPolling(taskId);
  const [recs, setRecs] = useState<StructuringRecommendations | null>(null);
  const [beforePreview, setBeforePreview] = useState<{ columns: string[]; rows: string[][] } | null>(null);
  const [afterPreview, setAfterPreview] = useState<{ columns: string[]; rows: string[][] } | null>(null);

  useEffect(() => {
    datasetApi.list({ limit: 100 }).then((r) => {
      setDatasets((Array.isArray(r.data) ? r.data : r.data.datasets || []).filter((d: {source_type?: string}) => d.source_type !== "image" && d.source_type !== "text"));
    }).catch(() => {});
    // Pre-select dataset when coming from another step (Datasets -> Structuring etc.)
    const preselect = searchParams.get("dataset");
    if (preselect) setDatasetId(preselect);
  }, [searchParams]);

  useEffect(() => {
    if (task?.status === "completed" && datasetId) {
      structuringApi.getResults(datasetId).then((r) => setResults(r.data)).catch(() => {});
      setRunning(false);
    }
    if (task?.status === "failed") setRunning(false);
  }, [task?.status, datasetId]);

  // Auto-load existing results + columns + recommendations + before-preview
  // when dataset changes.
  useEffect(() => {
    if (!datasetId) {
      setColumns([]); setDropCols([]); setRecs(null);
      setBeforePreview(null); setAfterPreview(null);
      return;
    }
    structuringApi.getResults(datasetId).then((r) => setResults(r.data)).catch(() => {});
    datasetApi.getColumns(datasetId)
      .then((r) => setColumns(r.data.columns || []))
      .catch(() => setColumns([]));
    structuringApi.getRecommendations(datasetId)
      .then((r) => setRecs(r.data))
      .catch(() => setRecs(null));
    datasetApi.getPreview(datasetId, 5)
      .then((r) => setBeforePreview({ columns: r.data.columns, rows: r.data.rows }))
      .catch(() => setBeforePreview(null));
  }, [datasetId]);

  // Pull the cleaned-file preview whenever a fresh result lands.
  useEffect(() => {
    if (!datasetId || !results?.result?.cleaned_file_path) { setAfterPreview(null); return; }
    structuringApi.getCleanedPreview(datasetId, 5)
      .then((r) => setAfterPreview(r.data))
      .catch(() => setAfterPreview(null));
  }, [datasetId, results]);

  // Apply a single recommendation chip — adds the column to the right
  // configuration list so the user just clicks once.
  const applyRecDrop = (col: string) =>
    setDropCols((prev) => (prev.includes(col) ? prev : [...prev, col]));
  const applyRecEncode = (col: string, mode: "onehot" | "label") =>
    setEncodeRows((prev) =>
      prev.some((r) => r.column === col) ? prev : [...prev, { column: col, mode }]
    );
  const applyAllRecs = () => {
    if (!recs) return;
    recs.drop_columns.forEach((d) => applyRecDrop(d.column));
    recs.encode_columns.forEach((e) => applyRecEncode(e.column, e.mode));
    if (recs.standardize_columns) setStandardizeCols(true);
    if (recs.case_normalize) setCaseNormalize(recs.case_normalize.mode);
    if (recs.null_strategy) setNullStrategy(recs.null_strategy);
  };

  const handleDownload = async () => {
    if (!datasetId) return;
    try {
      const res = await structuringApi.download(datasetId);
      const blob = new Blob([res.data], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cleaned_${datasetId.slice(0, 8)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Download failed — make sure a structuring run has completed for this dataset.");
    }
  };

  const handleRun = async () => {
    if (!datasetId) return;
    // Hard reset of the previous run's state so the new task starts clean.
    // Without this, the polling hook can briefly show the previous task's
    // "completed/failed" state for the new run, causing the UI to look stuck.
    setRunning(true); setResults(null); setTaskId(null);
    try {
      const validEncodings = encodeRows.filter((r) => r.column);
      const res = await structuringApi.run({
        dataset_id: datasetId, null_strategy: nullStrategy,
        remove_duplicates: removeDups, handle_outliers: handleOutliers,
        drop_cols: dropCols.length > 0 ? dropCols : undefined,
        case_normalize: caseNormalize,
        standardize_columns: standardizeCols,
        encode_columns: validEncodings.length > 0 ? validEncodings : undefined,
      });
      // Tiny delay so the polling hook sees the null → new-id transition
      // and resets its internal state cleanly.
      setTimeout(() => setTaskId(res.data.task_id), 50);
    } catch { setRunning(false); alert("Failed to start"); }
  };

  /** Emergency unstick — clears local task state when the backend run looks
   *  frozen so the user can retry without reloading the page. */
  const handleCancelRun = () => {
    setRunning(false);
    setTaskId(null);
  };

  // The Celery task stores { schema, cleaning, quality, ... } — the cleaning
  // report (with steps/totals) lives under `result.cleaning`, NOT `result`.
  const report: CleaningReport | null = results?.result?.cleaning ?? null;
  const quality = results?.result?.quality ?? null;
  const retentionPct = report ? Math.round((report.final_rows / Math.max(report.original_rows, 1)) * 100) : 0;

  return (
    <div>
      <div className="page-header">
        <h1>Data Structuring</h1>
        <p>Clean, normalize, and structure your datasets</p>
      </div>

      <div className="two-col">
        {/* ── Config Panel ── */}
        <div className="card">
          <div className="card-header"><h3>Configuration</h3></div>
          <div className="input-group">
            <label>Dataset</label>
            <select value={datasetId} onChange={(e) => { setDatasetId(e.target.value); setResults(null); }}>
              <option value="">Select a dataset</option>
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>

          {/* ── Recommendations ── */}
          {datasetId && recs && (
            (recs.drop_columns.length + recs.encode_columns.length > 0
              || recs.standardize_columns || recs.case_normalize || recs.null_strategy) && (
            <div style={{
              border: "1px solid var(--dash-border)",
              background: "var(--dash-primary-dim)",
              borderRadius: 12, padding: "12px 14px", marginBottom: 14,
            }}>
              <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8}}>
                <span style={{fontSize: 14, fontWeight: 700, color: "var(--dash-text)"}}>
                  &#9889; Recommended for this dataset
                </span>
                <button type="button" className="btn btn--sm btn--primary" onClick={applyAllRecs}>
                  Apply all
                </button>
              </div>
              <p className="struct-hint" style={{marginTop: 0, marginBottom: 10}}>
                Based on {recs.total_rows.toLocaleString()} rows × {recs.total_columns} columns.
                Click a chip to apply just that suggestion.
              </p>
              <div style={{display: "flex", flexWrap: "wrap", gap: 6}}>
                {recs.null_strategy && recs.null_strategy !== nullStrategy && (
                  <button type="button" className="rec-chip"
                    onClick={() => setNullStrategy(recs.null_strategy!)}
                    title="Recommended null-handling strategy based on missing-value distribution">
                    Null strategy: {recs.null_strategy.replace(/_/g, " ")}
                  </button>
                )}
                {recs.standardize_columns && !standardizeCols && (
                  <button type="button" className="rec-chip"
                    onClick={() => setStandardizeCols(true)}
                    title="Some column names contain spaces or mixed case">
                    Standardise column names
                  </button>
                )}
                {recs.case_normalize && caseNormalize === "none" && (
                  <button type="button" className="rec-chip"
                    onClick={() => setCaseNormalize(recs.case_normalize!.mode)}
                    title={recs.case_normalize.reason}>
                    Case normalise: {recs.case_normalize.mode}
                  </button>
                )}
                {recs.drop_columns.map((d) => (
                  <button key={`drop-${d.column}`} type="button" className="rec-chip rec-chip--drop"
                    onClick={() => applyRecDrop(d.column)}
                    title={d.reason}
                    disabled={dropCols.includes(d.column)}>
                    Drop &ldquo;{d.column}&rdquo;
                  </button>
                ))}
                {recs.encode_columns.map((e) => (
                  <button key={`enc-${e.column}`} type="button" className="rec-chip rec-chip--encode"
                    onClick={() => applyRecEncode(e.column, e.mode)}
                    title={e.reason}
                    disabled={encodeRows.some((r) => r.column === e.column)}>
                    Encode &ldquo;{e.column}&rdquo; · {e.mode === "onehot" ? "one-hot" : "label"}
                  </button>
                ))}
                {recs.drop_columns.length === 0 && recs.encode_columns.length === 0
                  && !recs.standardize_columns && !recs.case_normalize && !recs.null_strategy && (
                  <span className="struct-hint">No actionable recommendations — your data already looks clean.</span>
                )}
              </div>
            </div>
            )
          )}

          {/* ── Per-column audit ── */}
          {datasetId && recs && recs.per_column && recs.per_column.length > 0 && (
            <div style={{
              border: "1px solid var(--dash-border)",
              borderRadius: 12, padding: "12px 14px", marginBottom: 14,
              background: "#fff",
            }}>
              <div style={{display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4}}>
                <span style={{fontSize: 14, fontWeight: 700, color: "var(--dash-text)"}}>
                  Per-column audit
                </span>
                <span style={{fontSize: 12.5, color: "var(--dash-text-muted)"}}>
                  {recs.per_column.length} column{recs.per_column.length === 1 ? "" : "s"} · click an action to apply
                </span>
              </div>
              <p className="struct-hint" style={{marginTop: 0, marginBottom: 10}}>
                What we recommend for each column individually — even "looks clean" ones are listed so nothing is hidden.
              </p>
              <div className="struct-col-audit">
                {recs.per_column.map((pc) => (
                  <div key={pc.column} className="struct-col-audit__row">
                    <div className="struct-col-audit__head">
                      <span className="struct-col-audit__name" title={pc.column}>{pc.column}</span>
                      <span className={`struct-col-audit__dtype struct-col-audit__dtype--${pc.dtype}`}>{pc.dtype}</span>
                      <span className="struct-col-audit__meta">
                        {pc.distinct.toLocaleString()} distinct
                        {pc.null_count > 0 && ` · ${pc.null_count} nulls (${Math.round(pc.null_pct * 100)}%)`}
                      </span>
                    </div>
                    <div className="struct-col-audit__actions">
                      {pc.actions.map((a, ai) => {
                        const noop = a.kind === "noop";
                        const onClick = () => {
                          if (a.kind === "drop") applyRecDrop(pc.column);
                          else if (a.kind === "encode" && (a.mode === "onehot" || a.mode === "label")) {
                            applyRecEncode(pc.column, a.mode as "onehot" | "label");
                          } else if (a.kind === "fill_nulls") {
                            // Set the global null strategy if not already set.
                            if (a.mode === "median") setNullStrategy("fill_median");
                            else if (a.mode === "mode") setNullStrategy("fill_mode");
                          } else if (a.kind === "handle_outliers") {
                            setHandleOutliers(true);
                          } else if (a.kind === "trim_whitespace") {
                            // No dedicated control — surface as a tooltip-only suggestion.
                            alert("Whitespace trim is applied automatically by case normalisation when set to lowercase / title.");
                          } else if (a.kind === "parse_date" || a.kind === "coerce_numeric") {
                            alert("Type coercion isn't a separate switch yet — note this column and we'll address it in a future round.");
                          }
                        };
                        return (
                          <button
                            key={ai}
                            type="button"
                            className={`struct-col-audit__action${noop ? " struct-col-audit__action--noop" : ""}${a.kind === "drop" ? " struct-col-audit__action--drop" : ""}`}
                            onClick={noop ? undefined : onClick}
                            disabled={noop}
                            title={a.reason}>
                            {a.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="input-group">
            <label>Null Handling Strategy</label>
            <select value={nullStrategy} onChange={(e) => setNullStrategy(e.target.value)}>
              {NULL_STRATEGIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <p className="struct-hint">{NULL_STRATEGIES.find(s => s.value === nullStrategy)?.desc}</p>
          </div>

          <div className="struct-options">
            <label className="struct-toggle">
              <input type="checkbox" checked={removeDups} onChange={(e) => setRemoveDups(e.target.checked)} />
              <div>
                <span className="struct-toggle__label">Remove Duplicates</span>
                <span className="struct-toggle__desc">Drop exact duplicate rows</span>
              </div>
            </label>
            <label className="struct-toggle">
              <input type="checkbox" checked={handleOutliers} onChange={(e) => setHandleOutliers(e.target.checked)} />
              <div>
                <span className="struct-toggle__label">Handle Outliers</span>
                <span className="struct-toggle__desc">IQR-based outlier removal</span>
              </div>
            </label>
            <label className="struct-toggle">
              <input type="checkbox" checked={standardizeCols} onChange={(e) => setStandardizeCols(e.target.checked)} />
              <div>
                <span className="struct-toggle__label">Standardize Column Names</span>
                <span className="struct-toggle__desc">Rename to lowercase snake_case</span>
              </div>
            </label>
          </div>

          <div className="input-group">
            <label>Case Normalization</label>
            <select value={caseNormalize} onChange={(e) => setCaseNormalize(e.target.value as "none" | "lower" | "upper" | "title")}>
              <option value="none">None — leave text as-is</option>
              <option value="lower">lowercase</option>
              <option value="upper">UPPERCASE</option>
              <option value="title">Title Case</option>
            </select>
            <p className="struct-hint">
              Applied to <strong>both column headings and text cell values</strong>. To also strip spaces / special characters and snake_case the names, enable “Standardize Column Names” above.
            </p>
          </div>

          {columns.length > 0 && (
            <div className="input-group">
              <label>
                Drop Columns
                {dropCols.length > 0 && (
                  <span style={{color: "var(--dash-text-muted)", fontWeight: 400, marginLeft: 6}}>
                    · {dropCols.length} selected
                  </span>
                )}
              </label>
              <div style={{display: "flex", flexWrap: "wrap", gap: 6}}>
                {columns.map((c) => {
                  const selected = dropCols.includes(c);
                  return (
                    <button key={c} type="button"
                      onClick={() => setDropCols(selected ? dropCols.filter(x => x !== c) : [...dropCols, c])}
                      style={{
                        padding: "4px 10px", fontSize: 13, borderRadius: 100,
                        border: `1px solid ${selected ? "var(--dash-text-muted)" : "var(--dash-border)"}`,
                        background: selected ? "rgba(220,38,38,0.08)" : "#fff",
                        color: selected ? "var(--dash-text-muted)" : "var(--dash-text)",
                        cursor: "pointer",
                        textDecoration: selected ? "line-through" : "none",
                        fontFamily: "inherit",
                      }}>
                      {c}
                    </button>
                  );
                })}
              </div>
              <p className="struct-hint">
                Click a column to mark it for removal{dropCols.length === 0 ? " — nothing selected, all columns kept" : ""}.
              </p>
            </div>
          )}

          <div className="input-group">
            <label>
              Categorical Encoding
              {encodeRows.filter(r => r.column).length > 0 && (
                <span style={{color: "var(--dash-text-muted)", fontWeight: 400, marginLeft: 6}}>
                  · {encodeRows.filter(r => r.column).length} configured
                </span>
              )}
            </label>
            <div style={{display: "flex", flexDirection: "column", gap: 8}}>
              {encodeRows.map((r, i) => (
                <div key={i} style={{display: "flex", gap: 8, alignItems: "center"}}>
                  <select value={r.column}
                    onChange={(e) => {
                      const u = [...encodeRows]; u[i] = { ...u[i], column: e.target.value }; setEncodeRows(u);
                    }}
                    style={{flex: 2, padding: "8px 12px", border: "1px solid var(--dash-border)", borderRadius: 8, fontSize: 14}}>
                    <option value="">Select column</option>
                    {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={r.mode}
                    onChange={(e) => {
                      const u = [...encodeRows]; u[i] = { ...u[i], mode: e.target.value as "onehot" | "label" }; setEncodeRows(u);
                    }}
                    style={{flex: 1, padding: "8px 12px", border: "1px solid var(--dash-border)", borderRadius: 8, fontSize: 14}}>
                    <option value="onehot">One-Hot</option>
                    <option value="label">Label codes</option>
                  </select>
                  <button type="button" className="btn btn--sm btn--danger"
                    onClick={() => setEncodeRows(encodeRows.filter((_, idx) => idx !== i))}>
                    &times;
                  </button>
                </div>
              ))}
              {columns.length > 0 ? (
                <button type="button" className="btn btn--sm btn--secondary"
                  onClick={() => setEncodeRows([...encodeRows, { column: "", mode: "onehot" }])}>
                  + Add encoding
                </button>
              ) : (
                <p className="struct-hint">Select a dataset above to enable encoding.</p>
              )}
            </div>
            <p className="struct-hint">
              One-Hot expands a column into N true/false columns (e.g. gender → gender_male, gender_female). Label codes replace each value with an integer — better for ordinal data.
            </p>
          </div>

          <div style={{display: "flex", gap: 10}}>
            <button className="btn btn--primary" style={{flex: 1}} onClick={handleRun} disabled={!datasetId || running}>
              {running ? "Processing..." : "Run Structuring"}
            </button>
            {running && (
              <button type="button" className="btn btn--secondary"
                onClick={handleCancelRun}
                title="Stop tracking this run and re-enable the form. Use this if a run looks frozen — the backend job will keep running in the background until it finishes or fails.">
                Reset
              </button>
            )}
          </div>

          <TaskMonitor rate={rate} task={task} steps={steps} stuck={stuck} progressPct={progressPct} running={running} />
          {running && progressPct >= 95 && (
            <p style={{fontSize: 12.5, color: "var(--dash-text-muted)", marginTop: 6, fontStyle: "italic"}}>
              Almost done — finalising the cleaned file and updating the dataset status. If this hangs for more than 30 seconds, hit Reset and try again.
            </p>
          )}
        </div>

        {/* ── Results Panel ── */}
        <div className="card" style={{flex: 2}}>
          {report && (
            <div style={{display: "flex", justifyContent: "flex-end", gap: 10, marginBottom: 14, flexWrap: "wrap"}}>
              <button className="btn btn--secondary btn--sm" onClick={handleDownload}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                </svg>
                Download cleaned CSV
              </button>
              <Link to={`/eda?dataset=${datasetId}`} className="btn btn--primary btn--sm">
                Continue to EDA
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 5l7 7-7 7"/>
                </svg>
              </Link>
            </div>
          )}
          <div className="tabs">
            <button className={`tab ${tab === "visual" ? "tab--active" : ""}`} onClick={() => setTab("visual")}>Visual</button>
            <button className={`tab ${tab === "steps" ? "tab--active" : ""}`} onClick={() => setTab("steps")}>Steps</button>
            <button className={`tab ${tab === "raw" ? "tab--active" : ""}`} onClick={() => setTab("raw")}>Raw JSON</button>
          </div>

          {!report ? (
            <div className="empty-state"><h3>No results yet</h3><p>Select a dataset and run structuring</p></div>
          ) : (
            <>
              {/* ── Visual Tab ── */}
              {tab === "visual" && (
                <div className="struct-visual">
                  {/* Quality score banner */}
                  {quality && typeof quality.overall_score === "number" && (
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "12px 16px", marginBottom: 16, borderRadius: 12,
                      background: "var(--dash-primary-dim)", border: "1px solid var(--dash-border)",
                    }}>
                      <span style={{fontSize: 14, fontWeight: 600, color: "var(--dash-text)"}}>Data Quality Score</span>
                      <span style={{fontSize: 16, fontWeight: 800, color: "var(--dash-primary)"}}>
                        {quality.overall_score}{quality.grade ? ` · Grade ${quality.grade}` : ""}
                      </span>
                    </div>
                  )}
                  {/* Summary stat cards */}
                  <div className="struct-stats-grid">
                    <div className="struct-stat-card">
                      <span className="struct-stat-card__value">{report.original_rows.toLocaleString()}</span>
                      <span className="struct-stat-card__label">Original Rows</span>
                    </div>
                    <div className="struct-stat-card">
                      <span className="struct-stat-card__value">{report.final_rows.toLocaleString()}</span>
                      <span className="struct-stat-card__label">Final Rows</span>
                    </div>
                    <div className="struct-stat-card">
                      <span className="struct-stat-card__value struct-stat-card__value--danger">{report.total_rows_removed.toLocaleString()}</span>
                      <span className="struct-stat-card__label">Rows Removed</span>
                    </div>
                    <div className="struct-stat-card">
                      <span className="struct-stat-card__value struct-stat-card__value--success">{report.total_nulls_filled.toLocaleString()}</span>
                      <span className="struct-stat-card__label">Nulls Handled</span>
                    </div>
                  </div>

                  {/* Retention bar */}
                  <div className="struct-retention">
                    <div className="struct-retention__header">
                      <span>Data Retention</span>
                      <span className="struct-retention__pct">{retentionPct}%</span>
                    </div>
                    <div className="struct-retention__track">
                      <div className="struct-retention__fill" style={{
                        width: `${retentionPct}%`,
                        background: retentionPct > 90 ? "var(--dash-text)" : retentionPct > 70 ? "var(--dash-text-secondary)" : "var(--dash-text-muted)"
                      }} />
                    </div>
                    <div className="struct-retention__footer">
                      <span>{report.original_columns} columns</span>
                      <span>{report.final_columns} final columns</span>
                    </div>
                  </div>

                  {/* ── Before / After preview ── */}
                  {(beforePreview || afterPreview) && (
                    <div className="struct-ba">
                      <h4>Before / After preview</h4>
                      <p className="struct-hint" style={{marginTop: -4, marginBottom: 10}}>
                        First 5 rows of the raw upload (left) vs. the cleaned output (right).
                      </p>
                      <div className="struct-ba__grid">
                        <div className="struct-ba__panel">
                          <div className="struct-ba__caption struct-ba__caption--before">Before · raw</div>
                          {beforePreview && beforePreview.columns.length > 0 ? (
                            <div className="struct-ba__scroll">
                              <table className="ds-preview-table">
                                <thead><tr>{beforePreview.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                                <tbody>
                                  {beforePreview.rows.map((row, i) => (
                                    <tr key={i}>{beforePreview.columns.map((_, j) => (
                                      <td key={j} title={row[j] ?? ""}>{row[j] ?? ""}</td>
                                    ))}</tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="ds-preview-empty">Preview unavailable</div>
                          )}
                        </div>
                        <div className="struct-ba__panel">
                          <div className="struct-ba__caption struct-ba__caption--after">After · cleaned</div>
                          {afterPreview && afterPreview.columns.length > 0 ? (
                            <div className="struct-ba__scroll">
                              <table className="ds-preview-table">
                                <thead><tr>{afterPreview.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                                <tbody>
                                  {afterPreview.rows.map((row, i) => (
                                    <tr key={i}>{afterPreview.columns.map((_, j) => (
                                      <td key={j} title={row[j] ?? ""}>{row[j] ?? ""}</td>
                                    ))}</tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="ds-preview-empty">Run structuring to see the cleaned output here.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Steps timeline */}
                  {(report.steps?.length ?? 0) > 0 && (
                    <div className="struct-timeline">
                      <h4>Cleaning Pipeline</h4>
                      {(report.steps ?? []).map((step, i) => (
                        <div key={i} className="struct-timeline__step">
                          <div className="struct-timeline__dot" />
                          <div className="struct-timeline__content">
                            <span className="struct-timeline__name">{step.step.replace(/_/g, " ")}</span>
                            <span className="struct-timeline__desc">{step.description}</span>
                            <div className="struct-timeline__meta">
                              <span>{step.rows_before.toLocaleString()} → {step.rows_after.toLocaleString()} rows</span>
                              {step.rows_affected > 0 && <span className="struct-timeline__affected">({step.rows_affected} affected)</span>}
                              {step.columns_affected.length > 0 && (
                                <span className="struct-timeline__cols">Cols: {step.columns_affected.slice(0, 5).join(", ")}{step.columns_affected.length > 5 ? ` +${step.columns_affected.length - 5}` : ""}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Steps Tab ── */}
              {tab === "steps" && (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr><th>Step</th><th>Description</th><th>Before</th><th>After</th><th>Affected</th><th>Columns</th></tr>
                    </thead>
                    <tbody>
                      {(report.steps ?? []).map((step, i) => (
                        <tr key={i}>
                          <td style={{fontWeight: 600, color: "var(--dash-text)"}}>{step.step.replace(/_/g, " ")}</td>
                          <td>{step.description}</td>
                          <td>{step.rows_before.toLocaleString()}</td>
                          <td>{step.rows_after.toLocaleString()}</td>
                          <td>{step.rows_affected.toLocaleString()}</td>
                          <td style={{fontSize: 13, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}
                            title={step.columns_affected.join(", ")}>
                            {step.columns_affected.join(", ") || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* ── Raw JSON Tab ── */}
              {tab === "raw" && (
                <pre style={{fontSize: 13, color: "var(--dash-text-secondary)", overflow: "auto", maxHeight: 500, whiteSpace: "pre-wrap", background: "var(--dash-surface-hover)", padding: 12, borderRadius: 8}}>
                  {JSON.stringify(results, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
