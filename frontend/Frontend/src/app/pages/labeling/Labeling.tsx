import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { datasetApi } from "../../../shared/api/datasets";
import { labelingApi } from "../../../shared/api/labeling";
import type { RuleDefinition, PreviewRulesResponse, RuleSetSummary } from "../../../shared/api/labeling";
import { useTaskPolling } from "../../hooks/usePolling";
import TaskMonitor from "../../components/TaskMonitor/TaskMonitor";
import "./Labeling.css";

interface LabelingReport {
  total_rows: number; labeled_count: number; unlabeled_count: number;
  label_distribution: Record<string, number>; rules_applied: number;
  conflict_count: number;
  per_rule_stats: Array<{ rule_index: number; matches: number; label: string }>;
  warnings: string[];
}

/* ── Internal (compound) rule shape ──
   The editor always stores rules in compound form. Legacy flat rules loaded
   from a saved rule set are normalised on read. On send the compound shape
   is preserved (the backend accepts both). */
interface UICondition { column: string; operator: string; value: string }
interface UIRule {
  label: string;
  priority: number;
  logic: "and" | "or";
  conditions: UICondition[];
}

const emptyCondition = (): UICondition => ({ column: "", operator: "equals", value: "" });
const emptyRule = (priority = 0): UIRule => ({
  label: "", priority, logic: "and", conditions: [emptyCondition()],
});

/** Normalise a server-side rule (legacy or compound) to the compound UI shape. */
const legacyToUI = (rd: RuleDefinition, idx: number): UIRule => {
  const conditions: UICondition[] = rd.conditions && rd.conditions.length > 0
    ? rd.conditions.map((c) => ({
        column: c.column || "", operator: c.operator || "equals", value: String(c.value ?? ""),
      }))
    : [{
        column: rd.column || "", operator: rd.operator || "equals", value: String(rd.value ?? ""),
      }];
  return {
    label: rd.label || "",
    priority: rd.priority ?? idx,
    logic: (rd.logic === "or" ? "or" : "and"),
    conditions,
  };
};

/** Build the API payload from a UI rule (always sends the compound shape). */
const uiToApi = (r: UIRule): RuleDefinition => ({
  label: r.label,
  priority: r.priority,
  logic: r.logic,
  conditions: r.conditions.map((c) => ({
    column: c.column, operator: c.operator, value: c.value,
  })),
});

/* ── Rule templates (compound shape) ── */
const RULE_TEMPLATES: Array<{ name: string; rules: UIRule[] }> = [
  { name: "Sentiment (positive)", rules: [{ label: "positive", priority: 0, logic: "and",
      conditions: [{ column: "text", operator: "contains", value: "good,great,excellent,amazing" }] }] },
  { name: "Sentiment (negative)", rules: [{ label: "negative", priority: 0, logic: "and",
      conditions: [{ column: "text", operator: "contains", value: "bad,terrible,awful,poor" }] }] },
  { name: "Category by keyword", rules: [{ label: "", priority: 0, logic: "and",
      conditions: [{ column: "description", operator: "contains", value: "" }] }] },
  { name: "Null detection", rules: [{ label: "missing", priority: 0, logic: "and",
      conditions: [{ column: "", operator: "is_null", value: "" }] }] },
  { name: "Compound: female + age 30-45", rules: [{ label: "target_segment", priority: 0, logic: "and",
      conditions: [
        { column: "gender", operator: "equals", value: "female" },
        { column: "age", operator: "between", value: "30,45" },
      ] }] },
];

/* Operators where the "value" is a single discrete item — for these we can
   safely substitute a dropdown when the column is non-numerical. Multi-value
   operators (in_list / not_in_list) and null-checks fall back to free text. */
const SINGLE_VALUE_OPERATORS = new Set([
  "equals", "not_equals", "contains", "not_contains",
  "starts_with", "ends_with", "regex",
]);

type ColumnInfo = {
  is_numeric: boolean;
  values: string[];
  truncated: boolean;
  stats?: { min?: number; max?: number; mean?: number };
};

export default function Labeling() {
  const [datasets, setDatasets] = useState<Array<{id:string; name:string}>>([]);
  const [datasetId, setDatasetId] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [columnInfo, setColumnInfo] = useState<Record<string, ColumnInfo>>({});
  const [operators, setOperators] = useState<string[]>([]);
  const [rules, setRules] = useState<UIRule[]>([emptyRule()]);
  const [conflictStrategy, setConflictStrategy] = useState("first_match");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [results, setResults] = useState<{ result?: { labeling?: LabelingReport } } | null>(null);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<"visual" | "rules-perf" | "raw">("visual");
  const { task, steps, stuck, progressPct } = useTaskPolling(taskId);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewRulesResponse | null>(null);
  const [previewError, setPreviewError] = useState("");
  // Saved rule sets
  const [ruleSets, setRuleSets] = useState<RuleSetSummary[]>([]);
  const [activeRuleSetId, setActiveRuleSetId] = useState<string>("");
  const [activeRuleSetName, setActiveRuleSetName] = useState<string>("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  // Drag-to-reorder
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  const [searchParams] = useSearchParams();

  useEffect(() => {
    datasetApi.list({ limit: 100 }).then((r) => {
      setDatasets((Array.isArray(r.data) ? r.data : r.data.datasets || []).filter((d: {source_type?: string}) => d.source_type !== "image" && d.source_type !== "text"));
    }).catch(() => {});
    labelingApi.getOperators().then((r) => setOperators(r.data.operators || [])).catch(() => {});
    labelingApi.listRuleSets().then((r) => setRuleSets(r.data.rule_sets || [])).catch(() => {});
    const preselect = searchParams.get("dataset");
    if (preselect) setDatasetId(preselect);
  }, [searchParams]);

  const refreshRuleSets = async () => {
    try {
      const r = await labelingApi.listRuleSets();
      setRuleSets(r.data.rule_sets || []);
    } catch { /* ignore */ }
  };

  const handleLoadRuleSet = async (id: string) => {
    if (!id) {
      setActiveRuleSetId(""); setActiveRuleSetName("");
      return;
    }
    try {
      const r = await labelingApi.getRuleSet(id);
      // Normalise either legacy or compound shape into our UI shape.
      const normalised = (r.data.rules || []).map((rule, i) => legacyToUI(rule, i));
      setRules(normalised.length > 0 ? normalised : [emptyRule()]);
      setActiveRuleSetId(id);
      setActiveRuleSetName(r.data.name);
      setPreview(null);
    } catch {
      alert("Could not load that rule set.");
    }
  };

  // A rule is "valid" if it has a label AND at least one condition with a column.
  const validRules = (): UIRule[] =>
    rules.filter((r) => r.label && r.conditions.some((c) => c.column));

  const handleSaveRuleSet = async () => {
    const valid = validRules();
    if (valid.length === 0) {
      alert("Add at least one rule with a label and a condition before saving.");
      return;
    }
    if (!saveName.trim()) {
      alert("Give the rule set a name.");
      return;
    }
    try {
      const res = await labelingApi.createRuleSet({
        name: saveName.trim(),
        description: saveDesc.trim(),
        rules: valid.map(uiToApi),
      });
      await refreshRuleSets();
      setActiveRuleSetId(res.data.id);
      setActiveRuleSetName(res.data.name);
      setShowSaveDialog(false);
      setSaveName(""); setSaveDesc("");
    } catch {
      alert("Save failed.");
    }
  };

  const handleUpdateRuleSet = async () => {
    if (!activeRuleSetId) return;
    const valid = validRules();
    if (valid.length === 0) {
      alert("At least one valid rule is required.");
      return;
    }
    try {
      await labelingApi.updateRuleSet(activeRuleSetId, { rules: valid.map(uiToApi) });
      await refreshRuleSets();
    } catch {
      alert("Update failed.");
    }
  };

  const handleDeleteRuleSet = async () => {
    if (!activeRuleSetId) return;
    if (!confirm(`Delete saved rule set "${activeRuleSetName}"? This can't be undone.`)) return;
    try {
      await labelingApi.deleteRuleSet(activeRuleSetId);
      setActiveRuleSetId(""); setActiveRuleSetName("");
      await refreshRuleSets();
    } catch {
      alert("Delete failed.");
    }
  };

  // ── Drag-to-reorder handlers ──
  const onDragStart = (i: number) => (e: React.DragEvent) => {
    setDragIdx(i);
    e.dataTransfer.effectAllowed = "move";
    // Some browsers refuse drag without dataTransfer payload.
    try { e.dataTransfer.setData("text/plain", String(i)); } catch { /* noop */ }
  };
  const onDragOver = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropIdx !== i) setDropIdx(i);
  };
  const onDragEnd = () => { setDragIdx(null); setDropIdx(null); };
  const onDrop = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) { onDragEnd(); return; }
    const next = [...rules];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(i, 0, moved);
    // Re-assign priorities to match new order
    setRules(next.map((r, idx) => ({ ...r, priority: idx })));
    onDragEnd();
  };

  const handleDownload = async () => {
    if (!datasetId) return;
    try {
      const res = await labelingApi.download(datasetId);
      const blob = new Blob([res.data], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `labeled_${datasetId.slice(0, 8)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Download failed — make sure a labeling run has completed for this dataset.");
    }
  };

  useEffect(() => {
    if (task?.status === "completed" && datasetId) {
      labelingApi.getResults(datasetId).then((r) => setResults(r.data)).catch(() => {});
      setRunning(false);
    }
    if (task?.status === "failed") setRunning(false);
  }, [task?.status, datasetId]);

  // Auto-load existing results + the dataset's column list (for the dropdown).
  // Reset the per-column dtype cache whenever the dataset changes.
  useEffect(() => {
    setColumnInfo({});
    if (!datasetId) { setColumns([]); return; }
    labelingApi.getResults(datasetId).then((r) => setResults(r.data)).catch(() => {});
    datasetApi.getColumns(datasetId)
      .then((r) => setColumns(r.data.columns || []))
      .catch(() => setColumns([]));
  }, [datasetId]);

  // Lazily fetch the dtype + distinct values for any column referenced in a
  // rule condition. Cached in `columnInfo` so we don't re-hit the API for the same col.
  useEffect(() => {
    if (!datasetId) return;
    const wanted = Array.from(new Set(
      rules.flatMap((r) => r.conditions.map((c) => c.column)).filter(Boolean)
    ));
    const missing = wanted.filter((c) => !(c in columnInfo));
    if (missing.length === 0) return;
    missing.forEach((col) => {
      datasetApi.getColumnValues(datasetId, col)
        .then((r) => setColumnInfo((prev) => ({
          ...prev,
          [col]: {
            is_numeric: !!r.data.is_numeric,
            values: r.data.values || [],
            truncated: !!r.data.truncated,
            stats: r.data.stats,
          },
        })))
        .catch(() => setColumnInfo((prev) => ({
          ...prev, [col]: { is_numeric: false, values: [], truncated: false },
        })));
    });
  }, [datasetId, rules, columnInfo]);

  const addRule = () => setRules([...rules, emptyRule(rules.length)]);
  const removeRule = (i: number) => {
    const next = rules.filter((_, idx) => idx !== i);
    setRules(next.length > 0 ? next : [emptyRule()]);
  };
  const updateRuleLabel = (i: number, val: string) => {
    const next = [...rules]; next[i] = { ...next[i], label: val }; setRules(next);
  };
  const updateRuleLogic = (i: number, val: "and" | "or") => {
    const next = [...rules]; next[i] = { ...next[i], logic: val }; setRules(next);
  };
  const addCondition = (i: number) => {
    const next = [...rules];
    next[i] = { ...next[i], conditions: [...next[i].conditions, emptyCondition()] };
    setRules(next);
  };
  const removeCondition = (ruleIdx: number, condIdx: number) => {
    const next = [...rules];
    const conds = next[ruleIdx].conditions.filter((_, idx) => idx !== condIdx);
    next[ruleIdx] = { ...next[ruleIdx], conditions: conds.length > 0 ? conds : [emptyCondition()] };
    setRules(next);
  };
  const updateCondition = (ruleIdx: number, condIdx: number, field: keyof UICondition, val: string) => {
    const next = [...rules];
    const conds = [...next[ruleIdx].conditions];
    conds[condIdx] = { ...conds[condIdx], [field]: val };
    next[ruleIdx] = { ...next[ruleIdx], conditions: conds };
    setRules(next);
  };

  const applyTemplate = (tmpl: typeof RULE_TEMPLATES[0]) => {
    setRules(tmpl.rules.map((r, i) => ({
      ...r, priority: i,
      conditions: r.conditions.map((c) => ({ ...c })),
    })));
  };

  const handleRun = async () => {
    if (!datasetId) return;
    setRunning(true); setResults(null);
    try {
      const payload = validRules().map(uiToApi);
      const res = await labelingApi.run({ dataset_id: datasetId, rules: payload, conflict_strategy: conflictStrategy });
      setTaskId(res.data.task_id);
    } catch { setRunning(false); alert("Failed"); }
  };

  const handlePreview = async () => {
    if (!datasetId) return;
    const valid = validRules();
    if (valid.length === 0) {
      setPreviewError("Add at least one rule with a label and a condition first.");
      return;
    }
    setPreviewing(true); setPreviewError(""); setPreview(null);
    try {
      const res = await labelingApi.previewRules({
        dataset_id: datasetId,
        rules: valid.map(uiToApi),
        conflict_strategy: conflictStrategy,
        sample_size: 500,
        samples_per_rule: 5,
      });
      setPreview(res.data);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setPreviewError(typeof detail === "string" ? detail : "Preview failed.");
    } finally {
      setPreviewing(false);
    }
  };

  /** Short text summary for a rule used in previews/results. */
  const ruleSummary = (r: UIRule): string => {
    if (r.conditions.length === 0) return "(no conditions)";
    const join = ` ${r.logic.toUpperCase()} `;
    return r.conditions.map((c) =>
      `${c.column} ${c.operator.replace(/_/g, " ")} ${String(c.value).slice(0, 20)}`
    ).join(join);
  };

  // The labeling Celery task stores { labeling, labeled_file_path, ... } — the
  // report lives under result.labeling, NOT result itself.
  const report: LabelingReport | null = results?.result?.labeling ?? null;
  const coveragePct = report ? Math.round((report.labeled_count / Math.max(report.total_rows, 1)) * 100) : 0;

  // Label distribution for chart
  const distEntries = report ? Object.entries(report.label_distribution).sort((a, b) => b[1] - a[1]) : [];
  const distMax = distEntries.length > 0 ? Math.max(...distEntries.map(d => d[1])) : 1;

  return (
    <div>
      <div className="page-header">
        <h1>Rule-Based Labeling</h1>
        <p>Define rules to automatically label your data</p>
      </div>

      {/* ── Rules Builder ── */}
      <div className="card" style={{marginBottom: 20}}>
        <div className="card-header">
          <h3>Label Rules</h3>
          <div style={{display: "flex", gap: 8}}>
            <button className="btn btn--sm btn--secondary" onClick={addRule}>+ Add Rule</button>
          </div>
        </div>

        <div className="input-group">
          <label>Dataset</label>
          <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
            <option value="">Select a dataset</option>
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>

        {/* ── Saved rule sets ── */}
        <div className="input-group">
          <label>Saved rule sets</label>
          <div style={{display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center"}}>
            <select value={activeRuleSetId} onChange={(e) => handleLoadRuleSet(e.target.value)}
              style={{flex: 1, minWidth: 200}}>
              <option value="">— pick a saved set —</option>
              {ruleSets.map((rs) => (
                <option key={rs.id} value={rs.id}>{rs.name} ({rs.rule_count} rule{rs.rule_count === 1 ? "" : "s"})</option>
              ))}
            </select>
            <button type="button" className="btn btn--sm btn--secondary"
              onClick={() => { setShowSaveDialog(true); setSaveName(activeRuleSetName); setSaveDesc(""); }}>
              Save as new
            </button>
            {activeRuleSetId && (
              <>
                <button type="button" className="btn btn--sm btn--secondary"
                  onClick={handleUpdateRuleSet}
                  title="Overwrite this rule set with the current rules">
                  Update
                </button>
                <button type="button" className="btn btn--sm btn--danger"
                  onClick={handleDeleteRuleSet}>
                  Delete
                </button>
              </>
            )}
          </div>
          {activeRuleSetName && (
            <p className="struct-hint">
              Loaded: <strong>{activeRuleSetName}</strong>. Edits stay local until you click Update or Save as new.
            </p>
          )}
        </div>

        {/* Templates */}
        <div className="label-templates">
          <span className="label-templates__title">Quick templates:</span>
          {RULE_TEMPLATES.map((t, i) => (
            <button key={i} className="label-template-chip" onClick={() => applyTemplate(t)}>{t.name}</button>
          ))}
        </div>

        {/* Rules (compound) */}
        {rules.map((rule, i) => (
          <div key={i}
            className={`label-rule-card${dropIdx === i && dragIdx !== null && dragIdx !== i ? " label-rule-card--drop" : ""}${dragIdx === i ? " label-rule-card--dragging" : ""}`}
            onDragOver={onDragOver(i)} onDrop={onDrop(i)}>
            {/* Header bar */}
            <div className="label-rule-card__head">
              <span className="label-rule-row__handle" draggable
                onDragStart={onDragStart(i)} onDragEnd={onDragEnd}
                title="Drag to reorder">
                <svg width="11" height="14" viewBox="0 0 11 14" aria-hidden>
                  <circle cx="2.5" cy="2.5" r="1.4" fill="currentColor"/>
                  <circle cx="8.5" cy="2.5" r="1.4" fill="currentColor"/>
                  <circle cx="2.5" cy="7" r="1.4" fill="currentColor"/>
                  <circle cx="8.5" cy="7" r="1.4" fill="currentColor"/>
                  <circle cx="2.5" cy="11.5" r="1.4" fill="currentColor"/>
                  <circle cx="8.5" cy="11.5" r="1.4" fill="currentColor"/>
                </svg>
              </span>
              <span className="label-rule-row__num">{i + 1}</span>
              <div style={{flex: 1, display: "flex", gap: 8, alignItems: "center"}}>
                <span style={{fontSize: 12.5, color: "var(--dash-text-muted)", whiteSpace: "nowrap"}}>
                  When
                  {rule.conditions.length > 1 && (
                    <>
                      {" "}
                      <select value={rule.logic}
                        onChange={(e) => updateRuleLogic(i, e.target.value as "and" | "or")}
                        style={{display: "inline-block", width: "auto", padding: "2px 6px",
                          fontSize: 12, marginLeft: 2, marginRight: 2,
                          border: "1px solid var(--dash-border)", borderRadius: 6}}>
                        <option value="and">ALL</option>
                        <option value="or">ANY</option>
                      </select>
                      conditions match,
                    </>
                  )}
                  {rule.conditions.length <= 1 && " the condition matches,"}
                </span>
                <span style={{fontSize: 12.5, color: "var(--dash-text-muted)"}}>label as</span>
                <input
                  placeholder="label name"
                  value={rule.label}
                  onChange={(e) => updateRuleLabel(i, e.target.value)}
                  style={{flex: 1, maxWidth: 220, padding: "6px 10px", fontSize: 13,
                    border: `1px solid ${rule.label ? "var(--dash-text)" : "var(--dash-border)"}`,
                    borderRadius: 8, fontWeight: 600}}
                />
              </div>
              <button className="btn btn--sm btn--danger"
                onClick={() => removeRule(i)}
                title="Remove this rule"
                style={{flexShrink: 0}}>&times;</button>
            </div>

            {/* Conditions list */}
            <div className="label-rule-card__conds">
              {rule.conditions.map((cond, ci) => (
                <div key={ci} className="label-rule-cond">
                  {ci > 0 && (
                    <span className="label-rule-cond__joiner">{rule.logic.toUpperCase()}</span>
                  )}
                  <div className="input-group" style={{flex: 1, marginBottom: 0}}>
                    {columns.length > 0 ? (
                      <select value={cond.column}
                        onChange={(e) => updateCondition(i, ci, "column", e.target.value)}>
                        <option value="">Select column</option>
                        {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : (
                      <input placeholder={datasetId ? "column_name" : "select a dataset first"}
                        value={cond.column}
                        onChange={(e) => updateCondition(i, ci, "column", e.target.value)} />
                    )}
                  </div>
                  <div className="input-group" style={{flex: 1, marginBottom: 0}}>
                    <select value={cond.operator}
                      onChange={(e) => updateCondition(i, ci, "operator", e.target.value)}>
                      {(operators.length ? operators :
                        ["equals","not_equals","contains","not_contains","starts_with","ends_with","regex","greater_than","less_than","greater_equal","less_equal","between","in_list","is_null","is_not_null"])
                        .map((op) => <option key={op} value={op}>{op.replace(/_/g, " ")}</option>)}
                    </select>
                  </div>
                  <div className="input-group" style={{flex: 1, marginBottom: 0}}>
                    {(() => {
                      const info = cond.column ? columnInfo[cond.column] : undefined;
                      const isNullOp = cond.operator === "is_null" || cond.operator === "is_not_null";
                      const isListOp = cond.operator === "in_list" || cond.operator === "not_in_list";
                      const isBetweenOp = cond.operator === "between";
                      const isRegexOp = cond.operator === "regex" || cond.operator === "regex_match";
                      const canUseDropdown =
                        !!info && !info.is_numeric && info.values.length > 0 &&
                        SINGLE_VALUE_OPERATORS.has(cond.operator);

                      // Build the helper hint line that tells the user what
                      // kind of value to type. Goes under the input.
                      let hint = "";
                      if (!cond.column) {
                        hint = "Pick a column first to see what kind of value goes here.";
                      } else if (!info) {
                        hint = "Loading column details…";
                      } else if (isNullOp) {
                        hint = "No value needed — checks whether the cell is empty.";
                      } else if (isRegexOp) {
                        hint = "Regular expression — e.g. ^[A-Z]\\d+$ to match a capital letter followed by digits.";
                      } else if (isBetweenOp && info.is_numeric) {
                        const lo = info.stats?.min, hi = info.stats?.max;
                        hint = lo !== undefined && hi !== undefined
                          ? `Numeric range. Values in this column run from ${lo} to ${hi}.`
                          : "Numeric range — enter a low and a high number.";
                      } else if (isListOp) {
                        hint = info.is_numeric
                          ? "Comma-separated numbers — e.g. 10,20,30"
                          : info.values.length > 0
                            ? `Comma-separated values — e.g. ${info.values.slice(0, 3).join(",")}`
                            : "Comma-separated values.";
                      } else if (info.is_numeric) {
                        const lo = info.stats?.min, hi = info.stats?.max, mean = info.stats?.mean;
                        hint = lo !== undefined && hi !== undefined
                          ? `Number. This column ranges ${lo} – ${hi}${mean !== undefined ? ` (mean ${mean})` : ""}.`
                          : "Type a number.";
                      } else if (info.values.length > 0) {
                        hint = info.truncated
                          ? `Pick one of ${info.values.length}+ distinct values from the dropdown.`
                          : `Pick one of ${info.values.length} distinct value${info.values.length === 1 ? "" : "s"} from the dropdown.`;
                      } else {
                        hint = "Type the text to match.";
                      }

                      // The actual input control.
                      let control: React.ReactNode;
                      if (isNullOp) {
                        control = <input placeholder="(not used)" value="" disabled />;
                      } else if (isBetweenOp) {
                        const parts = (cond.value || "").split(",");
                        const low = parts[0] || "";
                        const high = parts[1] || "";
                        const lo = info?.stats?.min, hi = info?.stats?.max;
                        control = (
                          <div style={{display: "flex", gap: 4, alignItems: "center"}}>
                            <input
                              placeholder={lo !== undefined ? `min (≥ ${lo})` : "min"}
                              value={low}
                              onChange={(e) => updateCondition(i, ci, "value", `${e.target.value},${high}`)}
                              inputMode="decimal" style={{width: "50%", minWidth: 0}} />
                            <span style={{fontSize: 12, color: "var(--dash-text-muted)"}}>–</span>
                            <input
                              placeholder={hi !== undefined ? `max (≤ ${hi})` : "max"}
                              value={high}
                              onChange={(e) => updateCondition(i, ci, "value", `${low},${e.target.value}`)}
                              inputMode="decimal" style={{width: "50%", minWidth: 0}} />
                          </div>
                        );
                      } else if (isListOp) {
                        control = (
                          <input
                            placeholder={info && !info.is_numeric && info.values.length > 0
                              ? `e.g. ${info.values.slice(0, 3).join(",")}`
                              : "comma-separated values"}
                            value={cond.value}
                            onChange={(e) => updateCondition(i, ci, "value", e.target.value)}
                          />
                        );
                      } else if (canUseDropdown) {
                        control = (
                          <select value={cond.value}
                            onChange={(e) => updateCondition(i, ci, "value", e.target.value)}>
                            <option value="">Select value</option>
                            {info!.values.map((v) => (
                              <option key={v} value={v}>{v}</option>
                            ))}
                            {info!.truncated && (
                              <option disabled value="">… more values truncated</option>
                            )}
                          </select>
                        );
                      } else {
                        const lo = info?.stats?.min, hi = info?.stats?.max;
                        const placeholder = isRegexOp
                          ? "regex pattern"
                          : info?.is_numeric
                            ? (lo !== undefined && hi !== undefined ? `e.g. ${Math.round((lo + hi) / 2)}` : "e.g. 100")
                            : "value";
                        control = (
                          <input
                            placeholder={placeholder}
                            value={cond.value}
                            onChange={(e) => updateCondition(i, ci, "value", e.target.value)}
                          />
                        );
                      }

                      return (
                        <>
                          {control}
                          {hint && (
                            <p style={{
                              fontSize: 11, color: "var(--dash-text-muted)",
                              margin: "4px 0 0", fontStyle: "italic", lineHeight: 1.3,
                            }}>{hint}</p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <button className="btn btn--sm btn--danger"
                    onClick={() => removeCondition(i, ci)}
                    title="Remove condition"
                    style={{flexShrink: 0}}>&times;</button>
                </div>
              ))}
              <button type="button" className="label-rule-card__addcond"
                onClick={() => addCondition(i)}>
                + Add condition
              </button>
            </div>
          </div>
        ))}

        <div style={{display: "flex", gap: 12, marginTop: 16, alignItems: "flex-end", flexWrap: "wrap"}}>
          <div className="input-group" style={{marginBottom: 0}}>
            <label>Conflict Strategy</label>
            <select value={conflictStrategy} onChange={(e) => setConflictStrategy(e.target.value)}>
              <option value="first_match">First Match</option>
              <option value="majority_vote">Majority Vote</option>
            </select>
          </div>
          <button className="btn btn--secondary" onClick={handlePreview} disabled={!datasetId || previewing || running}>
            {previewing ? "Previewing..." : "Preview on 500 rows"}
          </button>
          <button className="btn btn--primary" onClick={handleRun} disabled={!datasetId || running}>
            {running ? "Running..." : "Run Labeling"}
          </button>
        </div>

        {previewError && (
          <div style={{
            marginTop: 12, padding: "10px 12px",
            background: "rgba(239,68,68,0.08)", color: "var(--dash-text-muted)",
            border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8, fontSize: 12.5,
          }}>{previewError}</div>
        )}

        <TaskMonitor task={task} steps={steps} stuck={stuck} progressPct={progressPct} running={running} />

        {/* ── Rule preview / dry-run ── */}
        {preview && (
          <div style={{
            marginTop: 16, padding: 14,
            border: "1px solid var(--dash-border)", borderRadius: 12,
            background: "var(--dash-primary-dim)",
          }}>
            <div style={{display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8}}>
              <strong style={{fontSize: 13.5, color: "var(--dash-text)"}}>
                Dry-run preview
              </strong>
              <span style={{fontSize: 11.5, color: "var(--dash-text-muted)"}}>
                Sample of {preview.sample_size.toLocaleString()} of {preview.total_rows.toLocaleString()} rows
              </span>
            </div>
            <div style={{display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12}}>
              <div style={{background: "#fff", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--dash-border)"}}>
                <div style={{fontSize: 11.5, color: "var(--dash-text-muted)"}}>Would label</div>
                <div style={{fontSize: 18, fontWeight: 700, color: "var(--dash-text)"}}>{preview.report.labeled_count}</div>
              </div>
              <div style={{background: "#fff", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--dash-border)"}}>
                <div style={{fontSize: 11.5, color: "var(--dash-text-muted)"}}>Unlabeled</div>
                <div style={{fontSize: 18, fontWeight: 700, color: "var(--dash-text)"}}>{preview.report.unlabeled_count}</div>
              </div>
              <div style={{background: "#fff", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--dash-border)"}}>
                <div style={{fontSize: 11.5, color: "var(--dash-text-muted)"}}>Conflicts</div>
                <div style={{fontSize: 18, fontWeight: 700, color: preview.report.conflict_count > 0 ? "var(--dash-text-muted)" : "var(--dash-text)"}}>
                  {preview.report.conflict_count}
                </div>
              </div>
            </div>
            <div style={{display: "flex", flexDirection: "column", gap: 8}}>
              {validRules().map((rule, i) => {
                const stat = preview.report.per_rule_stats[i];
                const samples = preview.per_rule_samples[i] || [];
                if (!stat) return null;
                const pct = preview.sample_size > 0
                  ? Math.round((stat.matches / preview.sample_size) * 100)
                  : 0;
                return (
                  <div key={i} style={{
                    background: "#fff", borderRadius: 8, padding: "10px 12px",
                    border: "1px solid var(--dash-border)",
                  }}>
                    <div style={{display: "flex", justifyContent: "space-between", alignItems: "baseline"}}>
                      <span style={{fontSize: 12.5, fontWeight: 600, color: "var(--dash-text)"}}>
                        Rule {i + 1} → <span className="badge badge--info">{rule.label}</span>
                        <span style={{color: "var(--dash-text-muted)", fontWeight: 400, marginLeft: 6}}>
                          {ruleSummary(rule)}
                        </span>
                      </span>
                      <span style={{fontSize: 12.5, color: stat.matches === 0 ? "var(--dash-text-muted)" : "var(--dash-text)", fontWeight: 700}}>
                        {stat.matches} match{stat.matches === 1 ? "" : "es"} ({pct}%)
                      </span>
                    </div>
                    {samples.length > 0 && (
                      <details style={{marginTop: 6}}>
                        <summary style={{fontSize: 11.5, color: "var(--dash-primary)", cursor: "pointer"}}>
                          Show {samples.length} sample {samples.length === 1 ? "row" : "rows"}
                        </summary>
                        <div style={{marginTop: 6, overflowX: "auto"}}>
                          <table className="ds-preview-table" style={{fontSize: 11.5}}>
                            <thead>
                              <tr>{preview.columns.slice(0, 6).map((c) => <th key={c}>{c}</th>)}</tr>
                            </thead>
                            <tbody>
                              {samples.map((row, si) => (
                                <tr key={si}>
                                  {preview.columns.slice(0, 6).map((c) => (
                                    <td key={c} title={String(row[c] ?? "")}>
                                      {row[c] === null || row[c] === undefined ? "" : String(row[c]).slice(0, 30)}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                    {stat.matches === 0 && samples.length === 0 && (
                      <p style={{fontSize: 11.5, color: "var(--dash-text-muted)", margin: "4px 0 0", fontStyle: "italic"}}>
                        No rows matched in the sample — check the column, operator, and value.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {preview.report.warnings && preview.report.warnings.length > 0 && (
              <div style={{marginTop: 10}}>
                {preview.report.warnings.map((w, i) => (
                  <div key={i} className="label-warning" style={{fontSize: 11.5}}>&#9888; {w}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Results ── */}
      {report && (
        <div className="card">
          <div style={{display: "flex", justifyContent: "flex-end", gap: 10, marginBottom: 14, flexWrap: "wrap"}}>
            <button className="btn btn--secondary btn--sm" onClick={handleDownload}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
              Download labeled CSV
            </button>
            <Link to={`/review?dataset=${datasetId}`} className="btn btn--primary btn--sm">
              Continue to Review
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 5l7 7-7 7"/>
              </svg>
            </Link>
          </div>
          <div className="tabs">
            <button className={`tab ${tab === "visual" ? "tab--active" : ""}`} onClick={() => setTab("visual")}>Results</button>
            <button className={`tab ${tab === "rules-perf" ? "tab--active" : ""}`} onClick={() => setTab("rules-perf")}>Rule Performance</button>
            <button className={`tab ${tab === "raw" ? "tab--active" : ""}`} onClick={() => setTab("raw")}>Raw JSON</button>
          </div>

          {/* ── Visual ── */}
          {tab === "visual" && (
            <div className="label-results">
              {/* Stats */}
              <div className="label-stats-grid">
                <div className="label-stat"><span className="label-stat__value">{report.total_rows.toLocaleString()}</span><span className="label-stat__label">Total Rows</span></div>
                <div className="label-stat"><span className="label-stat__value label-stat__value--success">{report.labeled_count.toLocaleString()}</span><span className="label-stat__label">Labeled</span></div>
                <div className="label-stat"><span className="label-stat__value label-stat__value--warning">{report.unlabeled_count.toLocaleString()}</span><span className="label-stat__label">Unlabeled</span></div>
                <div className="label-stat"><span className="label-stat__value">{report.rules_applied}</span><span className="label-stat__label">Rules Used</span></div>
                <div className="label-stat"><span className="label-stat__value label-stat__value--danger">{report.conflict_count}</span><span className="label-stat__label">Conflicts</span></div>
              </div>

              {/* Coverage bar */}
              <div className="label-coverage">
                <div className="label-coverage__header">
                  <span>Label Coverage</span>
                  <span className="label-coverage__pct">{coveragePct}%</span>
                </div>
                <div className="label-coverage__track">
                  <div className="label-coverage__fill" style={{
                    width: `${coveragePct}%`,
                    background: coveragePct > 80 ? "var(--dash-text)" : coveragePct > 50 ? "var(--dash-text-secondary)" : "var(--dash-text-muted)"
                  }} />
                </div>
              </div>

              {/* Label distribution */}
              {distEntries.length > 0 && (
                <div className="label-section">
                  <h4>Label Distribution</h4>
                  <div className="label-dist-chart">
                    {distEntries.map(([label, count]) => (
                      <div key={label} className="label-dist-row">
                        <span className="label-dist-row__label">{label}</span>
                        <div className="label-dist-row__track">
                          <div className="label-dist-row__fill" style={{ width: `${(count / distMax) * 100}%` }} />
                        </div>
                        <span className="label-dist-row__count">{count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {report.warnings && report.warnings.length > 0 && (
                <div className="label-section">
                  <h4>Warnings</h4>
                  {report.warnings.map((w, i) => (
                    <div key={i} className="label-warning">&#9888; {w}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Rule Performance ── */}
          {tab === "rules-perf" && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>#</th><th>Label</th><th>Matches</th><th>% of Total</th><th>Bar</th></tr>
                </thead>
                <tbody>
                  {(report.per_rule_stats || []).map((rs, i) => (
                    <tr key={i}>
                      <td style={{fontWeight: 600}}>{rs.rule_index + 1}</td>
                      <td><span className="badge badge--info">{rs.label}</span></td>
                      <td>{rs.matches.toLocaleString()}</td>
                      <td>{((rs.matches / Math.max(report.total_rows, 1)) * 100).toFixed(1)}%</td>
                      <td style={{width: 200}}>
                        <div style={{height: 16, background: "var(--dash-surface-hover)", borderRadius: 4, overflow: "hidden"}}>
                          <div style={{height: "100%", width: `${(rs.matches / Math.max(report.total_rows, 1)) * 100}%`, background: "var(--dash-text)", borderRadius: 4}} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Raw ── */}
          {tab === "raw" && (
            <pre style={{fontSize: 12, color: "var(--dash-text-secondary)", overflow: "auto", maxHeight: 500, whiteSpace: "pre-wrap", background: "var(--dash-surface-hover)", padding: 12, borderRadius: 8}}>
              {JSON.stringify(results, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* ── Save-as-new dialog ── */}
      {showSaveDialog && (
        <div className="modal-overlay" onClick={() => setShowSaveDialog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Save rule set</h2>
            <p style={{fontSize: 13, color: "var(--dash-text-muted)", marginTop: -4, marginBottom: 16}}>
              Persist these {validRules().length} rule(s) so you can reuse them on any dataset.
            </p>
            <div className="input-group">
              <label>Name</label>
              <input value={saveName} onChange={(e) => setSaveName(e.target.value)}
                placeholder="e.g. sentiment_v2" autoFocus />
            </div>
            <div className="input-group">
              <label>Description (optional)</label>
              <textarea value={saveDesc} onChange={(e) => setSaveDesc(e.target.value)}
                placeholder="What does this rule set do?" rows={2} />
            </div>
            <div style={{display: "flex", gap: 10, justifyContent: "flex-end"}}>
              <button className="btn btn--secondary" onClick={() => setShowSaveDialog(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={handleSaveRuleSet}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
