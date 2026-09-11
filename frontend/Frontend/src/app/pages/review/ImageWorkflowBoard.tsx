import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { annotationApi } from "../../../shared/api/annotations";
import type { AnnotateQueueItem, AnnotateSummary, ImageStatus } from "../../../shared/api/annotations";
import ExportModal from "../annotate/ExportModal";
import DatasetAnalytics from "./DatasetAnalytics";
import "./ImageWorkflowBoard.css";

/**
 * Review & Export for image datasets, as a workflow board.
 *
 * WHY THIS EXISTS
 * The Review & Export page was built for tabular data: quality scoring over
 * rule-engine output, row-level approve/reject by typing an item ID, and
 * CSV/JSON export. It explicitly filtered image datasets OUT of its own
 * dropdown, so in Image mode the page was an empty select — while the sidebar
 * numbered it as step 3 of the image workflow.
 *
 * Image review is not row review. It is "where is every image in the pipeline,
 * and what do I do about the pile that is stuck?". A board answers that at a
 * glance: one column per stage, counts, a sample of what is in there, and the
 * one action that moves it forward.
 *
 * Nothing here is new plumbing — it reads the same summary and queue endpoints
 * the annotation editor uses, and hands off to that editor for the actual work.
 */

interface Props {
  datasetId: string;
  datasetName: string;
}

type StageId = ImageStatus;

interface Stage {
  id: StageId;
  title: string;
  /** What this pile means, in the user's terms. */
  blurb: string;
  /** Shown when the column is empty — the absence usually means something. */
  emptyHint: string;
  accent: string;
}

/**
 * The pipeline, in order. Rejected sits at the end because it is a dead end,
 * not a step: images land there and stop, and it is kept visible only so they
 * are not silently lost.
 */
const STAGES: Stage[] = [
  {
    id: "unannotated",
    title: "Unannotated",
    blurb: "Uploaded, no labels yet",
    emptyHint: "Everything has been annotated.",
    accent: "#94a3b8",
  },
  {
    id: "annotated",
    title: "In review",
    blurb: "Labelled, waiting to be approved",
    emptyHint: "Nothing is waiting for review.",
    accent: "#f97316",
  },
  {
    id: "approved",
    title: "Dataset",
    blurb: "Approved — included in exports",
    emptyHint: "Approve reviewed images to build the dataset.",
    accent: "#22c55e",
  },
  {
    id: "rejected",
    title: "Rejected",
    blurb: "Excluded from exports",
    emptyHint: "Nothing rejected.",
    accent: "#ef4444",
  },
];

/** Thumbnails per column. Enough to recognise the pile, few enough to stay fast. */
const PREVIEW = 8;

export default function ImageWorkflowBoard({ datasetId, datasetName }: Props) {
  const [summary, setSummary] = useState<AnnotateSummary | null>(null);
  const [previews, setPreviews] = useState<Record<StageId, AnnotateQueueItem[]>>({
    unannotated: [], annotated: [], approved: [], rejected: [],
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const load = useCallback(() => {
    if (!datasetId) return;
    setLoading(true);
    // One summary for the counts, plus a small sample per column. The counts
    // come from the summary rather than the samples, so a column showing eight
    // thumbnails can still report 5,000 images.
    Promise.all([
      annotationApi.getSummary(datasetId),
      ...STAGES.map((s) =>
        annotationApi.getQueue(datasetId, { status: s.id, limit: PREVIEW }).catch(() => null)
      ),
    ])
      .then(([sum, ...queues]) => {
        setSummary(sum.data);
        const next = { unannotated: [], annotated: [], approved: [], rejected: [] } as Record<StageId, AnnotateQueueItem[]>;
        STAGES.forEach((s, i) => { next[s.id] = queues[i]?.data.items ?? []; });
        setPreviews(next);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [datasetId]);

  useEffect(() => { load(); }, [load]);

  const countOf = useCallback(
    (id: StageId): number => {
      if (!summary) return 0;
      return id === "unannotated" ? summary.unannotated
        : id === "annotated" ? summary.annotated
        : id === "approved" ? summary.approved
        : summary.rejected;
    },
    [summary]
  );

  const total = summary?.total ?? 0;

  /** Approve everything currently in review. */
  const approveReviewed = useCallback(async () => {
    const n = countOf("annotated");
    if (!n) return;
    if (!window.confirm(
      `Move ${n} reviewed image${n === 1 ? "" : "s"} into the dataset?\n\n` +
      "Unannotated images are not affected. This cannot be undone."
    )) return;
    setBusy(true);
    try {
      await annotationApi.bulkSetState(datasetId, { status: "approved", only_status: "annotated" });
      load();
    } catch {
      alert("Could not approve those images.");
    } finally {
      setBusy(false);
    }
  }, [datasetId, countOf, load]);

  /** Send everything rejected back for another pass. */
  const reopenRejected = useCallback(async () => {
    const n = countOf("rejected");
    if (!n) return;
    if (!window.confirm(`Send ${n} rejected image${n === 1 ? "" : "s"} back to review?`)) return;
    setBusy(true);
    try {
      await annotationApi.bulkSetState(datasetId, { status: "annotated", only_status: "rejected" });
      load();
    } catch {
      alert("Could not reopen those images.");
    } finally {
      setBusy(false);
    }
  }, [datasetId, countOf, load]);

  const stageAction = (stage: Stage, count: number) => {
    if (stage.id === "unannotated") {
      return count > 0 ? (
        <Link className="wb-card__action" to={`/annotate/${datasetId}`}>Start annotating →</Link>
      ) : null;
    }
    if (stage.id === "annotated") {
      return count > 0 ? (
        <button className="wb-card__action" onClick={() => void approveReviewed()} disabled={busy}>
          Approve all {count} →
        </button>
      ) : null;
    }
    if (stage.id === "approved") {
      return count > 0 ? (
        <button className="wb-card__action" onClick={() => setShowExport(true)} disabled={busy}>
          Export dataset →
        </button>
      ) : null;
    }
    return count > 0 ? (
      <button className="wb-card__action" onClick={() => void reopenRejected()} disabled={busy}>
        Send back to review
      </button>
    ) : null;
  };

  const splits = summary?.splits;
  const splitLine = useMemo(
    () =>
      splits
        ? `train ${splits.train} · valid ${splits.valid} · test ${splits.test} · unassigned ${splits.unassigned}`
        : "",
    [splits]
  );

  return (
    <div className="wb">
      <div className="wb__head">
        <div>
          <h2 className="wb__title">{datasetName}</h2>
          <p className="wb__sub">
            {loading ? "Loading…" : `${total} image${total === 1 ? "" : "s"} across the pipeline`}
            {splitLine && <span className="wb__splits"> · {splitLine}</span>}
          </p>
        </div>
        <div className="wb__headActions">
          <Link className="btn btn--sm btn--secondary" to={`/annotate/${datasetId}`}>Open editor</Link>
          <button
            className="btn btn--sm btn--primary"
            onClick={() => setShowExport(true)}
            disabled={!summary || countOf("approved") === 0}
            title={
              summary && countOf("approved") === 0
                ? "Approve some images first — exports only include approved ones"
                : "Export the approved images"
            }
          >
            Export
          </button>
        </div>
      </div>

      <div className="wb__board">
        {STAGES.map((stage) => {
          const count = countOf(stage.id);
          const items = previews[stage.id];
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <section key={stage.id} className="wb-col">
              <header className="wb-col__head">
                <span className="wb-col__dot" style={{ background: stage.accent }} />
                <h3 className="wb-col__title">{stage.title}</h3>
                <span className="wb-col__count">{count}</span>
              </header>
              <p className="wb-col__blurb">{stage.blurb}</p>

              {/* Share of the dataset. A bar makes "most of it is still
                  unannotated" readable without doing arithmetic. */}
              <div className="wb-col__bar" title={`${pct}% of the dataset`}>
                <span style={{ width: `${pct}%`, background: stage.accent }} />
              </div>

              {count === 0 ? (
                <div className="wb-col__empty">{stage.emptyHint}</div>
              ) : (
                <>
                  <div className="wb-col__grid">
                    {items.map((it) => (
                      <Link
                        key={it.asset_id}
                        className="wb-thumb"
                        to={`/annotate/${datasetId}?asset=${it.asset_id}`}
                        title={`${it.file_name} — open in the editor`}
                      >
                        {it.thumbnail_url ? (
                          <img src={it.thumbnail_url} alt={it.file_name} loading="lazy" decoding="async" />
                        ) : (
                          <span className="wb-thumb__ph">{it.file_name.charAt(0).toUpperCase()}</span>
                        )}
                      </Link>
                    ))}
                  </div>
                  {count > items.length && (
                    <div className="wb-col__more">+{count - items.length} more</div>
                  )}
                </>
              )}

              <div className="wb-col__foot">{stageAction(stage, count)}</div>
            </section>
          );
        })}
      </div>

      {/* Below the board, because "where is everything" is the question the
          page is opened with; "is the data any good" is the one asked next.
          Collapsed unless it found something worth saying. */}
      {total > 0 && <DatasetAnalytics datasetId={datasetId} />}

      {showExport && (
        <ExportModal
          datasetId={datasetId}
          summary={summary}
          onClose={() => setShowExport(false)}
          onSummaryChanged={load}
        />
      )}
    </div>
  );
}
