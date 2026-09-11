import { useCallback, useEffect, useMemo, useState } from "react";
import { annotationApi } from "../../../shared/api/annotations";
import type { AnalyticsBucket, AnnotateAnalytics } from "../../../shared/api/annotations";
import "./DatasetAnalytics.css";

/**
 * Dataset health for an image dataset.
 *
 * WHY THE CHARTS ARE HAND-DRAWN SVG
 * The repo has no charting library and adding one (recharts, chart.js, d3)
 * costs 150–500 KB of bundle to draw four bar charts. Every chart here is a
 * bar chart or a stacked bar — shapes that are a handful of <rect>s. A library
 * would buy animation and tooltips we don't need and would have to be kept in
 * step with the app's CSS variables to theme correctly.
 *
 * WHY THE SERVER COMPUTES THE FINDINGS
 * A chart shows shape; it does not say which shape is a problem. "Is 40:1
 * class imbalance bad?" is a judgement with a threshold attached, and putting
 * that threshold in the browser means it has to be re-derived from raw counts
 * the server already aggregated. The endpoint returns the verdicts; this
 * component only renders them.
 */

interface Props {
  datasetId: string;
}

/** Bars normalise against the largest value, so the tallest is always full
 *  width. Comparing absolute counts across charts is not the point — the shape
 *  of the distribution is. */
function maxOf(buckets: AnalyticsBucket[]): number {
  return buckets.reduce((m, b) => Math.max(m, b.count), 0) || 1;
}

const SIZE_HINT: Record<string, string> = {
  tiny: "under 0.3% of the frame",
  small: "0.3–3%",
  medium: "3–15%",
  large: "over 15%",
};

const KIND_LABEL: Record<string, string> = {
  bbox: "Boxes",
  polygon: "Polygons",
  mask: "Masks",
  classification: "Whole-image labels",
};

const KIND_COLOR: Record<string, string> = {
  bbox: "#3b82f6",
  polygon: "#a855f7",
  mask: "#f97316",
  classification: "#14b8a6",
};

/** A labelled horizontal bar row. */
function Bar({
  label, count, max, color, hint,
}: {
  label: string; count: number; max: number; color: string; hint?: string;
}) {
  const pct = Math.max(count > 0 ? 1.5 : 0, (count / max) * 100);
  return (
    <div className="da-bar" title={hint ? `${label} — ${hint}` : label}>
      <span className="da-bar__label">{label}</span>
      <span className="da-bar__track">
        <span className="da-bar__fill" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="da-bar__count">{count.toLocaleString()}</span>
    </div>
  );
}

export default function DatasetAnalytics({ datasetId }: Props) {
  const [data, setData] = useState<AnnotateAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Collapsed unless something is actually wrong. A clean dataset should not
  // spend screen space proving it; a problem should not need a click to find.
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    if (!datasetId) return;
    setLoading(true);
    setFailed(false);
    annotationApi
      .getAnalytics(datasetId)
      .then((r) => {
        setData(r.data);
        setOpen(r.data.findings.some((f) => f.level === "warn"));
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [datasetId]);

  useEffect(() => { load(); }, [load]);

  const classMax = useMemo(
    () => (data ? data.classes.reduce((m, c) => Math.max(m, c.count), 0) || 1 : 1),
    [data]
  );

  // Split × status, pivoted into one stacked bar per split. The endpoint
  // returns flat "split/status" pairs because that is what one GROUP BY
  // produces; the shape a reader wants is one row per split.
  const splitRows = useMemo(() => {
    if (!data) return [];
    const bySplit = new Map<string, Record<string, number>>();
    for (const b of data.split_status) {
      const [split, status] = b.label.split("/");
      const row = bySplit.get(split) ?? {};
      row[status] = (row[status] ?? 0) + b.count;
      bySplit.set(split, row);
    }
    const order = ["train", "valid", "test", "unassigned"];
    return [...bySplit.entries()]
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([split, statuses]) => ({
        split,
        statuses,
        total: Object.values(statuses).reduce((s, n) => s + n, 0),
      }));
  }, [data]);

  const splitMax = useMemo(
    () => splitRows.reduce((m, r) => Math.max(m, r.total), 0) || 1,
    [splitRows]
  );

  if (loading && !data) {
    return <div className="da da--msg">Loading dataset health…</div>;
  }
  if (failed) {
    return (
      <div className="da da--msg">
        Could not load dataset health.{" "}
        <button className="da__retry" onClick={load}>Retry</button>
      </div>
    );
  }
  if (!data) return null;

  if (data.total_annotations === 0) {
    return (
      <div className="da da--msg">
        No annotations yet — health metrics appear once images are labelled.
      </div>
    );
  }

  const STATUS_COLOR: Record<string, string> = {
    approved: "#22c55e",
    annotated: "#f97316",
    unannotated: "#94a3b8",
    rejected: "#ef4444",
  };

  const warnCount = data.findings.filter((f) => f.level === "warn").length;

  return (
    <section className="da">
      <header className="da__head">
        <button
          type="button"
          className="da__toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className={`da__chev ${open ? "da__chev--open" : ""}`} aria-hidden="true">▸</span>
          Dataset health
          {warnCount > 0 && (
            <span className="da__badge">{warnCount} to look at</span>
          )}
        </button>
        <div className="da__stats">
          <span><b>{data.total_annotations.toLocaleString()}</b> annotations</span>
          <span><b>{data.labelled_images.toLocaleString()}</b> labelled images</span>
          <span><b>{data.avg_per_labelled_image}</b> avg per image</span>
        </div>
      </header>

      {open && data.findings.length > 0 && (
        <ul className="da__findings">
          {data.findings.map((f, i) => (
            <li key={i} className={`da__finding da__finding--${f.level}`}>
              {f.message}
            </li>
          ))}
        </ul>
      )}

      <div className="da__grid" hidden={!open}>
        <div className="da-card">
          <div className="da-card__title">Class balance</div>
          <div className="da-card__sub">
            Annotations per class. A long tail here is the most common reason a
            model does well on paper and badly on the rare classes.
          </div>
          <div className="da-card__body">
            {data.classes.map((c) => (
              <Bar
                key={c.class_id}
                label={c.name}
                count={c.count}
                max={classMax}
                color={c.color}
                hint={`in ${c.image_count} image${c.image_count === 1 ? "" : "s"}`}
              />
            ))}
          </div>
        </div>

        <div className="da-card">
          <div className="da-card__title">Labels per image</div>
          <div className="da-card__sub">
            How densely images are labelled. A spike at 1 in a crowded-scene
            dataset usually means annotators stopped early.
          </div>
          <div className="da-card__body">
            {data.per_image.map((b) => (
              <Bar
                key={b.label}
                label={b.label}
                count={b.count}
                max={maxOf(data.per_image)}
                color="var(--accent)"
              />
            ))}
            {data.empty_images > 0 && (
              <Bar
                label="0 (reviewed)"
                count={data.empty_images}
                max={maxOf(data.per_image)}
                color="#94a3b8"
                hint="opened and saved with nothing on them"
              />
            )}
          </div>
        </div>

        <div className="da-card">
          <div className="da-card__title">Object size</div>
          <div className="da-card__sub">
            Share of the frame each box covers. Bounding boxes only
            {data.unsized_annotations > 0 &&
              ` — ${data.unsized_annotations} polygon/mask annotation${
                data.unsized_annotations === 1 ? "" : "s"
              } not measured`}
            .
          </div>
          <div className="da-card__body">
            {data.sizes.length === 0 ? (
              <div className="da-card__empty">No bounding boxes in this dataset.</div>
            ) : (
              data.sizes.map((b) => (
                <Bar
                  key={b.label}
                  label={b.label}
                  count={b.count}
                  max={maxOf(data.sizes)}
                  color={b.label === "tiny" ? "#ef4444" : "var(--accent)"}
                  hint={SIZE_HINT[b.label]}
                />
              ))
            )}
          </div>
        </div>

        <div className="da-card">
          <div className="da-card__title">Annotation types</div>
          <div className="da-card__sub">
            What the dataset is made of. This decides which export formats keep
            your work intact.
          </div>
          <div className="da-card__body">
            {data.kinds.map((b) => (
              <Bar
                key={b.label}
                label={KIND_LABEL[b.label] ?? b.label}
                count={b.count}
                max={maxOf(data.kinds)}
                color={KIND_COLOR[b.label] ?? "var(--accent)"}
              />
            ))}
          </div>
        </div>

        {splitRows.length > 0 && (
          <div className="da-card da-card--wide">
            <div className="da-card__title">Split readiness</div>
            <div className="da-card__sub">
              Each split by review status. A split chart alone hides the case
              that matters: a healthy-looking train split that is mostly
              unapproved exports far smaller than its ratio promises.
            </div>
            <div className="da-card__body">
              {splitRows.map((row) => (
                <div className="da-bar" key={row.split} title={row.split}>
                  <span className="da-bar__label">{row.split}</span>
                  <span className="da-bar__track">
                    <span
                      className="da-bar__stack"
                      style={{ width: `${(row.total / splitMax) * 100}%` }}
                    >
                      {["approved", "annotated", "unannotated", "rejected"].map(
                        (status) =>
                          row.statuses[status] ? (
                            <span
                              key={status}
                              title={`${status}: ${row.statuses[status]}`}
                              style={{
                                width: `${(row.statuses[status] / row.total) * 100}%`,
                                background: STATUS_COLOR[status],
                              }}
                            />
                          ) : null
                      )}
                    </span>
                  </span>
                  <span className="da-bar__count">{row.total.toLocaleString()}</span>
                </div>
              ))}
              <div className="da__legend">
                {["approved", "annotated", "unannotated", "rejected"].map((s) => (
                  <span key={s}>
                    <i style={{ background: STATUS_COLOR[s] }} />
                    {s === "annotated" ? "in review" : s}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
