import { useEffect, useRef, useState } from "react";
import { annotationApi, IMAGE_CENTRIC_FORMATS } from "../../../shared/api/annotations";
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

/**
 * Formats grouped by the job they are for, not alphabetically.
 *
 * Seven equal buttons in a grid is a wall — and picking the wrong one is not
 * obvious until training goes badly. Grouping by task ("I am training a
 * detector") turns the choice into two small decisions instead of one large
 * one, and makes the segmentation-only formats impossible to reach by accident
 * from a box-only dataset.
 */
const FORMAT_GROUPS: {
  group: string;
  formats: { id: ImageExportFormat; title: string; desc: string }[];
}[] = [
  {
    group: "Object detection",
    formats: [
      { id: "yolo", title: "YOLO", desc: "YOLOv5/v8/v11 txt + data.yaml" },
      { id: "coco", title: "COCO", desc: "JSON per split · keeps masks" },
      { id: "voc", title: "Pascal VOC", desc: "XML per image" },
      { id: "tfcsv", title: "TensorFlow CSV", desc: "csv + label_map.pbtxt" },
      { id: "createml", title: "CreateML", desc: "Apple Vision JSON" },
    ],
  },
  {
    group: "Segmentation",
    formats: [
      { id: "segmentation", title: "Masks (PNG)", desc: "indexed label maps" },
    ],
  },
  {
    group: "Classification",
    formats: [
      { id: "classification", title: "Folders", desc: "class folders + labels.csv" },
    ],
  },
];

/** Shown under the picker so the consequence of the choice is visible before
 *  running a job that can take minutes. */
const FORMAT_NOTE: Partial<Record<ImageExportFormat, string>> = {
  coco: "The only format that stores painted masks losslessly — holes and disjoint regions survive.",
  yolo: "Masks are written as polygons. Holes are lost; a mask with two blobs becomes two instances.",
  voc: "Boxes only. Polygons and masks are reduced to their bounding box.",
  tfcsv: "Boxes only. Polygons and masks are reduced to their bounding box.",
  createml: "Boxes only, measured from the box centre. Polygons and masks are reduced.",
  segmentation: "One 8-bit PNG per image; pixel value = class index + 1. Bounding boxes are not rasterised.",
  classification: "Uses whole-image labels only. Boxes, polygons and masks are ignored.",
};

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
  const imagesForced = IMAGE_CENTRIC_FORMATS.has(format);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ann-export" onClick={(e) => e.stopPropagation()}>
        <h2>Export annotations</h2>

        {FORMAT_GROUPS.map((g) => (
          <div key={g.group} className="ann-export__group">
            <div className="ann-export__group-label">{g.group}</div>
            <div className="ann-export__formats">
              {g.formats.map((f) => (
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
          </div>
        ))}

        {FORMAT_NOTE[format] && (
          <p className="ann-export__note">{FORMAT_NOTE[format]}</p>
        )}

        {/* The server forces images on for image-centric layouts, so the box is
            shown checked and disabled rather than offering a choice that is
            silently overridden. */}
        <label
          className={`ann-export__check ${imagesForced ? "ann-export__check--locked" : ""}`}
          title={
            imagesForced
              ? "This format's label files reference images by path — the export is unusable without them."
              : undefined
          }
        >
          <input
            type="checkbox"
            checked={imagesForced || includeImages}
            disabled={imagesForced}
            onChange={(e) => setIncludeImages(e.target.checked)}
          />
          Include image files in the export
          {imagesForced && <span className="ann-export__req"> — required by this format</span>}
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
