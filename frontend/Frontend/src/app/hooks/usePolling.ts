import { useState, useEffect, useRef } from "react";
import { taskApi } from "../../shared/api/tasks";

interface TaskStatus {
  id: string;
  status: string;          // pending | progress | started | completed | failed
  progress: number;        // 0.0 .. 1.0
  progress_message?: string;
  result?: unknown;
  error?: string;
  created_at?: string;
}

export interface TaskStep {
  message: string;
  at: number;
}

/** How long a task may sit unstarted before we flag it as "stuck". */
const STUCK_AFTER_MS = 25_000;

/**
 * Collapse a progress message to the *phase* it represents by removing every
 * number from it.
 *
 *   "Downloading model… 12 / 609 MB (2%)"  ->  "Downloading model… / MB (%)"
 *   "Downloading model… 34 / 609 MB (6%)"  ->  "Downloading model… / MB (%)"
 *
 * Steps used to be appended whenever the message changed at all. A download
 * emits a new message every second, so the timeline grew one row per poll —
 * four rows in four seconds, hundreds by the end. Matching on the phase instead
 * lets a live counter update a single row in place, while a genuinely new phase
 * ("Loading model into memory…") still starts its own row.
 *
 * Batch messages ("Embedding batch 3 of 40") collapse the same way, which is
 * also what you want — one updating row, not forty.
 */
function phaseKey(msg: string): string {
  return msg.replace(/[\d.,]+/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Pull downloaded/total bytes out of a progress message, if it carries them.
 * The backend formats megabytes as decimal MB (bytes / 1_000_000), so we invert
 * with the same factor rather than 1024-based units.
 * Returns null when the message has no "x / y MB" pair.
 */
function parseBytes(msg: string): { done: number; total: number } | null {
  const m = msg.match(/([\d.]+)\s*\/\s*([\d.]+)\s*MB/i);
  if (!m) return null;
  const done = parseFloat(m[1]) * 1_000_000;
  const total = parseFloat(m[2]) * 1_000_000;
  if (!isFinite(done) || !isFinite(total)) return null;
  return { done, total };
}

/** Human-readable transfer rate, e.g. "11.4 MB/s" or "870 KB/s". */
export function formatRate(bytesPerSec: number): string {
  if (!isFinite(bytesPerSec) || bytesPerSec <= 0) return "";
  if (bytesPerSec >= 1_000_000) return `${(bytesPerSec / 1_000_000).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1_000) return `${Math.round(bytesPerSec / 1_000)} KB/s`;
  return `${Math.round(bytesPerSec)} B/s`;
}

export function useTaskPolling(taskId: string | null, interval = 2000) {
  const [task, setTask] = useState<TaskStatus | null>(null);
  const [polling, setPolling] = useState(false);
  const [steps, setSteps] = useState<TaskStep[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [rate, setRate] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(0);
  // Last byte sample, for deriving transfer speed between polls.
  const sampleRef = useRef<{ bytes: number; t: number } | null>(null);

  useEffect(() => {
    if (!taskId) {
      setTask(null);
      setSteps([]);
      setElapsed(0);
      return;
    }
    // Clear any task from a previous run so the consumer sees a real status
    // transition. Without this, two fast tasks that both end "completed" never
    // re-fire the completion handler (the bar would stick at 100%).
    setTask(null);
    setPolling(true);
    setSteps([]);
    setElapsed(0);
    setRate(0);
    sampleRef.current = null;
    startRef.current = Date.now();

    const poll = async () => {
      try {
        const res = await taskApi.get(taskId);
        const data = res.data as TaskStatus;
        setTask(data);
        setElapsed(Date.now() - startRef.current);

        const msg = (data.progress_message || "").trim();
        if (msg) {
          // Update the current row in place while the phase is unchanged;
          // start a new row only when the worker moves to a different phase.
          // See phaseKey() for why matching on the raw string was wrong.
          const key = phaseKey(msg);
          setSteps((prev) => {
            if (!prev.length) return [{ message: msg, at: Date.now() }];
            const last = prev[prev.length - 1];
            if (last.message === msg) return prev;            // nothing changed
            if (phaseKey(last.message) === key) {             // same phase, new numbers
              const next = prev.slice(0, -1);
              next.push({ message: msg, at: last.at });       // keep the phase's start time
              return next;
            }
            return [...prev, { message: msg, at: Date.now() }];
          });

          // Derive transfer speed from successive byte readings. Smoothed with
          // an EMA because the sampling interval (2s) against a counter that
          // moves in bursts produces a very jumpy instantaneous figure.
          const parsed = parseBytes(msg);
          if (parsed) {
            const now = Date.now();
            const prev = sampleRef.current;
            if (prev && now > prev.t) {
              const delta = parsed.done - prev.bytes;
              // Ignore non-advances: a flat or reset counter is not a speed.
              if (delta > 0) {
                const instant = (delta * 1000) / (now - prev.t);
                setRate((r) => (r > 0 ? r * 0.6 + instant * 0.4 : instant));
              }
            }
            sampleRef.current = { bytes: parsed.done, t: now };
          } else {
            sampleRef.current = null;
            setRate(0);
          }
        }

        if (data.status === "completed" || data.status === "failed") {
          setPolling(false);
          if (timerRef.current) clearInterval(timerRef.current);
        }
      } catch {
        setPolling(false);
      }
    };

    poll();
    timerRef.current = setInterval(poll, interval);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [taskId, interval]);

  // Stored progress is 0..1 — expose a real 0..100 percentage for the UI.
  const progressPct = Math.round(Math.min(1, Math.max(0, task?.progress || 0)) * 100);

  // A task that is still "pending" well after dispatch means no worker has
  // picked it up (worker down, or busy with other jobs).
  const stuck =
    !!task && task.status === "pending" && elapsed > STUCK_AFTER_MS;

  return { task, polling, steps, stuck, progressPct, rate };
}
