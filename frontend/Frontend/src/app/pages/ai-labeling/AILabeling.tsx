import { useState, useEffect } from "react";
import { datasetApi } from "../../../shared/api/datasets";
import { aiLabelingApi, type AIExample } from "../../../shared/api/aiLabeling";
import { llmApi } from "../../../shared/api/llm";
import { useTaskPolling } from "../../hooks/usePolling";
import TaskMonitor from "../../components/TaskMonitor/TaskMonitor";
import "./AILabeling.css";

type Tab = "predict" | "propagate" | "aggregate" | "synthetic" | "active";

interface Pred { text: string; label: string | null; confidence: number; reasoning?: string }
interface Provider { name: string; display_name: string }

const TAB_META: Record<Tab, { label: string; desc: string }> = {
  predict: {
    label: "AI Predict",
    desc: "Use an LLM to classify each row of a text dataset into your labels. Add few-shot examples and plain-English instructions to steer it — and preview on a few rows before the full run.",
  },
  propagate: {
    label: "Propagation",
    desc: "Spread a handful of high-confidence labels across similar rows automatically, using embedding similarity.",
  },
  aggregate: {
    label: "Aggregation",
    desc: "Combine rule-based, AI, and propagated labels into a single final label per row with a confidence score.",
  },
  synthetic: {
    label: "Synthetic Data",
    desc: "Generate realistic synthetic example texts for a label — useful to balance a small or skewed dataset.",
  },
  active: {
    label: "Active Learning",
    desc: "Surface the rows the model is least certain about — the highest-value candidates for human review.",
  },
};

// Only the core "Predict" flow is surfaced. The advanced tabs (propagate,
// aggregate, synthetic, active) stay implemented but hidden from the UI until
// they're needed — add them back to VISIBLE_TABS to restore.
const VISIBLE_TABS: Tab[] = ["predict"];

const confColor = (c: number) => (c >= 0.75 ? "var(--dash-text)" : c >= 0.5 ? "var(--dash-text-secondary)" : "var(--dash-text-muted)");

export default function AILabeling() {
  const [datasets, setDatasets] = useState<Array<{id:string; name:string}>>([]);
  const [datasetId, setDatasetId] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("predict");

  // LLM provider / model
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelName, setModelName] = useState("");
  const [modelWarning, setModelWarning] = useState("");

  // Predict config
  const [labels, setLabels] = useState<string[]>([]);
  const [labelDraft, setLabelDraft] = useState("");
  const [textColumn, setTextColumn] = useState("");
  const [instructions, setInstructions] = useState("");
  const [examples, setExamples] = useState<AIExample[]>([]);

  // Runs / results
  const [taskId, setTaskId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<unknown>(null);
  const [preview, setPreview] = useState<Pred[] | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Other tabs
  const [confThreshold, setConfThreshold] = useState(0.7);
  const [topK, setTopK] = useState(5);
  const [aggStrategy, setAggStrategy] = useState("confidence_weighted");
  const [includeRule, setIncludeRule] = useState(true);
  const [includeAI, setIncludeAI] = useState(true);
  const [includeProp, setIncludeProp] = useState(true);
  const [syntheticLabel, setSyntheticLabel] = useState("");
  const [syntheticCount, setSyntheticCount] = useState(20);
  const [syntheticResults, setSyntheticResults] = useState<unknown>(null);
  const [activeTopN, setActiveTopN] = useState(20);
  const [activeResults, setActiveResults] = useState<unknown>(null);

  const { task, steps, stuck, progressPct, rate } = useTaskPolling(taskId);

  useEffect(() => {
    datasetApi.list({ limit: 100 }).then((r) => {
      setDatasets((Array.isArray(r.data) ? r.data : r.data.datasets || []).filter((d: {source_type?: string}) => d.source_type !== "image" && d.source_type !== "text"));
    }).catch(() => {});
    llmApi.getProviders().then((r) => setProviders(r.data.providers || [])).catch(() => {});
  }, []);

  // Fetch the dataset's columns for the text-column dropdown
  useEffect(() => {
    if (!datasetId) { setColumns([]); return; }
    datasetApi.getColumns(datasetId).then((r) => {
      const cols = r.data.columns || [];
      setColumns(cols);
      // Auto-pick a sensible text column
      if (cols.length) {
        const guess = cols.find((c) => /text|content|body|message|review|comment|description/i.test(c));
        setTextColumn(guess || cols[0]);
      }
    }).catch(() => setColumns([]));
  }, [datasetId]);

  // Fetch models whenever a specific provider is chosen
  useEffect(() => {
    if (!provider) { setModels([]); setModelName(""); setModelWarning(""); return; }
    llmApi.getModels(provider).then((r) => {
      setModels(r.data.models || []);
      setModelName(r.data.models?.[0] || "");
      setModelWarning(r.data.warning || "");
    }).catch(() => { setModels([]); setModelWarning("Could not load models for this provider."); });
  }, [provider]);

  useEffect(() => {
    if (task?.status === "completed") {
      setRunning(false);
      if (datasetId) {
        const fetchResults =
          tab === "propagate" ? aiLabelingApi.getPropagation :
          tab === "aggregate" ? aiLabelingApi.getAggregation :
          aiLabelingApi.getPredictions;
        fetchResults(datasetId).then((r) => setResults(r.data)).catch(() => {});
      }
    }
    if (task?.status === "failed") setRunning(false);
  }, [task?.status, datasetId, tab]);

  // ── Labels (chip input) ──
  const addLabel = (raw: string) => {
    raw.split(",").map((s) => s.trim()).filter(Boolean).forEach((l) => {
      setLabels((prev) => (prev.includes(l) ? prev : [...prev, l]));
    });
    setLabelDraft("");
  };
  const removeLabel = (l: string) => setLabels((prev) => prev.filter((x) => x !== l));

  // ── Few-shot examples ──
  const addExample = () => setExamples((prev) => [...prev, { text: "", label: "" }]);
  const updateExample = (i: number, field: keyof AIExample, val: string) =>
    setExamples((prev) => prev.map((e, idx) => (idx === i ? { ...e, [field]: val } : e)));
  const removeExample = (i: number) => setExamples((prev) => prev.filter((_, idx) => idx !== i));

  const cleanExamples = () => examples.filter((e) => e.text.trim() && e.label.trim());

  const basePredictPayload = () => ({
    dataset_id: datasetId,
    labels,
    text_column: textColumn || "text",
    provider: provider || undefined,
    model_name: modelName || undefined,
    examples: cleanExamples().length ? cleanExamples() : undefined,
    instructions: instructions.trim() || undefined,
  });

  const apiError = (err: unknown): string => {
    const d = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
    return typeof d === "string" ? d : "Something went wrong. Check your LLM provider config and try again.";
  };

  const runPreview = async () => {
    if (!datasetId || labels.length === 0) return;
    setPreviewing(true); setPreview(null);
    try {
      const res = await aiLabelingApi.preview({ ...basePredictPayload(), sample_size: 5 });
      setPreview(res.data.predictions || []);
    } catch (err) { alert(`Preview failed: ${apiError(err)}`); }
    finally { setPreviewing(false); }
  };

  const runPredict = async () => {
    if (!datasetId || labels.length === 0) return;
    setRunning(true); setResults(null); setPreview(null);
    try {
      const res = await aiLabelingApi.predict(basePredictPayload());
      setTaskId(res.data.task_id);
    } catch (err) { setRunning(false); alert(`Prediction failed: ${apiError(err)}`); }
  };

  const runPropagate = async () => {
    if (!datasetId || labels.length === 0) return;
    setRunning(true); setResults(null);
    try {
      const res = await aiLabelingApi.propagate({
        dataset_id: datasetId, labels, confidence_threshold: confThreshold, top_k: topK,
      });
      setTaskId(res.data.task_id);
    } catch (err) { setRunning(false); alert(`Propagation failed: ${apiError(err)}`); }
  };

  const runAggregate = async () => {
    if (!datasetId) return;
    setRunning(true); setResults(null);
    try {
      const res = await aiLabelingApi.aggregate({
        dataset_id: datasetId, strategy: aggStrategy,
        include_rule_labels: includeRule, include_ai_labels: includeAI,
        include_propagated_labels: includeProp,
      });
      setTaskId(res.data.task_id);
    } catch (err) { setRunning(false); alert(`Aggregation failed: ${apiError(err)}`); }
  };

  const runSynthetic = async () => {
    if (!syntheticLabel.trim()) return;
    setSyntheticResults("loading");
    try {
      const res = await aiLabelingApi.generateSynthetic({
        label: syntheticLabel.trim(), count: syntheticCount,
        provider: provider || undefined, model_name: modelName || undefined,
      });
      setSyntheticResults(res.data);
    } catch (err) { setSyntheticResults(null); alert(`Generation failed: ${apiError(err)}`); }
  };

  const runActiveLearning = async () => {
    if (!datasetId) return;
    setActiveResults("loading");
    try {
      const res = await aiLabelingApi.activeLearning({ dataset_id: datasetId, top_n: activeTopN });
      setActiveResults(res.data);
    } catch (err) { setActiveResults(null); alert(`Active learning failed: ${apiError(err)}`); }
  };

  // ── Normalize full-run predictions for display ──
  const aiReport = ((results as Record<string, unknown>)?.result as Record<string, unknown>)?.ai_labeling
    ?? (results as Record<string, unknown>)?.result
    ?? results;
  const fullPredsRaw = Array.isArray((aiReport as Record<string, unknown>)?.predictions)
    ? ((aiReport as Record<string, unknown>).predictions as Record<string, unknown>[])
    : [];
  const fullPreds: Pred[] = fullPredsRaw.map((p) => ({
    text: String(p.text ?? ""),
    label: (p.predicted_label as string) || (p.label as string) || null,
    confidence: Number(p.confidence ?? 0),
    reasoning: p.reasoning as string | undefined,
  }));

  const distribution = (preds: Pred[]): Array<[string, number]> => {
    const m: Record<string, number> = {};
    preds.forEach((p) => { const k = p.label || "unlabeled"; m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };

  const renderPredList = (preds: Pred[]) => (
    <div>
      {preds.slice(0, 30).map((p, i) => (
        <div key={i} className="ail-pred">
          <div className="ail-pred__top">
            <span className={`ail-pred__label ${!p.label ? "ail-pred__label--empty" : ""}`}>
              {p.label || "unlabeled"}
            </span>
            <span className="ail-confbar">
              <span className="ail-confbar__fill"
                style={{ width: `${Math.round(p.confidence * 100)}%`, background: confColor(p.confidence) }} />
            </span>
            <span className="ail-pred__conf">{Math.round(p.confidence * 100)}%</span>
          </div>
          <div className="ail-pred__text">{p.text}</div>
          {p.reasoning && <div className="ail-pred__reason">{p.reasoning}</div>}
        </div>
      ))}
      {preds.length > 30 && (
        <p style={{ fontSize: 12, color: "var(--dash-text-muted)", marginTop: 10 }}>
          Showing first 30 of {preds.length} predictions.
        </p>
      )}
    </div>
  );

  const renderDistribution = (preds: Pred[]) => {
    const dist = distribution(preds);
    const max = Math.max(...dist.map((d) => d[1]), 1);
    return (
      <div className="ail-dist">
        {dist.map(([name, count]) => (
          <div key={name} className="ail-dist__row">
            <span className="ail-dist__name">{name}</span>
            <span className="ail-dist__track">
              <span className="ail-dist__fill" style={{ width: `${(count / max) * 100}%` }} />
            </span>
            <span className="ail-dist__count">{count}</span>
          </div>
        ))}
      </div>
    );
  };

  const jsonBlock = (data: unknown) => (
    <details>
      <summary style={{cursor: "pointer", fontSize: 12, color: "var(--dash-text-muted)", marginTop: 12}}>
        Raw response (for debugging)
      </summary>
      <pre style={{ fontSize: 11.5, color: "var(--dash-text-secondary)", overflow: "auto",
        maxHeight: 320, whiteSpace: "pre-wrap", background: "var(--dash-surface-hover)",
        padding: 10, borderRadius: 8, marginTop: 6 }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );

  /* Summary card grid + a Next-steps recommendation pillbox — shared layout
     used by all four non-predict result renderers below. */
  const summaryRow = (items: Array<{value: React.ReactNode; label: string; tone?: "ok"|"warn"|"bad"}>) => (
    <div className="ail-summary">
      {items.map((it, i) => (
        <div key={i} className="ail-summary__card">
          <div className={`ail-summary__value ail-summary__value--${it.tone || "neutral"}`}>{it.value}</div>
          <div className="ail-summary__label">{it.label}</div>
        </div>
      ))}
    </div>
  );

  const recommend = (lines: string[]) => (
    <div className="ail-recommend">
      <div className="ail-recommend__title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{verticalAlign: -2}}>
          <path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7c.6.5 1 1.2 1 2v.3h6V17c0-.8.4-1.5 1-2A7 7 0 0012 2z"/>
        </svg>
        Next steps
      </div>
      <ul className="ail-recommend__list">
        {lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    </div>
  );

  // ── Propagation result renderer ──────────────────────────────────────
  type PropResult = { item_id: string; propagated_label: string; confidence: number; source_id?: string; similarity_score?: number };
  const renderPropagationResult = (raw: unknown) => {
    const r = (raw as Record<string, unknown>)?.result as Record<string, unknown> | undefined;
    const report = r?.propagation || r || {};
    const propagated = Number((report as Record<string, unknown>)?.propagated_count) || 0;
    const skipped = Number((report as Record<string, unknown>)?.skipped_count) || 0;
    const totalUnlabeled = Number((report as Record<string, unknown>)?.total_unlabeled) || (propagated + skipped);
    const results: PropResult[] = Array.isArray((report as Record<string, unknown>)?.results)
      ? ((report as Record<string, unknown>).results as PropResult[]) : [];
    const threshold = Number((report as Record<string, unknown>)?.confidence_threshold) || 0;
    const labelCounts: Record<string, number> = {};
    results.forEach((p) => { labelCounts[p.propagated_label] = (labelCounts[p.propagated_label] || 0) + 1; });
    const coverage = totalUnlabeled > 0 ? Math.round((propagated / totalUnlabeled) * 100) : 0;

    return (
      <div>
        {summaryRow([
          { value: propagated.toLocaleString(), label: "Labels propagated", tone: "ok" },
          { value: skipped.toLocaleString(), label: "Rows skipped (no agreement)", tone: skipped > propagated ? "warn" : "neutral" as never },
          { value: `${coverage}%`, label: "Coverage of unlabeled", tone: coverage > 50 ? "ok" : "warn" },
        ])}

        {Object.keys(labelCounts).length > 0 && (
          <>
            <h4 style={{margin: "16px 0 8px", fontSize: 14}}>Labels assigned</h4>
            <div className="ail-dist">
              {Object.entries(labelCounts).sort((a,b)=>b[1]-a[1]).map(([name, c]) => (
                <div key={name} className="ail-dist__row">
                  <span className="ail-dist__name">{name}</span>
                  <span className="ail-dist__track">
                    <span className="ail-dist__fill" style={{width: `${(c / propagated) * 100}%`}}/>
                  </span>
                  <span className="ail-dist__count">{c}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {results.length > 0 && (
          <>
            <h4 style={{margin: "16px 0 8px", fontSize: 14}}>Sample propagations</h4>
            <div>
              {results.slice(0, 20).map((p, i) => (
                <div key={i} className="ail-pred">
                  <div className="ail-pred__top">
                    <span className="ail-pred__label">{p.propagated_label}</span>
                    <span className="ail-confbar">
                      <span className="ail-confbar__fill"
                        style={{width: `${Math.round(p.confidence * 100)}%`, background: confColor(p.confidence)}}/>
                    </span>
                    <span className="ail-pred__conf">{Math.round(p.confidence * 100)}%</span>
                  </div>
                  <div className="ail-pred__text" style={{fontSize: 11.5}}>
                    Row {p.item_id?.slice(0, 12)}…
                    {p.source_id && <> · learned from row {p.source_id.slice(0, 12)}…</>}
                    {p.similarity_score !== undefined && <> · {Math.round(p.similarity_score * 100)}% similar</>}
                  </div>
                </div>
              ))}
              {results.length > 20 && (
                <p style={{fontSize: 12, color: "var(--dash-text-muted)", marginTop: 8}}>
                  Showing first 20 of {results.length}.
                </p>
              )}
            </div>
          </>
        )}

        {recommend([
          propagated === 0
            ? "Nothing propagated. Either you have no labeled rows yet (run AI Predict first), or the threshold is too strict — try the Aggressive preset."
            : coverage < 30
              ? `Only ${coverage}% coverage. Try a more aggressive preset, or run AI Predict on more rows first to give propagation more anchors to learn from.`
              : coverage > 80
                ? "Strong coverage. Spot-check 10-20 propagated rows manually before treating the labels as final."
                : `${coverage}% coverage is a healthy result. Run Aggregation next to combine these with your rule-based and AI labels.`,
          skipped > propagated
            ? `More rows were skipped (${skipped}) than propagated (${propagated}). Your labeled examples may be too sparse or the neighbors disagree — consider labeling more seed rows.`
            : "Skipped rows had no clear winner among their neighbors. That's the engine being careful, not a bug.",
          `Confidence threshold was ${threshold.toFixed(2)}. Raise it to be stricter (fewer but more reliable labels), lower it for more coverage.`,
        ])}

        {jsonBlock(raw)}
      </div>
    );
  };

  // ── Aggregation result renderer ──────────────────────────────────────
  const renderAggregationResult = (raw: unknown) => {
    const r = (raw as Record<string, unknown>)?.result as Record<string, unknown> | undefined;
    const report = r?.aggregation || r || {};
    const total = Number((report as Record<string, unknown>)?.total_items) || 0;
    const aggregated = Number((report as Record<string, unknown>)?.aggregated_count) || 0;
    const conflicts = Number((report as Record<string, unknown>)?.conflict_count) || 0;
    const dist = ((report as Record<string, unknown>)?.label_distribution || {}) as Record<string, number>;
    const sourceBreakdown = ((report as Record<string, unknown>)?.source_breakdown || {}) as Record<string, number>;
    const finalLabels = Array.isArray((report as Record<string, unknown>)?.final_labels)
      ? ((report as Record<string, unknown>).final_labels as Array<Record<string, unknown>>) : [];
    const agreement = total > 0 ? Math.round(((aggregated - conflicts) / total) * 100) : 0;

    return (
      <div>
        {summaryRow([
          { value: aggregated.toLocaleString(), label: "Rows with final label", tone: "ok" },
          { value: conflicts.toLocaleString(), label: "Conflicts resolved", tone: conflicts > total * 0.2 ? "warn" : "neutral" as never },
          { value: `${agreement}%`, label: "Source agreement" },
        ])}

        {Object.keys(sourceBreakdown).length > 0 && (
          <>
            <h4 style={{margin: "16px 0 8px", fontSize: 14}}>Where each label came from</h4>
            <div className="ail-dist">
              {Object.entries(sourceBreakdown).sort((a,b)=>b[1]-a[1]).map(([src, count]) => (
                <div key={src} className="ail-dist__row">
                  <span className="ail-dist__name" style={{textTransform: "capitalize"}}>{src}</span>
                  <span className="ail-dist__track">
                    <span className="ail-dist__fill" style={{width: `${(count / aggregated) * 100}%`}}/>
                  </span>
                  <span className="ail-dist__count">{count}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {Object.keys(dist).length > 0 && (
          <>
            <h4 style={{margin: "16px 0 8px", fontSize: 14}}>Final label distribution</h4>
            <div className="ail-dist">
              {Object.entries(dist).sort((a,b)=>b[1]-a[1]).map(([name, count]) => (
                <div key={name} className="ail-dist__row">
                  <span className="ail-dist__name">{name}</span>
                  <span className="ail-dist__track">
                    <span className="ail-dist__fill" style={{width: `${(count / aggregated) * 100}%`}}/>
                  </span>
                  <span className="ail-dist__count">{count}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {finalLabels.length > 0 && (
          <>
            <h4 style={{margin: "16px 0 8px", fontSize: 14}}>Sample aggregated labels</h4>
            <div>
              {finalLabels.slice(0, 15).map((f, i) => (
                <div key={i} className="ail-pred">
                  <div className="ail-pred__top">
                    <span className="ail-pred__label">{String(f.final_label || "—")}</span>
                    <span className="ail-confbar">
                      <span className="ail-confbar__fill"
                        style={{width: `${Math.round(Number(f.confidence ?? 0) * 100)}%`,
                                background: confColor(Number(f.confidence ?? 0))}}/>
                    </span>
                    <span className="ail-pred__conf">{Math.round(Number(f.confidence ?? 0) * 100)}%</span>
                  </div>
                  <div className="ail-pred__text" style={{fontSize: 11.5}}>
                    Sources: {Array.isArray(f.sources) ? (f.sources as string[]).join(", ") : "—"}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {recommend([
          aggregated === 0
            ? "No rows had any labels to aggregate. Run AI Predict, rule-based labeling, or propagation first."
            : conflicts > 0 && conflicts > aggregated * 0.2
              ? `${conflicts} conflicts (${Math.round(conflicts/aggregated*100)}%) is high. Different sources disagree often — review the conflict-heavy labels manually.`
              : "Most sources agreed. The aggregated labels are ready for review/export.",
          agreement >= 80
            ? `High agreement (${agreement}%) means your labeling pipeline is consistent — good signal that the labels are correct.`
            : `Agreement of ${agreement}% suggests your different labeling sources are pulling in different directions. Consider tightening rules or adjusting the AI prompt.`,
          "Go to the Review & Export tab to inspect the final labels row-by-row and export the labeled dataset.",
        ])}

        {jsonBlock(raw)}
      </div>
    );
  };

  // ── Synthetic generation result renderer ────────────────────────────
  const renderSyntheticResult = (raw: unknown) => {
    const r = raw as Record<string, unknown>;
    const samples: string[] = Array.isArray(r?.samples) ? (r.samples as string[])
                            : Array.isArray(r?.generated_texts) ? (r.generated_texts as string[])
                            : Array.isArray(r?.data) ? (r.data as string[]) : [];
    const label = String(r?.label ?? syntheticLabel);

    if (samples.length === 0) {
      return <div className="empty-state"><h3>No samples returned</h3><p>The LLM didn't produce any usable text. Try a different model or shorter count.</p></div>;
    }

    const copy = (text: string) => {
      navigator.clipboard?.writeText(text).catch(() => {});
    };
    const copyAll = () => {
      navigator.clipboard?.writeText(samples.map((s) => `${s}\t${label}`).join("\n")).catch(() => {});
    };

    return (
      <div>
        {summaryRow([
          { value: samples.length, label: "Samples generated", tone: "ok" },
          { value: label, label: "Target label" },
          { value: Math.round(samples.reduce((a, s) => a + s.length, 0) / samples.length), label: "Avg length (chars)" },
        ])}

        <div style={{display: "flex", justifyContent: "flex-end", marginTop: 14}}>
          <button className="btn btn--sm btn--secondary" onClick={copyAll}>Copy all (TSV)</button>
        </div>

        <h4 style={{margin: "12px 0 8px", fontSize: 14}}>Generated samples</h4>
        <div>
          {samples.map((s, i) => (
            <div key={i} className="ail-pred">
              <div className="ail-pred__top">
                <span className="ail-pred__label">{label}</span>
                <button className="btn btn--sm btn--secondary" style={{marginLeft: "auto"}} onClick={() => copy(s)}>
                  Copy
                </button>
              </div>
              <div className="ail-pred__text">{s}</div>
            </div>
          ))}
        </div>

        {recommend([
          "Save these to a CSV with a label column and upload as a new dataset to use as training data.",
          "Best used to balance under-represented labels — synthetic examples for rare classes often improve model accuracy more than for already-common ones.",
          "Review samples for repetition and unrealistic phrasing before adding them to your training set. LLMs sometimes generate variations that are too similar.",
        ])}

        {jsonBlock(raw)}
      </div>
    );
  };

  // ── Active learning result renderer ──────────────────────────────────
  const renderActiveResult = (raw: unknown) => {
    const r = raw as Record<string, unknown>;
    const candidates: Array<Record<string, unknown>> = Array.isArray(r?.candidates)
      ? (r.candidates as Array<Record<string, unknown>>)
      : Array.isArray(r?.items) ? (r.items as Array<Record<string, unknown>>) : [];

    if (candidates.length === 0) {
      return <div className="empty-state"><h3>No uncertain rows found</h3><p>Either every row was confidently labeled, or there's nothing to evaluate. Run AI Predict first.</p></div>;
    }

    const avgConf = candidates.reduce((a, c) => a + Number(c.confidence ?? c.uncertainty ?? 0), 0) / candidates.length;

    return (
      <div>
        {summaryRow([
          { value: candidates.length, label: "Uncertain rows surfaced", tone: "warn" },
          { value: `${Math.round(avgConf * 100)}%`, label: "Avg confidence on these rows" },
          { value: "→ Review", label: "Recommended next step", tone: "ok" },
        ])}

        <h4 style={{margin: "16px 0 8px", fontSize: 14}}>Rows the model is least confident about</h4>
        <p style={{fontSize: 12.5, color: "var(--dash-text-muted)", marginBottom: 10}}>
          Labeling these manually has the highest impact on model accuracy — they're the ones the AI is most likely to get wrong.
        </p>
        <div>
          {candidates.slice(0, 25).map((c, i) => {
            const conf = Number(c.confidence ?? c.uncertainty ?? 0);
            const text = String(c.text ?? c.content ?? c.item_id ?? "—");
            const predicted = String(c.predicted_label ?? c.label ?? "—");
            return (
              <div key={i} className="ail-pred">
                <div className="ail-pred__top">
                  <span className={`ail-pred__label ${!c.predicted_label ? "ail-pred__label--empty" : ""}`}>
                    {predicted}
                  </span>
                  <span className="ail-confbar">
                    <span className="ail-confbar__fill"
                      style={{width: `${Math.round(conf * 100)}%`, background: confColor(conf)}}/>
                  </span>
                  <span className="ail-pred__conf">{Math.round(conf * 100)}%</span>
                </div>
                <div className="ail-pred__text">{text}</div>
              </div>
            );
          })}
          {candidates.length > 25 && (
            <p style={{fontSize: 12, color: "var(--dash-text-muted)", marginTop: 8}}>
              Showing first 25 of {candidates.length}.
            </p>
          )}
        </div>

        {recommend([
          "Go to the Review & Export tab to label these rows manually — they're the highest-leverage rows in your dataset.",
          "After labeling, re-run AI Predict with these as few-shot examples to teach the model your edge cases.",
          candidates.length < 10
            ? "Only a few uncertain rows means the model is confident overall — your label set is probably tight."
            : `${candidates.length} uncertain rows suggests the model is struggling with some ambiguity. Consider refining your label definitions or adding examples.`,
        ])}

        {jsonBlock(raw)}
      </div>
    );
  };

  // ── LLM provider / model picker (shared) ──
  const providerPicker = (
    <div className="form-row">
      <div className="input-group">
        <label>LLM Provider</label>
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="">My default provider</option>
          {providers.map((p) => <option key={p.name} value={p.name}>{p.display_name}</option>)}
        </select>
      </div>
      <div className="input-group">
        <label>Model</label>
        {provider && models.length > 0 ? (
          <select value={modelName} onChange={(e) => setModelName(e.target.value)}>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <input value={modelName} onChange={(e) => setModelName(e.target.value)}
            placeholder={provider ? "model name" : "default model"} />
        )}
      </div>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <h1>AI-Powered Labeling</h1>
        <p>Use an LLM to classify each row of your text data into your labels</p>
      </div>

      {VISIBLE_TABS.length > 1 && (
        <div className="tabs">
          {VISIBLE_TABS.map((t) => (
            <button key={t} className={`tab ${tab === t ? "tab--active" : ""}`} onClick={() => setTab(t)}>
              {TAB_META[t].label}
            </button>
          ))}
        </div>
      )}
      <p className="ail-tab-desc">{TAB_META[tab].desc}</p>

      <div className="two-col">
        {/* ───────────── Config ───────────── */}
        <div className="card">
          <div className="card-header"><h3>Configuration</h3></div>

          {tab !== "synthetic" && (
            <div className="input-group">
              <label>Dataset</label>
              <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
                <option value="">Select a dataset</option>
                {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}

          {/* ── Predict ── */}
          {tab === "predict" && (
            <>
              <div className="input-group">
                <label>Text Column</label>
                {columns.length > 0 ? (
                  <select value={textColumn} onChange={(e) => setTextColumn(e.target.value)}>
                    {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : (
                  <input value={textColumn} onChange={(e) => setTextColumn(e.target.value)}
                    placeholder={datasetId ? "text" : "select a dataset first"} />
                )}
              </div>

              <div className="input-group">
                <label>Labels</label>
                <input value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addLabel(labelDraft); } }}
                  onBlur={() => labelDraft.trim() && addLabel(labelDraft)}
                  placeholder="Type a label and press Enter" />
                <div className="ail-chips">
                  {labels.map((l) => (
                    <span key={l} className="ail-chip">{l}
                      <button type="button" onClick={() => removeLabel(l)} aria-label={`Remove ${l}`}>&times;</button>
                    </span>
                  ))}
                </div>
              </div>

              {providerPicker}
              {modelWarning && (
                <p style={{ fontSize: 12, color: "var(--dash-warning)", marginTop: -8, marginBottom: 12 }}>
                  {modelWarning}
                </p>
              )}

              <div className="ail-section">
                <div className="ail-section__head">
                  <span className="ail-section__title">Custom instructions</span>
                </div>
                <p className="ail-section__hint">
                  Optional — explain in plain English how the model should decide the label.
                </p>
                <textarea
                  className="ail-textarea"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={5}
                  placeholder="e.g. Label as urgent only if the message asks for an immediate response. Treat questions about pricing as 'sales'."
                />
              </div>

              <div className="ail-section">
                <div className="ail-section__head">
                  <span className="ail-section__title">Few-shot examples</span>
                  <button className="btn btn--sm btn--secondary" onClick={addExample}>+ Add example</button>
                </div>
                <p className="ail-section__hint">Show the model a few text → label pairs to boost accuracy.</p>
                <div className="ail-examples">
                  {examples.length === 0 && <span className="ail-example-empty">No examples yet — optional but recommended.</span>}
                  {examples.map((ex, i) => (
                    <div key={i} className="ail-example-row">
                      <input value={ex.text} onChange={(e) => updateExample(i, "text", e.target.value)} placeholder="example text" />
                      <input value={ex.label} onChange={(e) => updateExample(i, "label", e.target.value)} placeholder="label" />
                      <button className="btn btn--sm btn--danger" onClick={() => removeExample(i)}>&times;</button>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn btn--secondary" onClick={runPreview}
                  disabled={!datasetId || labels.length === 0 || previewing}>
                  {previewing ? "Testing..." : "Preview on 5 rows"}
                </button>
                <button className="btn btn--primary" onClick={runPredict}
                  disabled={!datasetId || labels.length === 0 || running}>
                  {running ? "Running..." : "Run Full Prediction"}
                </button>
              </div>
            </>
          )}

          {/* ── Propagate ── */}
          {tab === "propagate" && (
            <>
              {/* Plain-English explainer — propagation is the most opaque tab. */}
              <div className="ail-explainer">
                <div className="ail-explainer__title">How propagation works</div>
                <ol className="ail-explainer__steps">
                  <li>Looks at every row that already has a confident label (from rule-based or AI prediction).</li>
                  <li>For each <em>unlabeled</em> row, finds the most similar labeled rows using vector embeddings.</li>
                  <li>If those neighbors agree on a label and the similarity is high enough, copies that label across.</li>
                </ol>
                <div className="ail-explainer__note">
                  <strong>When to use it:</strong> you've already labeled ~50-500 rows (manually, with rules, or AI Predict) and want to expand coverage to the rest without paying for more LLM calls.
                </div>
                <div className="ail-explainer__note ail-explainer__note--warn">
                  <strong>Prerequisite:</strong> run <strong>EDA with embeddings enabled</strong> on this dataset first — without embeddings there's nothing to compare similarity against, and you'll see "No embeddings found" below.
                </div>
              </div>

              {/* Which labels are allowed to be propagated — usually the same
                  set as your AI Predict labels. */}
              <div className="input-group">
                <label>Allowed labels</label>
                <input value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addLabel(labelDraft); } }}
                  onBlur={() => labelDraft.trim() && addLabel(labelDraft)}
                  placeholder="Type a label and press Enter" />
                <div className="ail-chips">
                  {labels.map((l) => (
                    <span key={l} className="ail-chip">{l}
                      <button type="button" onClick={() => removeLabel(l)}>&times;</button>
                    </span>
                  ))}
                </div>
                <p className="struct-hint">
                  Only labels in this list will be assigned. Usually mirrors the labels you used in AI Predict.
                </p>
              </div>

              {/* Presets row — most users shouldn't think about threshold/top-K at all. */}
              <div className="input-group">
                <label>Aggressiveness</label>
                <div className="ail-presets">
                  {([
                    { id: "cons",  label: "Conservative", sub: "high confidence", t: 0.85, k: 3,
                      hint: "Fewer rows get labeled but labels are very likely correct." },
                    { id: "bal",   label: "Balanced",     sub: "default",          t: 0.70, k: 5,
                      hint: "Recommended starting point. Good coverage with reasonable accuracy." },
                    { id: "aggr",  label: "Aggressive",   sub: "max coverage",     t: 0.55, k: 7,
                      hint: "More rows labeled but expect some incorrect propagations." },
                  ] as const).map((p) => {
                    const active = Math.abs(confThreshold - p.t) < 0.01 && topK === p.k;
                    return (
                      <button key={p.id} type="button"
                        className={`ail-preset ${active ? "ail-preset--active" : ""}`}
                        onClick={() => { setConfThreshold(p.t); setTopK(p.k); }}
                        title={p.hint}>
                        <span className="ail-preset__label">{p.label}</span>
                        <span className="ail-preset__sub">{p.sub}</span>
                        <span className="ail-preset__detail">threshold {p.t}, neighbors {p.k}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Advanced sliders — hidden behind a details for users who want them. */}
              <details className="ail-advanced">
                <summary>Advanced — manual threshold / neighbors</summary>
                <div className="form-row">
                  <div className="input-group">
                    <label>Confidence threshold ({confThreshold})</label>
                    <input type="range" step="0.05" min="0.3" max="0.95" value={confThreshold}
                      onChange={(e) => setConfThreshold(+e.target.value)} />
                    <p className="struct-hint">Higher = stricter, fewer labels propagated but more reliable.</p>
                  </div>
                  <div className="input-group">
                    <label>Top K neighbors ({topK})</label>
                    <input type="range" min={1} max={20} value={topK}
                      onChange={(e) => setTopK(+e.target.value)} />
                    <p className="struct-hint">How many similar rows to consider when voting on a label.</p>
                  </div>
                </div>
              </details>

              <button className="btn btn--primary" onClick={runPropagate} disabled={!datasetId || running}>
                {running ? "Running..." : "Run Propagation"}
              </button>
            </>
          )}

          {/* ── Aggregate ── */}
          {tab === "aggregate" && (
            <>
              <div className="ail-explainer">
                <div className="ail-explainer__title">How aggregation works</div>
                <ol className="ail-explainer__steps">
                  <li>Looks at every row and gathers all labels assigned to it — from rules, AI Predict, and Propagation.</li>
                  <li>If the sources agree, that label wins outright.</li>
                  <li>If they disagree, the strategy you pick below decides who wins.</li>
                </ol>
                <div className="ail-explainer__note">
                  <strong>When to use it:</strong> after you've run two or more of: Rule-based Labeling, AI Predict, Propagation. This collapses them into one final label per row, ready for export.
                </div>
                <div className="ail-explainer__note ail-explainer__note--warn">
                  <strong>Prerequisite:</strong> at least one source (rule / AI / propagated) must have produced labels for this dataset, or you'll see "0 rows aggregated".
                </div>
              </div>

              <div className="input-group">
                <label>How to resolve conflicts</label>
                <div className="ail-presets" style={{gridTemplateColumns: "repeat(2, 1fr)"}}>
                  {([
                    { id: "conf", label: "Confidence weighted", sub: "recommended",
                      val: "confidence_weighted",
                      hint: "Each source contributes its label weighted by its confidence score. Best when your sources report meaningful confidence." },
                    { id: "vote", label: "Majority vote", sub: "simple",
                      val: "majority_vote",
                      hint: "Whichever label is assigned by the most sources wins. Best when all sources are roughly equally trustworthy." },
                  ] as const).map((p) => (
                    <button key={p.id} type="button"
                      className={`ail-preset ${aggStrategy === p.val ? "ail-preset--active" : ""}`}
                      onClick={() => setAggStrategy(p.val)}
                      title={p.hint}>
                      <span className="ail-preset__label">{p.label}</span>
                      <span className="ail-preset__sub">{p.sub}</span>
                      <span className="ail-preset__detail">{p.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="input-group">
                <label>Which sources to include</label>
                <p className="struct-hint" style={{marginTop: 0, marginBottom: 8}}>
                  Uncheck a source to exclude it from voting. Useful for debugging which source disagrees, or for skipping a noisy one.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {([
                    ["Rule labels", "From the Labeling tab — keyword/regex rules you wrote", includeRule, setIncludeRule],
                    ["AI labels", "From the AI Predict tab — LLM classifications", includeAI, setIncludeAI],
                    ["Propagated labels", "From the Propagation tab — spread via embedding similarity", includeProp, setIncludeProp],
                  ] as const).map(([lbl, sub, val, set]) => (
                    <label key={lbl} className="ail-source-toggle">
                      <input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)} />
                      <div>
                        <div className="ail-source-toggle__name">{lbl}</div>
                        <div className="ail-source-toggle__sub">{sub}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <button className="btn btn--primary" onClick={runAggregate} disabled={!datasetId || running}>
                {running ? "Running..." : "Run Aggregation"}
              </button>
            </>
          )}

          {/* ── Synthetic ── */}
          {tab === "synthetic" && (
            <>
              <div className="ail-explainer">
                <div className="ail-explainer__title">How synthetic data generation works</div>
                <ol className="ail-explainer__steps">
                  <li>Asks an LLM to invent realistic example texts for a label you specify.</li>
                  <li>Returns them as a list you can copy into a new dataset or use as few-shot examples in AI Predict.</li>
                </ol>
                <div className="ail-explainer__note">
                  <strong>When to use it:</strong> one of your labels has very few real examples (under-represented class). Training on a balanced set — including some synthetic data — usually beats training on a heavily skewed real set.
                </div>
                <div className="ail-explainer__note ail-explainer__note--warn">
                  <strong>Heads up:</strong> synthetic examples are LLM-generated, not real user data. Always spot-check for repetition and unrealistic phrasing before adding them to your training set.
                </div>
              </div>

              <div className="input-group">
                <label>Label to generate for</label>
                <input value={syntheticLabel} onChange={(e) => setSyntheticLabel(e.target.value)}
                  placeholder="e.g. complaint" />
                <p className="struct-hint">
                  The name of the label you want more examples of. The LLM will invent texts that match this category.
                </p>
              </div>

              <div className="input-group">
                <label>How many samples</label>
                <div className="ail-presets" style={{gridTemplateColumns: "repeat(4, 1fr)"}}>
                  {[5, 20, 50, 100].map((n) => (
                    <button key={n} type="button"
                      className={`ail-preset ${syntheticCount === n ? "ail-preset--active" : ""}`}
                      onClick={() => setSyntheticCount(n)}>
                      <span className="ail-preset__label">{n}</span>
                      <span className="ail-preset__sub">
                        {n === 5 ? "quick test" : n === 20 ? "balanced" : n === 50 ? "training" : "bulk"}
                      </span>
                    </button>
                  ))}
                </div>
                <details className="ail-advanced" style={{marginTop: 10}}>
                  <summary>Advanced — custom count</summary>
                  <input type="number" min={1} max={500} value={syntheticCount}
                    onChange={(e) => setSyntheticCount(+e.target.value)}
                    style={{marginTop: 8}} />
                  <p className="struct-hint">Up to 500. Each sample costs one LLM call — bulk generation can be slow.</p>
                </details>
              </div>

              {providerPicker}

              <button className="btn btn--primary" onClick={runSynthetic} disabled={!syntheticLabel.trim()}>
                {syntheticResults === "loading"
                  ? `Generating ${syntheticCount} samples...`
                  : `Generate ${syntheticCount} sample${syntheticCount === 1 ? "" : "s"}`}
              </button>
            </>
          )}

          {/* ── Active Learning ── */}
          {tab === "active" && (
            <>
              <div className="ail-explainer">
                <div className="ail-explainer__title">How active learning works</div>
                <ol className="ail-explainer__steps">
                  <li>Looks at the rows your most recent AI Predict run already labeled.</li>
                  <li>Surfaces the ones the model was <em>least</em> confident about — its borderline calls.</li>
                  <li>Those rows are where manual labeling gives the biggest accuracy boost per minute spent.</li>
                </ol>
                <div className="ail-explainer__note">
                  <strong>When to use it:</strong> after running AI Predict, before going to Review &amp; Export. Manually labeling these few uncertain rows is much more impactful than labeling random ones.
                </div>
                <div className="ail-explainer__note ail-explainer__note--warn">
                  <strong>Prerequisite:</strong> AI Predict must have completed on this dataset. Otherwise there are no confidence scores to sort on.
                </div>
              </div>

              <div className="input-group">
                <label>How many candidates to surface</label>
                <div className="ail-presets" style={{gridTemplateColumns: "repeat(4, 1fr)"}}>
                  {[10, 25, 50, 100].map((n) => (
                    <button key={n} type="button"
                      className={`ail-preset ${activeTopN === n ? "ail-preset--active" : ""}`}
                      onClick={() => setActiveTopN(n)}>
                      <span className="ail-preset__label">{n}</span>
                      <span className="ail-preset__sub">
                        {n === 10 ? "quick win" : n === 25 ? "balanced" : n === 50 ? "thorough" : "deep dive"}
                      </span>
                    </button>
                  ))}
                </div>
                <details className="ail-advanced" style={{marginTop: 10}}>
                  <summary>Advanced — custom count</summary>
                  <input type="number" min={1} max={500} value={activeTopN}
                    onChange={(e) => setActiveTopN(+e.target.value)}
                    style={{marginTop: 8}} />
                  <p className="struct-hint">
                    Labeling more than ~50 manually starts to lose the focus benefit — at that point random sampling works almost as well.
                  </p>
                </details>
              </div>

              <button className="btn btn--primary" onClick={runActiveLearning} disabled={!datasetId}>
                {activeResults === "loading"
                  ? "Finding uncertain rows..."
                  : `Find ${activeTopN} candidate${activeTopN === 1 ? "" : "s"}`}
              </button>
            </>
          )}

          <TaskMonitor rate={rate} task={task} steps={steps} stuck={stuck} progressPct={progressPct} running={running} />
        </div>

        {/* ───────────── Results ───────────── */}
        <div className="card">
          <div className="card-header"><h3>Results</h3></div>

          {tab === "predict" ? (
            previewing ? (
              <div className="empty-state"><h3>Testing on a few rows...</h3></div>
            ) : preview ? (
              <div>
                <div className="ail-preview-note">
                  Preview only — {preview.length} sample row{preview.length === 1 ? "" : "s"}.
                  Run the full prediction when the labels look right.
                </div>
                {renderPredList(preview)}
              </div>
            ) : fullPreds.length > 0 ? (
              <div>
                <div className="ail-summary">
                  <div className="ail-summary__card">
                    <div className="ail-summary__value">{fullPreds.length}</div>
                    <div className="ail-summary__label">Rows</div>
                  </div>
                  <div className="ail-summary__card">
                    <div className="ail-summary__value">{fullPreds.filter((p) => p.label).length}</div>
                    <div className="ail-summary__label">Labeled</div>
                  </div>
                  <div className="ail-summary__card">
                    <div className="ail-summary__value">
                      {Math.round((fullPreds.reduce((s, p) => s + p.confidence, 0) / Math.max(fullPreds.length, 1)) * 100)}%
                    </div>
                    <div className="ail-summary__label">Avg Confidence</div>
                  </div>
                </div>
                {renderDistribution(fullPreds)}
                {renderPredList(fullPreds)}
              </div>
            ) : (
              <div className="empty-state">
                <h3>No predictions yet</h3>
                <p>Configure your labels and run a preview or full prediction.</p>
              </div>
            )
          ) : tab === "synthetic" ? (
            syntheticResults === "loading" ? <div className="empty-state"><h3>Generating samples...</h3></div>
              : syntheticResults ? renderSyntheticResult(syntheticResults)
              : <div className="empty-state"><h3>No samples yet</h3><p>Set a target label, choose how many samples, and hit Generate.</p></div>
          ) : tab === "active" ? (
            activeResults === "loading" ? <div className="empty-state"><h3>Finding uncertain rows...</h3></div>
              : activeResults ? renderActiveResult(activeResults)
              : <div className="empty-state"><h3>No candidates yet</h3><p>Click Find Candidates after running AI Predict on this dataset.</p></div>
          ) : tab === "propagate" ? (
            results ? renderPropagationResult(results)
              : <div className="empty-state"><h3>No propagation results yet</h3><p>Add labels, pick an aggressiveness preset, and click Run Propagation.</p></div>
          ) : tab === "aggregate" ? (
            results ? renderAggregationResult(results)
              : <div className="empty-state"><h3>No aggregation yet</h3><p>Pick which label sources to combine and click Run Aggregation.</p></div>
          ) : (
            results ? jsonBlock(results) : <div className="empty-state"><h3>No results yet</h3></div>
          )}
        </div>
      </div>
    </div>
  );
}
