import { useEffect, useRef, useState } from "react";
import { annotationApi } from "../../../shared/api/annotations";
import type {
  AnnotateSummary,
  ImageExportFormat,
  LatestExportResponse,
} from "../../../shared/api/annotations";
import { useTaskPolling } from "../../hooks/usePolling";
import TaskMonitor from "../../components/TaskMonitor/TaskMonitor";

interface Props {
  datasetId: string;
  summary: AnnotateSummary | null;
  onClose: () => void;
  /** Called after auto-split or a finished export so the editor can refresh. */
  onSummaryChanged: () => void;
}

const FORMATS: { id: ImageExportFormat; title: string; desc: string }[] = [
  { id: "yolo", title: "YOLO", desc: "YOLOv5/v8 txt + data.yaml" },
  { id: "coco", title: "COCO", desc: "JSON per split" },
  { id: "voc", title: "Pascal VOC", desc: "XML per image" },
  { id: "classification", title: "Classification", desc: "folders + labels.csv" },
];

/** Export dialog: pick a format, optionally auto-split, run the export task. */
export default function ExportModal({ datasetId, summary, onClose, onSummaryChanged }: Props) {
  const [format, setFormat] = useState<ImageExportFormat>("yolo");
  const [includeImages, setIncludeImages] = useState(true);

  const [trainPct, setTrainPct] = useState(70);
  const [validPct, setValidPct] = useState(20);
  const [testPct, setTestPct] = useState(10);
  const [onlyAnnotated, setOnlyAnnotated] = useState(true);
  const [applyingSplit, setApplyingSplit] = useState(false);
  const [splitResult, setSplitResult] = useState<{
    train: number; valid: number; test: number; assigned: number;
  } | null>(null);

  const [taskId, setTaskId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [exportResult, setExportResult] = useState<LatestExportResponse | null>(null);
  const { task, steps, stuck, progressPct, rate } = useTaskPolling(taskId);
  const handledRef = useRef<string | null>(null);

  // Handle export completion exactly once per task id.
  useEffect(() => {
    if (!task || !taskId) return;
    if (task.status !== "completed" && task.status !== "failed") return;
    if (handledRef.current === taskId) return;
    handledRef.current = taskId;
    setRunning(false);
    if (task.status === "completed") {
      annotationApi
        .getLatestExport(datasetId)
        .then((r) => setExportResult(r.data))
        .catch(() => {});
      onSummaryChanged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.status, taskId]);

  const warnings: string[] = (() => {
    const r = task?.result;
    if (r && typeof r === "object" && Array.isArray((r as { warnings?: unknown }).warnings)) {
      return ((r as { warnings: unknown[] }).warnings).map(String);
    }
    return [];
  })();

  const applySplit = async () => {
    if (trainPct + validPct + testPct !== 100) {
      alert("Split percentages must add up to 100.");
      return;
    }
    setApplyingSplit(true);
    try {
      // The API takes fractions summing to 1.0; the UI works in percents.
      const res = await annotationApi.autoSplit(datasetId, {
        train: trainPct / 100,
        valid: validPct / 100,
        test: testPct / 100,
        only_annotated: onlyAnnotated,
      });
      setSplitResult(res.data);
      onSummaryChanged();
    } catch {
      alert("Auto-split failed");
    } finally {
      setApplyingSplit(false);
    }
  };

  const startExport = async () => {
    setExportResult(null);
    setRunning(true);
    try {
      const res = await annotationApi.exportImages(datasetId, {
        format,
        include_images: includeImages,
      });
      setTaskId(res.data.task_id);
    } catch {
      setRunning(false);
      alert("Failed to start export");
    }
  };

  const splits = summary?.splits;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ann-export" onClick={(e) => e.stopPropagation()}>
        <h2>Export annotations</h2>

        <div className="ann-export__formats">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`ann-export__fmt ${format === f.id ? "ann-export__fmt--active" : ""}`}
              onClick={() => setFormat(f.id)}
            >
              <span className="ann-export__fmt-title">{f.title}</span>
              <span className="ann-export__fmt-desc">{f.desc}</span>
            </button>
          ))}
        </div>

        <label className="ann-export__check">
          <input
            type="checkbox"
            checked={includeImages}
            onChange={(e) => setIncludeImages(e.target.checked)}
          />
          Include image files in the export
        </label>

        <div className="ann-export__section">
          <div className="ann-export__section-title">Auto-split</div>
          <div className="ann-export__split-row">
            <label className="ann-export__split-field">
              train %
              <input type="number" min={0} max={100} value={trainPct}
                onChange={(e) => setTrainPct(Number(e.target.value))} />
            </label>
            <label className="ann-export__split-field">
              valid %
              <input type="number" min={0} max={100} value={validPct}
                onChange={(e) => setValidPct(Number(e.target.value))} />
            </label>
            <label className="ann-export__split-field">
              test %
              <input type="number" min={0} max={100} value={testPct}
                onChange={(e) => setTestPct(Number(e.target.value))} />
            </label>
            <button
              className="btn btn--secondary btn--sm"
              onClick={applySplit}
              disabled={applyingSplit}
            >
              {applyingSplit ? "Applying…" : "Apply split"}
            </button>
          </div>
          <label className="ann-export__check">
            <input
              type="checkbox"
              checked={onlyAnnotated}
              onChange={(e) => setOnlyAnnotated(e.target.checked)}
            />
            Only split annotated images
          </label>
          {splitResult ? (
            <div className="ann-export__split-result">
              Assigned {splitResult.assigned}: train {splitResult.train} · valid{" "}
              {splitResult.valid} · test {splitResult.test}
            </div>
          ) : splits ? (
            <div className="ann-export__split-result">
              Current: train {splits.train} · valid {splits.valid} · test {splits.test} ·
              unassigned {splits.unassigned}
            </div>
          ) : null}
        </div>

        <TaskMonitor rate={rate} task={task} steps={steps} stuck={stuck} progressPct={progressPct} running={running} />

        {exportResult && (
          <div className="ann-export__result">
            <div className="ann-export__result-line">
              Export ready
              {exportResult.image_count != null && ` — ${exportResult.image_count} images`}
              {exportResult.annotation_count != null && `, ${exportResult.annotation_count} annotations`}
            </div>
            {warnings.length > 0 && (
              <ul className="ann-export__warnings">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            {exportResult.download_url && (
              <button
                className="btn btn--primary btn--sm"
                onClick={() => window.open(exportResult.download_url as string)}
              >
                Download
              </button>
            )}
          </div>
        )}

        <div className="ann-export__actions">
          <button className="btn btn--secondary" onClick={onClose}>Close</button>
          <button className="btn btn--primary" onClick={startExport} disabled={running}>
            {running ? "Exporting…" : "Start Export"}
          </button>
        </div>
      </div>
    </div>
  );
}
