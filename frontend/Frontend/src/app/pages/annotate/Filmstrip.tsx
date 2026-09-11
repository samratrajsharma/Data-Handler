import { memo } from "react";
import type { UIEvent as RUIEvent } from "react";
import type { AnnotateQueueItem, ImageStatus } from "../../../shared/api/annotations";

/**
 * The thumbnail strip along the bottom, and its status filters.
 *
 * WHY THIS IS ITS OWN MEMOISED COMPONENT
 * The strip holds up to 100 thumbnails. Inlined in the editor it re-rendered
 * whenever the editor did — which is on every pointer move while drawing or
 * painting, and on every progress tick. Reconciling a hundred buttons at
 * pointer frequency is what made clicking a filter feel sticky: the click
 * landed, but the main thread was busy re-reconciling the strip it had just
 * been asked to replace.
 *
 * Split out and wrapped in memo, it now re-renders only when the queue, the
 * selection, the filter or the counts actually change. The parent's drawing
 * state no longer touches it at all.
 *
 * Every prop is either a primitive or a stable useCallback in the parent —
 * passing a fresh inline arrow would defeat memo entirely.
 */

export type QueueFilter = "all" | ImageStatus;

export interface FilterDef {
  id: QueueFilter;
  label: string;
  hint: string;
}

interface Props {
  filters: readonly FilterDef[];
  activeFilter: QueueFilter;
  counts: Partial<Record<QueueFilter, number | undefined>>;
  queue: AnnotateQueueItem[];
  queueTotal: number;
  currentAssetId: string | null;
  statusLabel: Record<string, string>;
  onChangeFilter: (f: QueueFilter) => void;
  onSelect: (assetId: string) => void;
  onScroll: (e: RUIEvent<HTMLDivElement>) => void;
  stripRef: React.RefObject<HTMLDivElement | null>;
}

function Filmstrip({
  filters,
  activeFilter,
  counts,
  queue,
  queueTotal,
  currentAssetId,
  statusLabel,
  onChangeFilter,
  onSelect,
  onScroll,
  stripRef,
}: Props) {
  return (
    <div className="ann-strip">
      <div className="ann-strip__filters">
        {filters.map((f) => {
          // Counts come from the dataset summary, so each shows its true size
          // rather than however much of the queue happens to be loaded.
          const count = counts[f.id];
          return (
            <button
              key={f.id}
              className={`ann-fchip ${activeFilter === f.id ? "ann-fchip--active" : ""}`}
              onClick={() => onChangeFilter(f.id)}
              title={f.hint}
            >
              {f.label}
              {typeof count === "number" && <b className="ann-fchip__n">{count}</b>}
            </button>
          );
        })}
        <span className="ann-strip__total">{queueTotal} shown</span>
      </div>

      <div className="ann-strip__scroll" ref={stripRef} onScroll={onScroll}>
        {queue.map((q) => (
          <button
            key={q.asset_id}
            data-asset={q.asset_id}
            className={`ann-thumb ann-thumb--${q.status} ${
              q.asset_id === currentAssetId ? "ann-thumb--current" : ""
            }`}
            title={`${q.file_name} — ${statusLabel[q.status]}${q.split ? ` (${q.split})` : ""}`}
            onClick={() => onSelect(q.asset_id)}
          >
            {q.thumbnail_url ? (
              // decoding="async" keeps thumbnail decode off the main thread —
              // a filter change swaps up to 100 images at once, and decoding
              // them synchronously stalls the very interaction that caused it.
              <img
                src={q.thumbnail_url}
                alt={q.file_name}
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            ) : (
              <span className="ann-thumb__ph">{q.file_name.charAt(0).toUpperCase()}</span>
            )}
            {q.annotation_count > 0 && (
              <span className="ann-thumb__count">{q.annotation_count}</span>
            )}
          </button>
        ))}
        {queue.length === 0 && (
          <div className="ann-strip__empty">No images match this filter.</div>
        )}
      </div>
    </div>
  );
}

export default memo(Filmstrip);
