import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { datasetApi } from "../../../shared/api/datasets";
import { textApi } from "../../../shared/api/text";
import type { TextSummary } from "../../../shared/api/text";
import "./TextLabeling.css";

interface DatasetRow {
  id: string;
  name: string;
  description?: string | null;
  source_type?: string;
}

// Per-dataset summary: undefined = still loading, null = failed to load.
type SummaryMap = Record<string, TextSummary | null | undefined>;

export default function TextLabeling() {
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [summaries, setSummaries] = useState<SummaryMap>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    datasetApi
      .list({ limit: 200 })
      .then(async (r) => {
        const all: DatasetRow[] = Array.isArray(r.data) ? r.data : r.data.datasets || [];
        const textSets = all.filter((d) => d.source_type === "text");
        if (cancelled) return;
        setDatasets(textSets);
        setLoading(false);
        // Fetch summaries with small concurrency (4 workers) so a large
        // dataset list does not fire dozens of parallel requests.
        const queue = [...textSets];
        const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
          for (;;) {
            const ds = queue.shift();
            if (!ds || cancelled) return;
            try {
              const res = await textApi.getSummary(ds.id);
              if (!cancelled) setSummaries((s) => ({ ...s, [ds.id]: res.data }));
            } catch {
              if (!cancelled) setSummaries((s) => ({ ...s, [ds.id]: null }));
            }
          }
        });
        await Promise.all(workers);
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
        <h1>Text Labeling</h1>
        <p>Label messy .txt documents — document classes and character-level spans</p>
      </div>

      {loading ? (
        <div className="empty-state">
          <h3>Loading datasets…</h3>
        </div>
      ) : datasets.length === 0 ? (
        <div className="empty-state">
          <h3>No text datasets yet</h3>
          <p>
            Create one in{" "}
            <Link to="/datasets" className="txl-link">
              Datasets
            </Link>{" "}
            and upload .txt files
          </p>
        </div>
      ) : (
        <div className="txl-grid">
          {datasets.map((ds) => {
            const sum = summaries[ds.id];
            const pct =
              sum && sum.total_documents > 0
                ? Math.round((sum.labeled / sum.total_documents) * 100)
                : 0;
            return (
              <div key={ds.id} className="txl-card">
                <div className="txl-card__head">
                  <h3 title={ds.name}>{ds.name}</h3>
                  <span className="badge badge--info">text</span>
                </div>
                {ds.description && <p className="txl-card__desc">{ds.description}</p>}

                {sum === undefined ? (
                  <div className="txl-card__loading">Loading summary…</div>
                ) : sum === null ? (
                  <div className="txl-card__loading">Summary unavailable</div>
                ) : (
                  <>
                    <div className="txl-card__stats">
                      <span>
                        <strong>{sum.total_documents}</strong> docs
                      </span>
                      <span>
                        <strong>{sum.labeled}</strong> labeled
                      </span>
                      <span>
                        <strong>{sum.total_spans}</strong> spans
                      </span>
                    </div>
                    <div className="txl-progress">
                      <div className="txl-progress__fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="txl-card__pct">{pct}% labeled</div>
                    {sum.class_counts.length > 0 && (
                      <div className="chip-list txl-card__chips">
                        {sum.class_counts.slice(0, 8).map((c) => (
                          <span key={c.class_id} className="chip txl-chip" title={c.name}>
                            <span className="txl-dot" style={{ background: c.color }} />
                            {c.name}
                            <span className="txl-chip__count">{c.count}</span>
                          </span>
                        ))}
                        {sum.class_counts.length > 8 && (
                          <span className="chip txl-chip">+{sum.class_counts.length - 8} more</span>
                        )}
                      </div>
                    )}
                  </>
                )}

                <Link to={`/text-labeling/${ds.id}`} className="btn btn--primary btn--sm txl-card__open">
                  Open labeler →
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
