import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { datasetApi } from "../../../shared/api/datasets";
import { annotationApi } from "../../../shared/api/annotations";
import type { AnnotateSummary } from "../../../shared/api/annotations";
import "./Annotate.css";

interface DatasetRow {
  id: string;
  name: string;
  description?: string;
  source_type?: string;
}

const SUMMARY_POOL = 4;

/**
 * Annotation home — pick an image dataset to open in the editor. Each card
 * shows the annotation progress and the label classes defined so far.
 */
export default function Annotate() {
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [loading, setLoading] = useState(true);
  // undefined = still loading, null = failed to load
  const [summaries, setSummaries] = useState<Record<string, AnnotateSummary | null>>({});

  useEffect(() => {
    let cancelled = false;
    datasetApi
      .list({ limit: 200 })
      .then((r) => {
        const all: DatasetRow[] = Array.isArray(r.data) ? r.data : r.data.datasets || [];
        const imgs = all.filter((d) => d.source_type === "image");
        if (cancelled) return;
        setDatasets(imgs);
        setLoading(false);
        // Fetch per-dataset summaries through a small concurrency pool so a
        // long dataset list doesn't fire dozens of parallel requests.
        const pending = [...imgs];
        const worker = async () => {
          for (;;) {
            const d = pending.shift();
            if (!d || cancelled) return;
            try {
              const res = await annotationApi.getSummary(d.id);
              if (!cancelled) setSummaries((prev) => ({ ...prev, [d.id]: res.data }));
            } catch {
              if (!cancelled) setSummaries((prev) => ({ ...prev, [d.id]: null }));
            }
          }
        };
        for (let i = 0; i < SUMMARY_POOL; i++) void worker();
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Annotate</h1>
        <p>Draw bounding boxes and polygons, assign labels, and export training-ready datasets</p>
      </div>

      {loading ? (
        <div className="ann-pick-loading">
          <span className="ann-pick-spinner" />
          Loading image datasets…
        </div>
      ) : datasets.length === 0 ? (
        <div className="empty-state">
          <h3>No image datasets yet</h3>
          <p>Create an image dataset and upload your images first — then come back here to label them.</p>
          <Link to="/datasets" className="btn btn--primary" style={{ marginTop: 16, display: "inline-block" }}>
            Go to Datasets
          </Link>
        </div>
      ) : (
        <div className="ann-pick-grid">
          {datasets.map((d) => {
            const s = summaries[d.id];
            const total = s?.total ?? 0;
            const done = s ? total - s.unannotated : 0;
            const pct = s && total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <div key={d.id} className="card ann-pick-card">
                <div className="ann-pick-card__top">
                  <h3 className="ann-pick-card__name" title={d.name}>{d.name}</h3>
                  <span className="ann-pick-card__count">
                    {s === undefined ? "…" : s === null ? "—" : `${total} image${total === 1 ? "" : "s"}`}
                  </span>
                </div>

                {s === undefined ? (
                  <div className="ann-pick-card__loading">
                    <span className="ann-pick-spinner" /> Loading progress…
                  </div>
                ) : s === null ? (
                  <div className="ann-pick-card__loading">Progress unavailable</div>
                ) : (
                  <>
                    <div className="ann-pick-card__progress">
                      <div className="ann-pick-card__bar">
                        <div className="ann-pick-card__bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="ann-pick-card__pct">
                        {done}/{total} annotated · {pct}%
                      </span>
                    </div>
                    {s.class_counts.length > 0 ? (
                      <div className="chip-list ann-pick-card__chips">
                        {s.class_counts.slice(0, 6).map((c) => (
                          <span key={c.class_id} className="chip ann-pick-chip">
                            <span className="ann-pick-chip__dot" style={{ background: c.color }} />
                            {c.name}
                            <span className="ann-pick-chip__n">{c.count}</span>
                          </span>
                        ))}
                        {s.class_counts.length > 6 && (
                          <span className="chip ann-pick-chip">+{s.class_counts.length - 6} more</span>
                        )}
                      </div>
                    ) : (
                      <div className="ann-pick-card__nochips">No classes defined yet</div>
                    )}
                  </>
                )}

                <div className="ann-pick-card__foot">
                  <Link to={`/annotate/${d.id}`} className="btn btn--primary btn--sm">
                    Open annotator &rarr;
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
