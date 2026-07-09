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

export function useTaskPolling(taskId: string | null, interval = 2000) {
  const [task, setTask] = useState<TaskStatus | null>(null);
  const [polling, setPolling] = useState(false);
  const [steps, setSteps] = useState<TaskStep[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(0);

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
    startRef.current = Date.now();

    const poll = async () => {
      try {
        const res = await taskApi.get(taskId);
        const data = res.data as TaskStatus;
        setTask(data);
        setElapsed(Date.now() - startRef.current);

        // Append the progress message to the step stream when it changes.
        const msg = (data.progress_message || "").trim();
        if (msg) {
          setSteps((prev) =>
            prev.length && prev[prev.length - 1].message === msg
              ? prev
              : [...prev, { message: msg, at: Date.now() }]
          );
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

  return { task, polling, steps, stuck, progressPct };
}
