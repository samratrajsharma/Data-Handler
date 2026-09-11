import type { TaskStep } from "../../hooks/usePolling";
import { formatRate } from "../../hooks/usePolling";
import "./TaskMonitor.css";

interface TaskLike {
  status?: string;
  progress_message?: string;
  error?: string;
}

interface Props {
  task: TaskLike | null;
  steps: TaskStep[];
  stuck: boolean;
  progressPct: number;
  running: boolean;
  /** Transfer speed in bytes/sec, derived from the progress message. 0 when
   *  the current step isn't a download (most tasks aren't). */
  rate?: number;
}

function timeAgo(at: number): string {
  const s = Math.round((Date.now() - at) / 1000);
  return s < 1 ? "now" : `${s}s ago`;
}

/**
 * Live progress for a background task: a progress bar, a stream of the
 * steps happening in the worker, and a clear warning if the task is stuck
 * in the queue (no worker has picked it up).
 */
export default function TaskMonitor({ task, steps, stuck, progressPct, running, rate = 0 }: Props) {
  const failed = task?.status === "failed";
  if (!running && !failed) return null;

  const speed = formatRate(rate);

  return (
    <div className="tm">
      {failed ? (
        <div className="tm-error">
          <strong>Task failed.</strong>{" "}
          {task?.error || "An unexpected error occurred while processing."}
        </div>
      ) : stuck ? (
        <div className="tm-warn">
          <span className="tm-warn__title">Waiting for a worker…</span>
          <span className="tm-warn__body">
            This job has been queued for a while but the background worker
            hasn't started it. The worker may be down, or busy with an earlier
            job — check that the <code>datahandler-celery-worker</code> container
            is running (<code>docker compose ps</code>) and review its logs.
          </span>
        </div>
      ) : (
        <>
          <div className="tm-bar">
            <div className="tm-bar__fill" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="tm-bar__label">
            <span>
              {task?.progress_message ||
                (task?.status === "pending"
                  ? "Queued — waiting for a worker…"
                  : "Processing…")}
            </span>
            <span className="tm-meta">
              {/* Speed sits next to the percentage so a slow download reads as
                  "slow link" rather than "frozen app" — that ambiguity is the
                  whole reason a stalled pull felt like a hang. */}
              {speed && <span className="tm-rate">{speed}</span>}
              <span className="tm-pct">{progressPct}%</span>
            </span>
          </div>
        </>
      )}

      {steps.length > 0 && !failed && (
        <div className="tm-steps">
          <div className="tm-steps__title">Background steps</div>
          {steps.map((s, i) => {
            const active = i === steps.length - 1 && running && task?.status !== "completed";
            return (
              <div key={i} className={`tm-step ${active ? "tm-step--active" : ""}`}>
                <span className="tm-step__dot" />
                <span className="tm-step__msg">{s.message}</span>
                <span className="tm-step__time">{timeAgo(s.at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
