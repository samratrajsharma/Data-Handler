import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { MouseEvent as RMouseEvent, ReactNode, UIEvent as RUIEvent } from "react";
import { annotationApi } from "../../../shared/api/annotations";
import type {
  AnnotationClass,
  AnnotateQueueItem,
  AnnotateSummary,
  ImageAnnotationsResponse,
  ImageStatus,
  Split,
} from "../../../shared/api/annotations";
import { datasetApi } from "../../../shared/api/datasets";
import { imageApi } from "../../../shared/api/images";
import {
  HANDLE_IDS,
  clamp,
  clamp01,
  dedupePoints,
  fitView,
  fromServer,
  handleCursor,
  handlePoint,
  hitTest,
  moveShape,
  newClientId,
  rectFromPoints,
  resizeBBox,
  shapeArea,
  shapeBounds,
  toServer,
} from "./canvasGeometry";
import type { HandleId, LocalAnnotation, ViewTransform } from "./canvasGeometry";
import { useAnnotationHistory } from "./useAnnotationHistory";
import Filmstrip from "./Filmstrip";
import HelpSheet from "./HelpSheet";
import LaunchGuide from "./LaunchGuide";
import MaskLayer from "./MaskLayer";
import type { MaskShape } from "./MaskLayer";
import { maskToRle, rleToMask } from "./maskCodec";
import { bufferIsEmpty, stampCircle, stampLine } from "./maskPaint";
import ExportModal from "./ExportModal";
import "./AnnotateEditor.css";

// ── Constants / small types ──────────────────────────────────────────────

type Tool = "select" | "bbox" | "polygon" | "pan" | "crop" | "brush" | "eraser";
type QueueFilter = "all" | ImageStatus;

const MIN_SCALE = 0.05;
const MAX_SCALE = 12;
const QUEUE_PAGE = 100;
const HANDLE_HIT_PX = 8;
const POLY_CLOSE_PX = 8;
const MIN_DRAW_PX = 4;
const FALLBACK_COLOR = "#94a3b8";

// Left panel drag limits. The floor keeps class names legible; the ceiling
// stops the panel eating the canvas, which is the space that actually matters.
const SIDE_MIN = 220;
const SIDE_MAX = 520;

// ── Resumable progress ───────────────────────────────────────────────────
// Which image you were last on, remembered per dataset so closing the tab and
// coming back tomorrow does not drop you at image 1 of 900. Per browser, not
// per server: it is a convenience, not shared state, and a stale value costs
// nothing because a missing asset falls back to the head of the queue.
const RESUME_KEY = "dh-ann-resume";

// Whether the first-run guide has been dismissed, per dataset. Per dataset and
// not global on purpose: someone confident with boxes meeting a segmentation
// dataset for the first time still benefits from the prompt.
const GUIDE_KEY = "dh-ann-guide-dismissed";

function readGuideDismissed(datasetId: string): boolean {
  try {
    return JSON.parse(localStorage.getItem(GUIDE_KEY) || "{}")?.[datasetId] === true;
  } catch {
    return false;
  }
}

function writeGuideDismissed(datasetId: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(GUIDE_KEY) || "{}");
    all[datasetId] = true;
    localStorage.setItem(GUIDE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable — the guide simply reappears next visit */
  }
}

function readResume(datasetId: string): string | null {
  try {
    const all = JSON.parse(localStorage.getItem(RESUME_KEY) || "{}");
    const v = all?.[datasetId];
    return typeof v === "string" ? v : null;
  } catch {
    return null;   // private mode, or a value written by an older version
  }
}

function writeResume(datasetId: string, assetId: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(RESUME_KEY) || "{}");
    all[datasetId] = assetId;
    localStorage.setItem(RESUME_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable — resuming is a nicety, never a hard failure */
  }
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type DragState =
  | { type: "pan"; startX: number; startY: number; startTx: number; startTy: number }
  | { type: "draw-bbox"; startX: number; startY: number }
  | { type: "move"; clientId: string; startPx: number; startPy: number; before: LocalAnnotation[]; orig: LocalAnnotation; moved: boolean }
  | { type: "resize"; clientId: string; handle: HandleId; before: LocalAnnotation[]; orig: LocalAnnotation; moved: boolean }
  | { type: "vertex"; clientId: string; index: number; before: LocalAnnotation[]; moved: boolean }
  // A brush/eraser stroke. `targetId` is the mask annotation being edited —
  // null when the stroke is creating a new one. `before` is captured at
  // mouse-down so the whole stroke is a single undo step, not one per stamp.
  | { type: "paint"; targetId: string | null; erase: boolean; lastPx: number; lastPy: number; before: LocalAnnotation[]; painted: boolean };

// Filmstrip filters: plain status names. The workflow pipeline is shown once,
// in the left sidebar — repeating it here made the strip busy and said the
// same thing twice. Counts still appear so you can see where work is piling up.
const FILTERS: { id: QueueFilter; label: string; hint: string }[] = [
  { id: "all", label: "All", hint: "Every image in the dataset" },
  { id: "unannotated", label: "Unannotated", hint: "Uploaded, not yet annotated" },
  { id: "annotated", label: "Annotated", hint: "Annotated, waiting for review" },
  { id: "approved", label: "Approved", hint: "Approved — included in exports" },
  { id: "rejected", label: "Rejected", hint: "Excluded from exports" },
];

// ── Inline SVG icons ─────────────────────────────────────────────────────

const ic = (children: ReactNode) => (
  // 20px, not 17. At 17 in a 34px button these read as smudges rather than
  // symbols — and three of the tools were not even SVG (see ICONS.crop/brush/
  // eraser below), so the rail mixed stroke icons with coloured emoji at
  // different optical weights.
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const ICONS = {
  select: ic(<path d="M6 3l12 11.5h-6.8l2.5 6-2.9 1.2-2.5-6L6 18z" fill="currentColor" stroke="none" />),
  bbox: ic(<rect x="4" y="6" width="16" height="12" rx="1" />),
  polygon: ic(<polygon points="12 3.5 20.5 9.8 17.2 20 6.8 20 3.5 9.8" />),
  pan: ic(
    <>
      <path d="M12 3v18M3 12h18" />
      <path d="M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5" />
      <path d="M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" />
    </>
  ),
  zoomIn: ic(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.5-4.5M8 11h6M11 8v6" />
    </>
  ),
  zoomOut: ic(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.5-4.5M8 11h6" />
    </>
  ),
  fit: ic(<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />),
  // These four were "⤧", "🖌", "🩹" and "◉"/"◎" — unicode and emoji rendered
  // inline. Emoji ignore `currentColor`, so the eraser stayed a blue bandage
  // whether the tool was active, inactive or hovered, and none of them matched
  // the stroke weight of the real icons beside them. Drawn properly here.
  crop: ic(
    <>
      <path d="M6 2v14a2 2 0 002 2h14" />
      <path d="M18 22V8a2 2 0 00-2-2H2" />
    </>
  ),
  brush: ic(
    <>
      <path d="M19.5 3.5a2.12 2.12 0 013 3L12 17l-4 1 1-4z" />
      <path d="M6.5 14.5C5 16 5 19 3 21c3 0 5.5-1 7-2.5" />
    </>
  ),
  eraser: ic(
    <>
      <path d="M18.4 10.6L13.4 5.6a2 2 0 00-2.8 0l-7 7a2 2 0 000 2.8l3 3H12l6.4-6.4a2 2 0 000-2.8z" />
      <path d="M8 20h13" />
    </>
  ),
  eyeOn: ic(
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: ic(
    <>
      <path d="M9.9 5.2A9.7 9.7 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.1M6.2 6.2A17 17 0 002 12s3.5 7 10 7a9.6 9.6 0 004.1-.9" />
      <path d="M3 3l18 18" />
    </>
  ),
  pencil: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3l4 4L8 20l-5 1 1-5z" />
    </svg>
  ),
  glyphBBox: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="1" /></svg>
  ),
  glyphPolygon: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" aria-hidden="true"><polygon points="12 3.5 20.5 9.8 17.2 20 6.8 20 3.5 9.8" /></svg>
  ),
  glyphTag: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3h8l10 10-8 8L3 11z" /><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  ),
};

const kindGlyph = (kind: LocalAnnotation["kind"]) =>
  kind === "bbox" ? ICONS.glyphBBox : kind === "polygon" ? ICONS.glyphPolygon : ICONS.glyphTag;

const STATUS_LABEL: Record<ImageStatus, string> = {
  unannotated: "Unannotated",
  annotated: "Annotated",
  approved: "Approved",
  rejected: "Rejected",
};

// ── Component ────────────────────────────────────────────────────────────

/**
 * Full-viewport manual image annotation editor: bbox + polygon drawing on a
 * zoom/pan canvas, class management, per-image undo/redo, autosave, a
 * filterable filmstrip queue, splits, and dataset export.
 */
export default function AnnotateEditor() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const dsId = datasetId ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const initialAssetRef = useRef<string | null>(searchParams.get("asset"));
  const setParamsRef = useRef(setSearchParams);
  setParamsRef.current = setSearchParams;

  // Dataset / classes / summary
  const [datasetName, setDatasetName] = useState("");
  const [classes, setClasses] = useState<AnnotationClass[]>([]);
  const [activeClassId, setActiveClassId] = useState<string | null>(null);
  const [summary, setSummary] = useState<AnnotateSummary | null>(null);
  const [newClassName, setNewClassName] = useState("");

  // Queue / filmstrip
  const [queue, setQueue] = useState<AnnotateQueueItem[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const loadMoreRef = useRef(false);
  const stripRef = useRef<HTMLDivElement | null>(null);

  // Current image
  const [imgData, setImgData] = useState<ImageAnnotationsResponse | null>(null);
  const [imgSize, setImgSize] = useState<{ W: number; H: number } | null>(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgReady, setImgReady] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);

  // Annotation state
  const [annotations, setAnnotations] = useState<LocalAnnotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const savePromiseRef = useRef<Promise<boolean>>(Promise.resolve(true));

  // Tools / view
  const [tool, setTool] = useState<Tool>("bbox");
  const [view, setView] = useState<ViewTransform>({ scale: 1, tx: 0, ty: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [hoverCursor, setHoverCursor] = useState("default");
  const [cursorPos, setCursorPos] = useState<[number, number] | null>(null);
  const [draftRect, setDraftRect] = useState<Rect | null>(null);
  const [polyDraft, setPolyDraft] = useState<[number, number][]>([]);
  const dragRef = useRef<DragState | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const [showExport, setShowExport] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // Lazily initialised so the localStorage read happens once, not on every
  // render of a component that re-renders at pointer frequency.
  const [guideDismissed, setGuideDismissed] = useState(() =>
    dsId ? readGuideDismissed(dsId) : false
  );

  // ── View preferences ───────────────────────────────────────────────────
  // Hide annotations to inspect the underlying pixels without overlays in the
  // way — the usual reason is checking whether a box is actually tight.
  const [showAnnotations, setShowAnnotations] = useState(true);

  // When locked, the view is NOT re-fitted as you move between images. Zoom
  // into a corner, lock, and step through the queue inspecting the same region
  // on every image — without it, each image load snaps back to fit.
  const [zoomLocked, setZoomLocked] = useState(false);

  // Left panel width. Persisted per browser so the layout survives a reload;
  // failures are swallowed because a private window that throws on
  // localStorage must not take the editor down with it.
  const [sideWidth, setSideWidth] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("dh-ann-side-w"));
      return v >= SIDE_MIN && v <= SIDE_MAX ? v : 300;
    } catch { return 300; }
  });
  const resizingRef = useRef(false);

  // Jump-to-image box: typed position, committed on Enter.
  const [jumpValue, setJumpValue] = useState("");

  // ── Tags ───────────────────────────────────────────────────────────────
  // Workflow metadata about the image ("blurry", "recheck", "batch-3") — not
  // classes, and never exported to training formats. Saved immediately on
  // change rather than folded into the annotation save, because tagging is
  // often the only thing a user does to an image and it should not require
  // touching an annotation to persist.
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [knownTags, setKnownTags] = useState<string[]>([]);

  // Display adjustments. These are a VIEWING aid only — they never touch the
  // stored pixels, and are applied to the <img> alone so the annotation overlay
  // keeps its true colours (washing out the boxes along with the photo would
  // defeat the point of turning the contrast up to find a faint edge).
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [showDisplay, setShowDisplay] = useState(false);
  const displayAdjusted = brightness !== 100 || contrast !== 100;
  const imgFilter = displayAdjusted
    ? `brightness(${brightness}%) contrast(${contrast}%)`
    : undefined;
  const resetDisplay = useCallback(() => { setBrightness(100); setContrast(100); }, []);

  // Crop awaiting confirmation. Held in state rather than applied on mouse-up
  // because the operation overwrites the stored image — the one action in this
  // editor that cannot be undone with Ctrl+Z.
  const [pendingCrop, setPendingCrop] = useState<Rect | null>(null);
  const [cropping, setCropping] = useState(false);

  // ── Brush ──────────────────────────────────────────────────────────────
  // Radius in IMAGE pixels, not screen pixels: a stroke must be the same
  // thickness in the exported mask whether it was drawn at 25% or 400% zoom.
  const [brushSize, setBrushSize] = useState(24);

  // The in-progress stroke. Kept in a ref rather than state because it is
  // mutated on every mousemove — routing a two-megapixel buffer through React
  // state per event would make the brush unusable on a large image. The
  // counter is what tells MaskLayer to repaint.
  const liveBufRef = useRef<Uint8Array | null>(null);
  const [liveVersion, setLiveVersion] = useState(0);
  const [liveColor, setLiveColor] = useState(FALLBACK_COLOR);

  const { reset: historyReset, commit: historyCommit, undo: historyUndo, redo: historyRedo } =
    useAnnotationHistory();

  // Mirror of the state that stable window/keyboard handlers need.
  const latest = useRef({
    view, imgSize, annotations, tool, activeClassId, polyDraft, classes,
    imgData, dirty, queueFilter, selectedId, draftRect, spaceHeld, zoomLocked, queue,
    sideWidth, tags, queueTotal,
  });
  latest.current = {
    view, imgSize, annotations, tool, activeClassId, polyDraft, classes,
    imgData, dirty, queueFilter, selectedId, draftRect, spaceHeld, zoomLocked, queue,
    sideWidth, tags, queueTotal,
  };

  // ── Derived ────────────────────────────────────────────────────────────

  const classMap = useMemo(() => {
    const m = new Map<string, AnnotationClass>();
    classes.forEach((c) => m.set(c.id, c));
    return m;
  }, [classes]);
  const clsColor = useCallback(
    (id: string) => classMap.get(id)?.color || FALLBACK_COLOR,
    [classMap]
  );
  const clsName = useCallback(
    (id: string) => classMap.get(id)?.name || "deleted",
    [classMap]
  );
  const activeClass = activeClassId ? classMap.get(activeClassId) ?? null : null;

  // Masks are excluded from `shapes`: that list drives the SVG overlay and its
  // hit-testing, both of which assume vector geometry. Masks render on their
  // own canvas layer and are listed separately in the side panel.
  const shapes = useMemo(
    () => annotations.filter((a) => a.kind !== "classification" && a.kind !== "mask"),
    [annotations]
  );
  const maskAnnotations = useMemo(() => annotations.filter((a) => a.kind === "mask"), [annotations]);

  /** What MaskLayer needs: the RLE, a colour, and whether it is selected. */
  const maskShapes: MaskShape[] = useMemo(
    () =>
      maskAnnotations
        .filter((a): a is LocalAnnotation & { mask: NonNullable<LocalAnnotation["mask"]> } => !!a.mask)
        .map((a) => ({
          clientId: a.clientId,
          mask: a.mask,
          color: clsColor(a.class_id),
          selected: a.clientId === selectedId,
        })),
    [maskAnnotations, selectedId, clsColor]
  );
  const classifications = useMemo(
    () => annotations.filter((a) => a.kind === "classification"),
    [annotations]
  );
  const perClassCount = useMemo(() => {
    const m = new Map<string, number>();
    annotations.forEach((a) => m.set(a.class_id, (m.get(a.class_id) || 0) + 1));
    return m;
  }, [annotations]);
  const sortedShapes = useMemo(
    () => [...shapes].sort((a, b) => shapeArea(b) - shapeArea(a)),
    [shapes]
  );

  /**
   * Progress through the first-run guide, derived entirely from real state —
   * never from "the user has seen step N". The distinction matters: a counter
   * would tick on a dataset someone else labelled, and would keep claiming
   * step 2 is done after the annotation was deleted.
   *
   * "Drawn something" is true for an unsaved shape on the current image OR for
   * anything already saved anywhere in the dataset, so the tick lands the
   * moment the user draws rather than one action later.
   */
  const touchedAnywhere =
    (summary?.annotated ?? 0) + (summary?.approved ?? 0) + (summary?.rejected ?? 0);
  const guide = useMemo(
    () => ({
      hasClass: classes.length > 0,
      hasAnnotation: annotations.length > 0 || touchedAnywhere > 0,
      hasSaved: touchedAnywhere > 0,
      hasApproved: (summary?.approved ?? 0) > 0,
    }),
    [classes.length, annotations.length, touchedAnywhere, summary?.approved]
  );

  // Stable identities: LaunchGuide is memoised, and a fresh inline arrow on
  // every parent render would defeat that inside a component that re-renders
  // at pointer frequency while drawing.
  const dismissGuide = useCallback(() => {
    setGuideDismissed(true);
    if (dsId) writeGuideDismissed(dsId);
  }, [dsId]);
  const openShortcuts = useCallback(() => setShowHelp(true), []);
  const closeShortcuts = useCallback(() => setShowHelp(false), []);

  /**
   * The next thing worth telling the user, or null.
   *
   * ONE AT A TIME, AND ONLY THE STEPS THAT BLOCK PROGRESS. There were three
   * more hints I did not add — brush, tags, splits — because a canvas covered
   * in advice is just a different kind of unusable, and none of those stop you
   * finishing a first pass. These two do: without a box there is nothing to
   * save, and without an approval the export comes out empty.
   *
   * Every condition is derived from real state, so each hint disappears the
   * moment the thing it asks for exists — no "seen" counters, and nothing to
   * get out of step with the data.
   *
   * The no-classes case is deliberately absent: it has a blocking overlay
   * already (.ann-guard), because with no classes there is genuinely nothing
   * to do on the canvas. These two must NOT block — they appear while you are
   * meant to be drawing.
   */
  const coach = useMemo(() => {
    if (guideDismissed || !bootstrapped || imgLoading) return null;
    if (!guide.hasClass) return null;
    if (!guide.hasAnnotation) {
      return {
        id: "draw",
        key: "B",
        text: "and drag on the image to draw your first box.",
      };
    }
    if (!guide.hasApproved) {
      return {
        id: "approve",
        key: "A",
        text: "to approve this image. Exports only include approved images.",
      };
    }
    return null;
  }, [guideDismissed, bootstrapped, imgLoading, guide]);
  const selected = useMemo(
    () => annotations.find((a) => a.clientId === selectedId) ?? null,
    [annotations, selectedId]
  );

  const currentAssetId = imgData?.asset.id ?? null;
  const queueIndex = currentAssetId ? queue.findIndex((q) => q.asset_id === currentAssetId) : -1;

  /** Previous/next within the CURRENTLY FILTERED queue.
   *
   *  Derived here rather than taken from imgData: the server computes
   *  prev/next for the filter in force when the image was fetched, so changing
   *  the filter used to require re-fetching the image just to refresh two ids.
   *  That reload is what made clicking "Annotated" freeze and visibly reload
   *  the picture you were already looking at.
   *
   *  The queue is already loaded and already ordered, so the neighbours are
   *  just its adjacent entries. Falls back to the server's values when the
   *  current image is not in the filtered queue (it was filtered out, but is
   *  still on screen), which keeps navigation working instead of dead-ending. */
  const neighbours = useMemo(() => {
    if (queueIndex >= 0) {
      return {
        prev: queue[queueIndex - 1]?.asset_id ?? null,
        next: queue[queueIndex + 1]?.asset_id ?? null,
      };
    }
    return {
      prev: imgData?.prev_asset_id ?? null,
      next: imgData?.next_asset_id ?? null,
    };
  }, [queueIndex, queue, imgData]);

  // Separate ref rather than a field on `latest`: that object literal is built
  // above this point, so referencing `neighbours` there would evaluate it
  // before initialisation and throw at runtime.
  const neighboursRef = useRef(neighbours);
  neighboursRef.current = neighbours;
  const noImages = bootstrapped && (summary?.total ?? 0) === 0;

  // ── Committing changes (history + dirty) ───────────────────────────────

  const commitChange = useCallback(
    (updater: (prev: LocalAnnotation[]) => LocalAnnotation[]) => {
      const prev = latest.current.annotations;
      historyCommit(prev);
      setAnnotations(updater(prev));
      setDirty(true);
    },
    [historyCommit]
  );

  const doUndo = useCallback(() => {
    const prev = historyUndo(latest.current.annotations);
    if (prev) {
      setAnnotations(prev);
      setDirty(true);
      setSelectedId(null);
    }
  }, [historyUndo]);

  const doRedo = useCallback(() => {
    const next = historyRedo(latest.current.annotations);
    if (next) {
      setAnnotations(next);
      setDirty(true);
      setSelectedId(null);
    }
  }, [historyRedo]);

  // ── Data loading ───────────────────────────────────────────────────────

  const refreshSummary = useCallback(() => {
    if (!dsId) return;
    annotationApi.getSummary(dsId).then((r) => setSummary(r.data)).catch(() => {});
  }, [dsId]);

  const queueSeqRef = useRef(0);
  const loadQueue = useCallback(
    async (filter: QueueFilter, skip: number) => {
      const seq = ++queueSeqRef.current;
      const params: { status?: ImageStatus; skip: number; limit: number } = {
        skip,
        limit: QUEUE_PAGE,
      };
      if (filter !== "all") params.status = filter;
      const res = await annotationApi.getQueue(dsId, params);
      // A stale response (filter changed while in flight) must not clobber
      // the newer queue.
      if (seq !== queueSeqRef.current) return res.data;
      setQueue((prev) => (skip === 0 ? res.data.items : [...prev, ...res.data.items]));
      setQueueTotal(res.data.total);
      return res.data;
    },
    [dsId]
  );

  const imageSeqRef = useRef(0);
  const loadImage = useCallback(
    async (assetId: string) => {
      const seq = ++imageSeqRef.current;
      setImgLoading(true);
      setImgReady(false);
      setImgError(false);
      setSelectedId(null);
      setPolyDraft([]);
      setDraftRect(null);
      dragRef.current = null;
      try {
        const f = latest.current.queueFilter;
        const params = f !== "all" ? { status: f } : undefined;
        const res = await annotationApi.getImageAnnotations(dsId, assetId, params);
        if (seq !== imageSeqRef.current) return; // superseded by a newer navigation
        setImgData(res.data);
        setAnnotations(res.data.annotations.map(fromServer));
        historyReset();
        setDirty(false);
        const a = res.data.asset;
        setImgSize(a.width && a.height ? { W: a.width, H: a.height } : null);
        setTags(res.data.tags ?? []);
        setTagInput("");
        setParamsRef.current({ asset: assetId }, { replace: true });
        // Remember where we are, so reopening this dataset resumes here.
        writeResume(dsId, assetId);
      } catch {
        if (seq !== imageSeqRef.current) return;
        setImgError(true);
        alert("Failed to load image annotations");
      } finally {
        if (seq === imageSeqRef.current) setImgLoading(false);
      }
    },
    [dsId, historyReset]
  );

  // ── Saving ─────────────────────────────────────────────────────────────

  const saveNow = useCallback(
    (statusOverride?: ImageStatus): Promise<boolean> => {
      const run = async (): Promise<boolean> => {
        const L = latest.current;
        const data = L.imgData;
        if (!data) return true;
        if (!L.dirty && !statusOverride) return true;
        const assetId = data.asset.id;
        const sent = L.annotations;
        setSaving(true);
        try {
          const res = await annotationApi.saveImageAnnotations(dsId, assetId, {
            annotations: sent.map(toServer),
            ...(statusOverride ? { status: statusOverride } : {}),
          });
          const returned = res.data.annotations;
          // If the user kept editing while the save was in flight, the array
          // reference changed — keep the dirty flag so a follow-up save runs.
          const editedDuringSave = latest.current.annotations !== sent;
          setAnnotations((prev) =>
            prev.map((a) => {
              const i = sent.indexOf(a);
              return i >= 0 && returned[i] ? { ...a, serverId: returned[i].id } : a;
            })
          );
          if (!editedDuringSave) setDirty(false);
          setImgData((prev) =>
            prev && prev.asset.id === assetId ? { ...prev, status: res.data.status } : prev
          );
          setQueue((prev) => {
            // Under an active status filter, a row whose new status no longer
            // matches leaves the server-side set — drop it locally too, so
            // skip-based pagination stays aligned with the server.
            const f = latest.current.queueFilter;
            if (f !== "all" && res.data.status !== f) {
              const next = prev.filter((q) => q.asset_id !== assetId);
              if (next.length !== prev.length) setQueueTotal((t) => Math.max(0, t - 1));
              return next;
            }
            return prev.map((q) =>
              q.asset_id === assetId
                ? { ...q, status: res.data.status, annotation_count: sent.length }
                : q
            );
          });
          refreshSummary();
          return true;
        } catch {
          alert("Failed to save annotations — your edits are kept in the editor.");
          return false;
        } finally {
          setSaving(false);
        }
      };
      const p = savePromiseRef.current.then(run, run);
      savePromiseRef.current = p;
      return p;
    },
    [dsId, refreshSummary]
  );

  const goTo = useCallback(
    async (assetId: string | null) => {
      if (!assetId || assetId === latest.current.imgData?.asset.id) return;
      const saved = await saveNow();
      // A failed save would be silently discarded by loading the next image —
      // stay on the current one so the user can retry.
      if (!saved && latest.current.dirty) return;
      await loadImage(assetId);
    },
    [saveNow, loadImage]
  );

  /** Jump straight to the Nth image in the current filtered queue (1-based).
   *  Stepping with the arrows is fine for neighbours but useless for "go back
   *  to roughly image 400 of 900". */
  const jumpToIndex = useCallback(
    (oneBased: number) => {
      const q = latest.current.queue;
      const i = Math.min(Math.max(1, Math.trunc(oneBased)), q.length) - 1;
      const target = q[i];
      if (target) void goTo(target.asset_id);
    },
    [goTo]
  );

  /** Copy every annotation from the previous image onto this one.
   *
   *  For sequences — video frames, a scanned batch, a conveyor — consecutive
   *  images usually differ by a nudge, so re-drawing identical boxes is the
   *  bulk of the work. Copy then adjust is far faster.
   *
   *  Fetched fresh rather than cached: the previous image may have been edited
   *  in another tab, and a stale cache would silently paste old geometry.
   *  Copies get new client ids and a null serverId so they save as NEW rows
   *  rather than trying to update the previous image's annotation records.
   *  ADDS to what is already here instead of replacing, so an accidental press
   *  is undoable (Ctrl+Z) and never destroys existing work. */
  const copyPreviousLabels = useCallback(async () => {
    const prevId = latest.current.imgData?.prev_asset_id;
    if (!prevId) return;
    try {
      const res = await annotationApi.getImageAnnotations(dsId, prevId);
      const incoming = res.data.annotations.map(fromServer).map((a) => ({
        ...a,
        clientId: newClientId(),
        serverId: null,
      }));
      if (incoming.length === 0) return;
      // Don't duplicate a classification label that is already applied.
      const existingCls = new Set(
        latest.current.annotations.filter((a) => a.kind === "classification").map((a) => a.class_id)
      );
      const toAdd = incoming.filter(
        (a) => a.kind !== "classification" || !existingCls.has(a.class_id)
      );
      if (toAdd.length === 0) return;
      commitChange((prev) => [...prev, ...toAdd]);
    } catch {
      alert("Could not load the previous image's labels.");
    }
  }, [dsId, commitChange]);

  /** Apply the pending crop: rewrites the stored image, remaps annotations.
   *
   *  Unsaved edits are flushed first. The backend remaps annotations from the
   *  rows it has, so anything still only in browser memory would be silently
   *  dropped — saving first makes what you see what gets remapped. */
  const applyCrop = useCallback(async () => {
    const r = pendingCrop;
    const assetId = latest.current.imgData?.asset.id;
    if (!r || !assetId) return;
    setCropping(true);
    try {
      if (latest.current.dirty) {
        const ok = await saveNow();
        if (!ok) { alert("Could not save your annotations — crop cancelled."); return; }
      }
      const res = await imageApi.crop(dsId, assetId, { x: r.x, y: r.y, w: r.w, h: r.h });
      setPendingCrop(null);
      setTool("select");
      // Reload from the server: dimensions, annotation geometry and the
      // thumbnail have all changed underneath us.
      await loadImage(assetId);
      // Reload the filmstrip from the start so the regenerated thumbnail and
      // the new annotation count are picked up.
      void loadQueue(latest.current.queueFilter, 0);
      const { annotations_dropped: dropped } = res.data;
      if (dropped > 0) {
        alert(`Cropped. ${dropped} annotation${dropped === 1 ? "" : "s"} fell outside the new frame and ${dropped === 1 ? "was" : "were"} removed.`);
      }
    } catch {
      alert("Crop failed. The image has not been changed.");
    } finally {
      setCropping(false);
    }
  }, [pendingCrop, dsId, saveNow, loadImage, loadQueue]);

  /** Approve every image that has been annotated but not yet reviewed.
   *
   *  Scoped to `annotated` rather than everything: approving images nobody has
   *  opened would mark empty images as reviewed. Confirmed first because it is
   *  a bulk state change with no undo. */
  const approveAll = useCallback(async () => {
    const pending = summary?.annotated ?? 0;
    if (pending === 0) {
      alert("No annotated images are waiting for approval.");
      return;
    }
    if (!window.confirm(
      `Approve ${pending} annotated image${pending === 1 ? "" : "s"}?\n\n` +
      "Images that have not been annotated are left untouched. This cannot be undone."
    )) return;
    try {
      if (latest.current.dirty) await saveNow();
      const res = await annotationApi.bulkSetState(dsId, {
        status: "approved",
        only_status: "annotated",
      });
      refreshSummary();
      void loadQueue(latest.current.queueFilter, 0);
      // Reload so the header badge reflects the new status for this image too.
      const cur = latest.current.imgData?.asset.id;
      if (cur) await loadImage(cur);
      alert(`Approved ${res.data.updated} image${res.data.updated === 1 ? "" : "s"}.`);
    } catch {
      alert("Bulk approve failed.");
    }
  }, [dsId, summary, saveNow, refreshSummary, loadQueue, loadImage]);

  /** Persist the tag list for the current image and refresh the vocabulary. */
  const saveTags = useCallback(
    async (next: string[]) => {
      const assetId = latest.current.imgData?.asset.id;
      if (!assetId) return;
      const prev = latest.current.tags;
      setTags(next);                       // optimistic
      try {
        const res = await annotationApi.setImageTags(dsId, assetId, next);
        // Trust the server's normalisation (lower-cased, de-duplicated,
        // truncated) rather than the raw strings typed here, so what is shown
        // matches what is stored.
        setTags(res.data.tags);
        annotationApi.listTags(dsId)
          .then((r) => setKnownTags(r.data.tags.map((t) => t.tag)))
          .catch(() => {});
      } catch {
        setTags(prev);                     // roll back
        alert("Could not save tags.");
      }
    },
    [dsId]
  );

  const addTag = useCallback(
    (raw: string) => {
      const value = raw.trim().toLowerCase();
      if (!value) return;
      if (latest.current.tags.includes(value)) { setTagInput(""); return; }
      void saveTags([...latest.current.tags, value]);
      setTagInput("");
    },
    [saveTags]
  );

  const removeTag = useCallback(
    (tag: string) => void saveTags(latest.current.tags.filter((t) => t !== tag)),
    [saveTags]
  );

  const goPrev = useCallback(() => {
    void goTo(neighboursRef.current.prev);
  }, [goTo]);
  const goNext = useCallback(() => {
    void goTo(neighboursRef.current.next);
  }, [goTo]);

  // ── Bootstrap ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!dsId) return;
    let cancelled = false;
    (async () => {
      try {
        const [dsRes, clsRes, sumRes, qRes] = await Promise.all([
          datasetApi.get(dsId).catch(() => null),
          annotationApi.listClasses(dsId),
          annotationApi.getSummary(dsId),
          annotationApi.getQueue(dsId, { limit: QUEUE_PAGE }),
        ]);
        if (cancelled) return;
        if (dsRes) {
          // GET /datasets/{id} returns a {dataset, versions, metadata} wrapper.
          const raw = dsRes.data as { name?: string; dataset?: { name?: string } };
          setDatasetName(raw.dataset?.name || raw.name || "");
        }
        setClasses(clsRes.data.classes);
        if (clsRes.data.classes.length) setActiveClassId(clsRes.data.classes[0].id);
        setSummary(sumRes.data);
        setQueue(qRes.data.items);
        setQueueTotal(qRes.data.total);
        annotationApi.listTags(dsId)
          .then((r) => { if (!cancelled) setKnownTags(r.data.tags.map((t) => t.tag)); })
          .catch(() => {});
        // Priority: an explicit ?asset= in the URL (someone shared a link to a
        // specific image) > where this browser left off > the head of the
        // queue. A remembered asset that is no longer in the queue (deleted,
        // or filtered out) falls through to the first item rather than
        // erroring.
        const remembered = readResume(dsId);
        const inQueue = remembered && qRes.data.items.some((i) => i.asset_id === remembered);
        const first =
          initialAssetRef.current ||
          (inQueue ? remembered : null) ||
          qRes.data.items[0]?.asset_id;
        if (first) await loadImage(first);
      } catch {
        if (!cancelled) alert("Failed to load annotation data for this dataset");
      } finally {
        if (!cancelled) setBootstrapped(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dsId, loadImage]);

  // ── View helpers ───────────────────────────────────────────────────────

  const fitToContainer = useCallback(() => {
    const el = containerRef.current;
    const size = latest.current.imgSize;
    if (!el || !size) return;
    setView(fitView(size.W, size.H, el.clientWidth, el.clientHeight));
  }, []);

  // Fit on image load / change — unless the user has locked the zoom, in which
  // case the whole point is that the view survives navigation.
  useEffect(() => {
    if (imgSize && !latest.current.zoomLocked) fitToContainer();
  }, [imgSize, currentAssetId, fitToContainer]);

  /** Drag the divider between the left panel and the canvas.
   *
   *  Listeners go on `window`, not the handle: the pointer routinely outruns a
   *  6px target during a drag, and a handle-bound mousemove would drop it.
   *  `userSelect: none` on the body stops the drag turning into a text
   *  selection across the panel. */
  const startResize = useCallback((e: RMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    resizingRef.current = true;
    const startX = e.clientX;
    const startW = latest.current.sideWidth;
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const next = Math.min(SIDE_MAX, Math.max(SIDE_MIN, startW + (ev.clientX - startX)));
      setSideWidth(next);
    };
    const onUp = () => {
      resizingRef.current = false;
      document.body.style.userSelect = prevSelect;
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Persist only on release: writing on every mousemove would hammer
      // localStorage for the whole drag.
      try { localStorage.setItem("dh-ann-side-w", String(latest.current.sideWidth)); } catch { /* private mode */ }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  /** Back to 100%, centred. Distinct from Fit, which scales to the container. */
  const resetZoom = useCallback(() => {
    const el = containerRef.current;
    const size = latest.current.imgSize;
    if (!el || !size) return;
    setView({
      scale: 1,
      tx: (el.clientWidth - size.W) / 2,
      ty: (el.clientHeight - size.H) / 2,
    });
  }, []);

  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    setView((v) => {
      const ns = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
      const k = ns / v.scale;
      return { scale: ns, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
    });
  }, []);

  const zoomAtCenter = useCallback(
    (factor: number) => {
      const el = containerRef.current;
      if (!el) return;
      zoomAt(el.clientWidth / 2, el.clientHeight / 2, factor);
    },
    [zoomAt]
  );

  // Wheel zoom toward the cursor (native listener — must be non-passive).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, noImages]);

  /** Client coords → normalized image point, via the stage rect + scale. */
  const toImagePoint = useCallback((clientX: number, clientY: number): [number, number] => {
    const st = stageRef.current;
    const L = latest.current;
    if (!st || !L.imgSize) return [0, 0];
    const r = st.getBoundingClientRect();
    return [
      (clientX - r.left) / L.view.scale / L.imgSize.W,
      (clientY - r.top) / L.view.scale / L.imgSize.H,
    ];
  }, []);

  /** Hit-test the selected shape's resize/vertex handles in screen space. */
  const hitHandle = useCallback(
    (
      a: LocalAnnotation,
      clientX: number,
      clientY: number
    ): { kind: "handle"; id: HandleId } | { kind: "vertex"; index: number } | null => {
      const st = stageRef.current;
      const L = latest.current;
      if (!st || !L.imgSize) return null;
      const r = st.getBoundingClientRect();
      const s = L.view.scale;
      const { W, H } = L.imgSize;
      if (a.kind === "bbox" && a.x != null && a.y != null && a.w != null && a.h != null) {
        for (const id of HANDLE_IDS) {
          const [hx, hy] = handlePoint(a.x, a.y, a.w, a.h, id);
          const sx = r.left + hx * W * s;
          const sy = r.top + hy * H * s;
          if (Math.abs(clientX - sx) <= HANDLE_HIT_PX && Math.abs(clientY - sy) <= HANDLE_HIT_PX) {
            return { kind: "handle", id };
          }
        }
      } else if (a.kind === "polygon" && a.points) {
        for (let i = 0; i < a.points.length; i++) {
          const sx = r.left + a.points[i][0] * W * s;
          const sy = r.top + a.points[i][1] * H * s;
          if (Math.hypot(clientX - sx, clientY - sy) <= HANDLE_HIT_PX) {
            return { kind: "vertex", index: i };
          }
        }
      }
      return null;
    },
    []
  );

  // ── Drawing / editing actions ──────────────────────────────────────────

  const closePolygon = useCallback(() => {
    const L = latest.current;
    const pts = dedupePoints(L.polyDraft);
    setPolyDraft([]);
    if (pts.length < 3 || !L.activeClassId) return;
    const ann: LocalAnnotation = {
      clientId: newClientId(),
      serverId: null,
      class_id: L.activeClassId,
      kind: "polygon",
      x: null, y: null, w: null, h: null,
      points: pts,
    };
    commitChange((prev) => [...prev, ann]);
    setSelectedId(ann.clientId);
  }, [commitChange]);

  const deleteSelected = useCallback(() => {
    const sel = latest.current.selectedId;
    if (!sel) return;
    commitChange((prev) => prev.filter((a) => a.clientId !== sel));
    setSelectedId(null);
  }, [commitChange]);

  const deleteAnnotation = useCallback(
    (clientId: string) => {
      commitChange((prev) => prev.filter((a) => a.clientId !== clientId));
      if (latest.current.selectedId === clientId) setSelectedId(null);
    },
    [commitChange]
  );

  const cancelOrDeselect = useCallback(() => {
    if (latest.current.polyDraft.length) {
      setPolyDraft([]);
      return;
    }
    if (dragRef.current?.type === "draw-bbox") {
      dragRef.current = null;
      setDraftRect(null);
      return;
    }
    setSelectedId(null);
  }, []);

  /** Set the active class; also reassign the selected annotation's class. */
  const selectClass = useCallback(
    (classId: string) => {
      setActiveClassId(classId);
      const sel = latest.current.selectedId;
      if (!sel) return;
      const a = latest.current.annotations.find((x) => x.clientId === sel);
      if (a && a.class_id !== classId) {
        commitChange((prev) =>
          prev.map((x) => (x.clientId === sel ? { ...x, class_id: classId } : x))
        );
      }
    },
    [commitChange]
  );

  const toggleClassification = useCallback(
    (classId: string) => {
      const existing = latest.current.annotations.find(
        (a) => a.kind === "classification" && a.class_id === classId
      );
      if (existing) {
        commitChange((prev) => prev.filter((a) => a.clientId !== existing.clientId));
      } else {
        const ann: LocalAnnotation = {
          clientId: newClientId(),
          serverId: null,
          class_id: classId,
          kind: "classification",
          x: null, y: null, w: null, h: null, points: null,
        };
        commitChange((prev) => [...prev, ann]);
      }
    },
    [commitChange]
  );

  // ── Canvas mouse handlers ──────────────────────────────────────────────

  const onCanvasMouseDown = (e: RMouseEvent<HTMLDivElement>) => {
    if (!imgSize) return;
    const isPan = e.button === 1 || spaceHeld || tool === "pan";
    if (isPan) {
      e.preventDefault();
      dragRef.current = {
        type: "pan",
        startX: e.clientX, startY: e.clientY,
        startTx: view.tx, startTy: view.ty,
      };
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;
    const [nx, ny] = toImagePoint(e.clientX, e.clientY);

    // ── Brush / eraser ──
    // A stroke edits ONE mask annotation. The target is the selected mask if
    // there is one, otherwise the topmost mask of the active class, otherwise a
    // new annotation. Painting always continues an existing mask where that is
    // unambiguous, so repeated strokes build up one instance rather than
    // littering the image with one annotation per stroke.
    if (tool === "brush" || tool === "eraser") {
      const L = latest.current;
      if (!L.imgSize) return;
      if (!L.activeClassId && tool === "brush") return;

      const sel = L.annotations.find((a) => a.clientId === L.selectedId && a.kind === "mask");
      const target =
        sel ?? [...L.annotations].reverse().find((a) => a.kind === "mask" && a.class_id === L.activeClassId);

      // The eraser only ever modifies something that exists.
      if (tool === "eraser" && !target) return;

      const { W: mw, H: mh } = L.imgSize;
      const buf = new Uint8Array(mw * mh);
      if (target?.mask) {
        try {
          buf.set(rleToMask(target.mask));
        } catch {
          // A mask that cannot be decoded (e.g. saved against a different
          // image size after a crop) starts from blank rather than aborting
          // the stroke.
        }
      }
      liveBufRef.current = buf;
      setLiveColor(target ? clsColor(target.class_id) : clsColor(L.activeClassId ?? ""));

      const px = clamp01(nx) * mw;
      const py = clamp01(ny) * mh;
      stampCircle(buf, mw, mh, px, py, brushSize / 2, tool === "eraser" ? 0 : 1);
      setLiveVersion((v) => v + 1);

      dragRef.current = {
        type: "paint",
        targetId: target?.clientId ?? null,
        erase: tool === "eraser",
        lastPx: px,
        lastPy: py,
        before: L.annotations,
        painted: true,
      };
      if (target) setSelectedId(target.clientId);
      return;
    }

    // Crop reuses the box-drawing drag: same rubber band, different commit.
    // It needs no active class, because it is not creating an annotation.
    if (tool === "bbox" || tool === "crop") {
      if (tool === "bbox" && !activeClassId) return;
      dragRef.current = { type: "draw-bbox", startX: clamp01(nx), startY: clamp01(ny) };
      setDraftRect({ x: clamp01(nx), y: clamp01(ny), w: 0, h: 0 });
      return;
    }

    if (tool === "polygon") {
      if (!activeClassId) return;
      const draft = polyDraft;
      if (draft.length >= 3) {
        const [fx, fy] = draft[0];
        const dx = (nx - fx) * imgSize.W * view.scale;
        const dy = (ny - fy) * imgSize.H * view.scale;
        if (Math.hypot(dx, dy) <= POLY_CLOSE_PX) {
          closePolygon();
          return;
        }
      }
      setPolyDraft([...draft, [clamp01(nx), clamp01(ny)]]);
      return;
    }

    // Select tool
    if (selected && selected.kind !== "classification") {
      const h = hitHandle(selected, e.clientX, e.clientY);
      if (h?.kind === "handle") {
        dragRef.current = {
          type: "resize", clientId: selected.clientId, handle: h.id,
          before: annotations, orig: selected, moved: false,
        };
        return;
      }
      if (h?.kind === "vertex") {
        dragRef.current = {
          type: "vertex", clientId: selected.clientId, index: h.index,
          before: annotations, moved: false,
        };
        return;
      }
    }
    const hit = hitTest(annotations, nx, ny);
    if (hit) {
      setSelectedId(hit.clientId);
      dragRef.current = {
        type: "move", clientId: hit.clientId, startPx: nx, startPy: ny,
        before: annotations, orig: hit, moved: false,
      };
    } else {
      setSelectedId(null);
    }
  };

  const onCanvasMouseMove = (e: RMouseEvent<HTMLDivElement>) => {
    if (!imgSize) return;
    if (tool === "bbox" || tool === "polygon") {
      const [nx, ny] = toImagePoint(e.clientX, e.clientY);
      setCursorPos([clamp01(nx), clamp01(ny)]);
    }
    if (tool === "select" && !dragRef.current) {
      const [nx, ny] = toImagePoint(e.clientX, e.clientY);
      let c = "default";
      if (selected && selected.kind !== "classification") {
        const h = hitHandle(selected, e.clientX, e.clientY);
        if (h) c = h.kind === "handle" ? handleCursor(h.id) : "move";
      }
      if (c === "default" && hitTest(annotations, nx, ny)) c = "move";
      setHoverCursor(c);
    }
  };

  const onCanvasDoubleClick = () => {
    if (tool === "polygon" && latest.current.polyDraft.length >= 3) closePolygon();
  };

  // Window-level move/up so drags keep working outside the canvas.
  const onWinMouseMove = useCallback(
    (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.type === "pan") {
        setView((v) => ({
          ...v,
          tx: d.startTx + e.clientX - d.startX,
          ty: d.startTy + e.clientY - d.startY,
        }));
        return;
      }
      const L = latest.current;
      if (!L.imgSize) return;
      const [rx, ry] = toImagePoint(e.clientX, e.clientY);
      const nx = clamp01(rx);
      const ny = clamp01(ry);

      if (d.type === "paint") {
        const buf = liveBufRef.current;
        if (!buf) return;
        const { W: mw, H: mh } = L.imgSize;
        const px = nx * mw;
        const py = ny * mh;
        // Interpolate from the previous sample: mouse-move fires every ~8-16ms,
        // so a quick drag skips tens of pixels and stamping only at the sampled
        // points would leave a dotted line.
        stampLine(buf, mw, mh, d.lastPx, d.lastPy, px, py, brushSize / 2, d.erase ? 0 : 1);
        d.lastPx = px;
        d.lastPy = py;
        d.painted = true;
        // Only the version counter goes through React; the buffer is mutated
        // in place via the ref.
        setLiveVersion((v) => v + 1);
        return;
      }
      if (d.type === "draw-bbox") {
        setDraftRect(rectFromPoints(d.startX, d.startY, nx, ny));
        setCursorPos([nx, ny]);
      } else if (d.type === "move") {
        d.moved = true;
        setAnnotations((prev) =>
          prev.map((a) =>
            a.clientId === d.clientId ? moveShape(d.orig, rx - d.startPx, ry - d.startPy) : a
          )
        );
      } else if (d.type === "resize") {
        d.moved = true;
        setAnnotations((prev) =>
          prev.map((a) =>
            a.clientId === d.clientId ? { ...a, ...resizeBBox(d.orig, d.handle, nx, ny) } : a
          )
        );
      } else if (d.type === "vertex") {
        d.moved = true;
        setAnnotations((prev) =>
          prev.map((a) => {
            if (a.clientId !== d.clientId || !a.points) return a;
            const pts = a.points.slice();
            pts[d.index] = [nx, ny];
            return { ...a, points: pts };
          })
        );
      }
    },
    [toImagePoint]
  );

  const onWinMouseUp = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.type === "pan") {
      setPanning(false);
      return;
    }

    // Encode the stroke once, on release — not per stamp. RLE encoding walks
    // every pixel, so doing it during the drag would stall the brush.
    if (d.type === "paint") {
      const L = latest.current;
      const buf = liveBufRef.current;
      liveBufRef.current = null;
      setLiveVersion((v) => v + 1);
      if (!buf || !L.imgSize || !d.painted) return;

      const { W: mw, H: mh } = L.imgSize;
      const emptyNow = bufferIsEmpty(buf);

      if (d.targetId) {
        // Erasing a mask down to nothing removes the annotation rather than
        // leaving an invisible zero-area row behind.
        if (emptyNow) {
          commitChange((prev) => prev.filter((a) => a.clientId !== d.targetId));
          setSelectedId(null);
          return;
        }
        const rle = maskToRle(buf, mh, mw);
        commitChange((prev) =>
          prev.map((a) => (a.clientId === d.targetId ? { ...a, mask: rle } : a))
        );
        return;
      }

      // A brand-new mask. A stroke that painted nothing (entirely off-image)
      // is discarded instead of creating an empty annotation.
      if (emptyNow || !L.activeClassId) return;
      const ann: LocalAnnotation = {
        clientId: newClientId(),
        serverId: null,
        class_id: L.activeClassId,
        kind: "mask",
        x: null, y: null, w: null, h: null, points: null,
        mask: maskToRle(buf, mh, mw),
      };
      commitChange((prev) => [...prev, ann]);
      setSelectedId(ann.clientId);
      return;
    }

    if (d.type === "draw-bbox") {
      const L = latest.current;
      const r = L.draftRect;
      setDraftRect(null);
      if (!r || !L.imgSize) return;
      // Only act on boxes that are more than a slip of the mouse.
      if (r.w * L.imgSize.W * L.view.scale <= MIN_DRAW_PX) return;
      if (r.h * L.imgSize.H * L.view.scale <= MIN_DRAW_PX) return;
      // Crop never commits straight from the drag: it rewrites stored pixels,
      // so it goes through an explicit confirmation first.
      if (L.tool === "crop") {
        setPendingCrop(r);
        return;
      }
      if (!L.activeClassId) return;
      const ann: LocalAnnotation = {
        clientId: newClientId(),
        serverId: null,
        class_id: L.activeClassId,
        kind: "bbox",
        x: r.x, y: r.y, w: r.w, h: r.h,
        points: null,
      };
      commitChange((prev) => [...prev, ann]);
      setSelectedId(ann.clientId);
      return;
    }
    if (d.moved) {
      historyCommit(d.before);
      setDirty(true);
    }
  }, [commitChange, historyCommit]);

  useEffect(() => {
    window.addEventListener("mousemove", onWinMouseMove);
    window.addEventListener("mouseup", onWinMouseUp);
    return () => {
      window.removeEventListener("mousemove", onWinMouseMove);
      window.removeEventListener("mouseup", onWinMouseUp);
    };
  }, [onWinMouseMove, onWinMouseUp]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────

  const actionsRef = useRef({
    saveNow, goPrev, goNext, doUndo, doRedo, deleteSelected, cancelOrDeselect,
    fitToContainer, zoomAtCenter, selectClass, toggleClassification, closePolygon,
    resetZoom, copyPreviousLabels, resetDisplay,
  });
  actionsRef.current = {
    saveNow, goPrev, goNext, doUndo, doRedo, deleteSelected, cancelOrDeselect,
    fitToContainer, zoomAtCenter, selectClass, toggleClassification, closePolygon,
    resetZoom, copyPreviousLabels, resetDisplay,
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
      ) {
        return;
      }
      const A = actionsRef.current;
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) setSpaceHeld(true);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "s") { e.preventDefault(); void A.saveNow(); }
        else if (k === "z") { e.preventDefault(); if (e.shiftKey) A.doRedo(); else A.doUndo(); }
        else if (k === "y") { e.preventDefault(); A.doRedo(); }
        return;
      }
      // "?" is Shift+/ on most layouts and arrives as e.key already resolved,
      // so it is matched before the digit/class handling below rather than in
      // the switch (where a Shift-modified key would be ambiguous).
      if (e.key === "?") {
        e.preventDefault();
        setShowHelp(true);
        return;
      }
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit) {
        const cls = latest.current.classes[Number(digit[1]) - 1];
        if (cls) {
          if (e.shiftKey) A.toggleClassification(cls.id);
          else A.selectClass(cls.id);
        }
        return;
      }
      switch (e.key) {
        case "v": case "V": setTool("select"); break;
        case "b": case "B": setTool("bbox"); break;
        case "p": case "P": setTool("polygon"); break;
        case "h": case "H": setTool("pan"); break;
        case "x": case "X": setTool("crop"); break;
        case "g": case "G": setTool("brush"); break;
        case "e": case "E": setTool("eraser"); break;
        // Brush size, matching the bracket keys every raster editor uses.
        case "[": setBrushSize((b) => Math.max(2, Math.round(b * 0.8))); break;
        case "]": setBrushSize((b) => Math.min(400, Math.round(b * 1.25))); break;
        case "f": case "F": A.fitToContainer(); break;
        // Review verdicts. saveNow(status) persists the annotations and sets
        // the image's state in one round trip, so approving never loses an
        // edit made a moment earlier.
        case "a": case "A": e.preventDefault(); void A.saveNow("approved"); break;
        case "r": case "R": e.preventDefault(); void A.saveNow("rejected"); break;
        // Toggle overlays to check a box against the pixels underneath.
        case "t": case "T": setShowAnnotations((s) => !s); break;
        case "l": case "L": setZoomLocked((s) => !s); break;
        case "0": A.resetZoom(); break;
        // Copy the previous image's labels onto this one (adds, undoable).
        case "c": case "C": e.preventDefault(); void A.copyPreviousLabels(); break;
        // Clear brightness/contrast back to normal.
        case "d": case "D": A.resetDisplay(); break;
        case "ArrowLeft": e.preventDefault(); A.goPrev(); break;
        case "ArrowRight": e.preventDefault(); A.goNext(); break;
        case "Delete": case "Backspace": e.preventDefault(); A.deleteSelected(); break;
        case "Escape": A.cancelOrDeselect(); break;
        case "Enter":
          if (latest.current.polyDraft.length >= 3) A.closePolygon();
          break;
        case "+": case "=": A.zoomAtCenter(1.25); break;
        case "-": case "_": A.zoomAtCenter(0.8); break;
        default: break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    const onBlur = () => {
      setSpaceHeld(false);
      setPanning(false);
      dragRef.current = null;
      // Abandon any in-progress draw — a draft left behind after alt-tabbing
      // mid-drag would otherwise be stuck on the canvas.
      setDraftRect(null);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // ── Autosave / unload guard ────────────────────────────────────────────

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      void saveNow();
    }, 1500);
    return () => clearTimeout(t);
  }, [dirty, annotations, saveNow]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (latest.current.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  // ── Filmstrip ──────────────────────────────────────────────────────────

  const changeFilter = useCallback((f: QueueFilter) => {
    if (f === latest.current.queueFilter) return;
    setQueueFilter(f);
    latest.current.queueFilter = f;
    // Only the queue reloads. The image on screen stays exactly as it is —
    // prev/next now come from the queue (see `neighbours`), so there is
    // nothing left to re-fetch it for.
    //
    // The save must COMPLETE before the queue is queried, not merely be
    // started. Saving is what moves this image from "unannotated" to
    // "annotated"; firing both in parallel races the commit, and the queue
    // usually wins — so you click "Annotated" immediately after drawing and
    // get "No images match this filter" while the sidebar already counts 1.
    // The summary refreshes after the save and disagrees with the strip,
    // which reads as data loss rather than a race.
    void (async () => {
      if (latest.current.dirty) {
        try { await saveNow(); } catch { /* surfaced by the save indicator */ }
      }
      await loadQueue(f, 0).catch(() => {});
    })();
  }, [loadQueue, saveNow]);

  /** Counts for the filter chips. Memoised so a new object each render does
   *  not invalidate Filmstrip's memo. */
  const filterCounts = useMemo(
    () => ({
      all: summary?.total,
      unannotated: summary?.unannotated,
      annotated: summary?.annotated,
      approved: summary?.approved,
      rejected: summary?.rejected,
    }),
    [summary]
  );

  /** Stable identity for the strip's click handler — an inline arrow would
   *  change every render and make memo useless. */
  const selectFromStrip = useCallback((assetId: string) => { void goTo(assetId); }, [goTo]);

  // Stable identity (reads current values from the `latest` ref rather than
  // closing over them) so passing it to the memoised Filmstrip does not cause
  // a re-render on every parent update.
  const onStripScroll = useCallback((e: RUIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollLeft + el.clientWidth < el.scrollWidth - 60) return;
    const L = latest.current;
    if (loadMoreRef.current || L.queue.length >= L.queueTotal) return;
    loadMoreRef.current = true;
    loadQueue(L.queueFilter, L.queue.length)
      .catch(() => {})
      .finally(() => {
        loadMoreRef.current = false;
      });
  }, [loadQueue]);

  // Keep the current thumbnail visible.
  useEffect(() => {
    if (!currentAssetId) return;
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-asset="${currentAssetId}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [currentAssetId, queue.length]);

  // ── Header actions ─────────────────────────────────────────────────────

  const changeSplit = async (v: string) => {
    if (!imgData) return;
    const split = (v || null) as Split | null;
    try {
      const res = await annotationApi.setImageState(dsId, imgData.asset.id, { split });
      setImgData((prev) => (prev ? { ...prev, split: res.data.split } : prev));
      setQueue((prev) =>
        prev.map((q) => (q.asset_id === imgData.asset.id ? { ...q, split: res.data.split } : q))
      );
      refreshSummary();
    } catch {
      alert("Failed to set split");
    }
  };

  // ── Class CRUD ─────────────────────────────────────────────────────────

  const addClass = async () => {
    const name = newClassName.trim();
    if (!name) return;
    try {
      const res = await annotationApi.createClass(dsId, { name });
      setClasses((prev) => [...prev, res.data]);
      setActiveClassId(res.data.id);
      setNewClassName("");
      refreshSummary();
    } catch {
      alert("Failed to add class");
    }
  };

  const renameClass = async (cls: AnnotationClass) => {
    const name = prompt("Rename class", cls.name)?.trim();
    if (!name || name === cls.name) return;
    try {
      const res = await annotationApi.updateClass(dsId, cls.id, { name });
      setClasses((prev) => prev.map((c) => (c.id === cls.id ? res.data : c)));
      refreshSummary();
    } catch {
      alert("Failed to rename class");
    }
  };

  const removeClass = async (cls: AnnotationClass) => {
    if (!confirm(`Delete class "${cls.name}"? Its annotations will be removed.`)) return;
    try {
      await annotationApi.deleteClass(dsId, cls.id);
      const remaining = classes.filter((c) => c.id !== cls.id);
      setClasses(remaining);
      setAnnotations((prev) => prev.filter((a) => a.class_id !== cls.id));
      historyReset(); // stale snapshots could resurrect the deleted class
      if (activeClassId === cls.id) setActiveClassId(remaining[0]?.id ?? null);
      setSelectedId(null);
      refreshSummary();
    } catch {
      alert("Failed to delete class");
    }
  };

  // ── Render helpers (SVG) ───────────────────────────────────────────────

  const s = view.scale;
  const W = imgSize?.W ?? 0;
  const H = imgSize?.H ?? 0;

  const renderLabel = (px: number, py: number, name: string, color: string) => {
    const fh = 15 / s;
    const fs = 10.5 / s;
    const w = (name.length * 6.2 + 10) / s;
    const above = py - fh - 2 / s;
    const ly = above < 0 ? py + 2 / s : above;
    return (
      <g pointerEvents="none">
        <rect x={px} y={ly} width={w} height={fh} rx={3 / s} fill={color} />
        <text x={px + 5 / s} y={ly + fh - 4.5 / s} fontSize={fs} fill="#fff" fontWeight={600}>
          {name}
        </text>
      </g>
    );
  };

  const renderShape = (a: LocalAnnotation, isSelected: boolean) => {
    const color = clsColor(a.class_id);
    const dash = isSelected ? `${6 / s} ${4 / s}` : undefined;
    if (a.kind === "bbox" && a.x != null && a.y != null && a.w != null && a.h != null) {
      return (
        <g key={a.clientId}>
          <rect
            x={a.x * W} y={a.y * H} width={a.w * W} height={a.h * H}
            fill={color} fillOpacity={0.18}
            stroke={color} strokeWidth={isSelected ? 2 : 1.5}
            strokeDasharray={dash} vectorEffect="non-scaling-stroke"
          />
          {renderLabel(a.x * W, a.y * H, clsName(a.class_id), color)}
        </g>
      );
    }
    if (a.kind === "polygon" && a.points && a.points.length >= 3) {
      const b = shapeBounds(a);
      const pts = a.points.map(([px, py]) => `${px * W},${py * H}`).join(" ");
      return (
        <g key={a.clientId}>
          <polygon
            points={pts}
            fill={color} fillOpacity={0.18}
            stroke={color} strokeWidth={isSelected ? 2 : 1.5}
            strokeDasharray={dash} vectorEffect="non-scaling-stroke"
          />
          {renderLabel(b.x * W, b.y * H, clsName(a.class_id), color)}
        </g>
      );
    }
    return null;
  };

  const renderHandles = (a: LocalAnnotation) => {
    const color = clsColor(a.class_id);
    const hs = 8 / s;
    if (a.kind === "bbox" && a.x != null && a.y != null && a.w != null && a.h != null) {
      return HANDLE_IDS.map((id) => {
        const [hx, hy] = handlePoint(a.x as number, a.y as number, a.w as number, a.h as number, id);
        return (
          <rect
            key={id}
            x={hx * W - hs / 2} y={hy * H - hs / 2} width={hs} height={hs} rx={1.5 / s}
            fill="#fff" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke"
          />
        );
      });
    }
    if (a.kind === "polygon" && a.points) {
      return a.points.map((p, i) => (
        <circle
          key={i}
          cx={p[0] * W} cy={p[1] * H} r={4.5 / s}
          fill="#fff" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke"
        />
      ));
    }
    return null;
  };

  // ── Early exits ────────────────────────────────────────────────────────

  if (!dsId) return null;

  if (noImages) {
    return (
      <div className="ann-editor ann-editor--empty">
        <header className="ann-header">
          <Link to="/annotate" className="ann-header__back">&larr; Annotate</Link>
          <div className="ann-header__name">{datasetName || "Dataset"}</div>
        </header>
        <div className="empty-state" style={{ margin: "auto" }}>
          <h3>No images in this dataset</h3>
          <p>Add images to the dataset first, then come back to annotate them.</p>
          <Link to="/images" className="btn btn--primary" style={{ marginTop: 16, display: "inline-block" }}>
            Go to Image Pipeline
          </Link>
        </div>
      </div>
    );
  }

  const canvasCursor = panning
    ? "grabbing"
    : spaceHeld || tool === "pan"
      ? "grab"
      : tool === "bbox" || tool === "polygon" || tool === "crop"
        ? "crosshair"
        // Crosshair for paint tools too. A true brush-sized ring cursor would
        // need a generated SVG cursor that tracks both brush size and zoom;
        // the size readout in the zoom bar covers it for now.
        : tool === "brush" || tool === "eraser"
          ? "crosshair"
          : hoverCursor;

  const imgUrl = imgData ? imgData.asset.original_url || imgData.asset.thumbnail_url || "" : "";
  const saveLabel = saving ? "Saving…" : dirty ? "Unsaved •" : "Saved ✓";
  const saveMod = saving ? "saving" : dirty ? "dirty" : "saved";
  const position =
    queueIndex >= 0 ? `${queueIndex + 1} / ${queueTotal}` : `— / ${queueTotal}`;

  // `key` is rendered under each icon. An icon rail is only self-explanatory to
  // someone who already knows the tools; the letter is the part you can act on
  // without hovering, and it teaches the shortcut at the moment you reach for
  // the mouse instead of in a help sheet you have to go and open.
  const TOOL_BUTTONS: { id: Tool; label: string; key: string; icon: ReactNode }[] = [
    { id: "select", label: "Select / move", key: "V", icon: ICONS.select },
    { id: "bbox", label: "Bounding box", key: "B", icon: ICONS.bbox },
    { id: "polygon", label: "Polygon", key: "P", icon: ICONS.polygon },
    { id: "pan", label: "Pan the canvas", key: "H", icon: ICONS.pan },
    { id: "crop", label: "Crop — replaces the stored image", key: "X", icon: ICONS.crop },
    { id: "brush", label: "Brush — paint a segmentation mask", key: "G", icon: ICONS.brush },
    { id: "eraser", label: "Eraser — erase from a mask", key: "E", icon: ICONS.eraser },
  ];

  return (
    <div className="ann-editor">
      {/* ── Header ── */}
      <header className="ann-header">
        <Link to="/annotate" className="ann-header__back">&larr; Annotate</Link>
        <div className="ann-header__name" title={datasetName}>{datasetName || "…"}</div>
        {/* Second spacer. With only the one further down, everything was pinned
            to the two edges and the navigation sat cramped on the left with the
            whole middle of the header empty. A spacer either side centres the
            controls you actually use while labelling. */}
        <div className="ann-header__spacer" />
        <div className="ann-header__nav">
          {/* Prev stays an icon; Next is labelled and accented.
              They are not equally important. In an annotation loop you label an
              image and move FORWARD — "next" is the most-pressed control in the
              whole tool, and it was a 24px box holding a &rsaquo;, a glyph
              barely larger than a comma. Going back is the rare correction, so
              it keeps the compact icon and Next gets the weight. */}
          <button
            className="ann-navbtn" title="Previous image (←)"
            onClick={goPrev} disabled={!neighbours.prev}
            aria-label="Previous image"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <span className="ann-header__pos">{position}</span>
          <button
            className="ann-navbtn ann-navbtn--next" title="Next image (→)"
            onClick={goNext} disabled={!neighbours.next}
          >
            Next
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
          {/* Type a position and press Enter. Arrows are fine for neighbours
              but useless for "back to around image 400 of 900". */}
          <input
            className="ann-header__jump"
            type="number"
            min={1}
            max={queue.length || 1}
            placeholder="#"
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const n = Number(jumpValue);
              if (Number.isFinite(n) && n >= 1) {
                jumpToIndex(n);
                setJumpValue("");
                // Return focus to the canvas so the single-key shortcuts work
                // again — they are ignored while an input has focus.
                (e.target as HTMLInputElement).blur();
              }
            }}
            title="Jump to image number (Enter)"
            disabled={queue.length === 0}
          />
        </div>
        <span className={`ann-save ann-save--${saveMod}`}>{saveLabel}</span>
        {imgData && (
          <span className={`ann-status ann-status--${imgData.status}`}>
            {STATUS_LABEL[imgData.status]}
          </span>
        )}
        <div className="ann-header__spacer" />
        <label className="ann-header__split">
          Split
          <select
            value={imgData?.split ?? ""}
            onChange={(e) => void changeSplit(e.target.value)}
            disabled={!imgData}
          >
            <option value="">—</option>
            <option value="train">train</option>
            <option value="valid">valid</option>
            <option value="test">test</option>
          </select>
        </label>
        <button
          className="btn btn--sm btn--secondary ann-approve"
          onClick={() => void saveNow("approved")} disabled={!imgData}
          title="Save and mark this image approved"
        >Approve</button>
        <button
          className="btn btn--sm btn--secondary ann-reject"
          onClick={() => void saveNow("rejected")} disabled={!imgData}
          title="Save and mark this image rejected"
        >Reject</button>
        {/* Dataset-level actions, separated from the per-image ones to its
            left. "Approve" and "Approve all" sitting shoulder to shoulder is a
            misclick waiting to happen, and only one of them is reversible. */}
        <span className="ann-header__div" aria-hidden="true" />
        <button
          className="ann-approveall"
          onClick={() => void approveAll()}
          disabled={(summary?.annotated ?? 0) === 0}
          title={
            (summary?.annotated ?? 0) > 0
              ? `Approve all ${summary?.annotated} annotated images`
              : "Nothing annotated is waiting for approval"
          }
        >
          Approve all ({summary?.annotated ?? 0})
        </button>
        <button
          className="ann-helpbtn"
          onClick={() => setShowHelp(true)}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >?</button>
        <button className="btn btn--sm btn--primary" onClick={() => setShowExport(true)}>
          Export
        </button>
      </header>

      {/* VISUAL ORDER IS SET IN CSS, NOT HERE.
          Layout is: classes panel (left) → resizer → canvas → tool rail (right).
          Classes sit left because they are read constantly; tools sit right,
          under the hand that reaches for them. Both used to be crowded on the
          left, which left the middle of the window empty and squeezed the
          image.

          `order` on .ann-side/.ann-resizer/.ann-center/.ann-toolbar does the
          rearranging so this 1600-line file did not need its JSX shuffled —
          a change with real regression risk and no test coverage to catch it.
          The cost is that DOM order (tools, canvas, panel) no longer matches
          visual order, so keyboard tab order differs from what you see. Low
          impact for a canvas tool driven by shortcuts, but worth fixing by
          moving the JSX if this file is ever refactored. */}
      <div className="ann-body">
        {/* ── Tool rail (rendered here, displayed right) ── */}
        <div className="ann-toolbar">
          {TOOL_BUTTONS.map((t) => (
            <button
              key={t.id}
              className={`ann-tool ${tool === t.id ? "ann-tool--active" : ""}`}
              title={`${t.label} (${t.key})`}
              aria-label={t.label}
              aria-pressed={tool === t.id}
              onClick={() => setTool(t.id)}
            >
              {t.icon}
              <span className="ann-tool__key" aria-hidden="true">{t.key}</span>
            </button>
          ))}
          <div className="ann-toolbar__sep" />
          {/* Overlay visibility lives with the tools, not the zoom bar: it
              changes what you are editing, not how you are looking at it. */}
          <button
            className={`ann-tool ${showAnnotations ? "" : "ann-tool--off"}`}
            title={showAnnotations ? "Hide annotations (T)" : "Show annotations (T)"}
            aria-label={showAnnotations ? "Hide annotations" : "Show annotations"}
            aria-pressed={!showAnnotations}
            onClick={() => setShowAnnotations((v) => !v)}
          >
            {showAnnotations ? ICONS.eyeOn : ICONS.eyeOff}
            <span className="ann-tool__key" aria-hidden="true">T</span>
          </button>
        </div>

        {/* Drag to rebalance panel vs canvas. */}
        <div
          className="ann-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          onMouseDown={startResize}
          onDoubleClick={() => setSideWidth(300)}
          title="Drag to resize · double-click to reset"
        />

        {/* ── Center: classification bar + canvas + zoom bar ── */}
        <div className="ann-center">
          {classes.length > 0 && (
            <div className="ann-clsbar">
              <span className="ann-clsbar__label">Labels</span>
              {classes.map((c) => {
                const on = classifications.some((a) => a.class_id === c.id);
                return (
                  <button
                    key={c.id}
                    className={`ann-clsbar__pill ${on ? "ann-clsbar__pill--on" : ""}`}
                    style={on ? { background: c.color, borderColor: c.color } : { borderColor: c.color }}
                    onClick={() => toggleClassification(c.id)}
                    title={`Toggle classification label (Shift+${classes.indexOf(c) + 1 <= 9 ? classes.indexOf(c) + 1 : "…"})`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}

          <div
            ref={containerRef}
            className="ann-canvas"
            style={{ cursor: canvasCursor }}
            onMouseDown={onCanvasMouseDown}
            onMouseMove={onCanvasMouseMove}
            onMouseLeave={() => setCursorPos(null)}
            onDoubleClick={onCanvasDoubleClick}
          >
            <div
              ref={stageRef}
              className="ann-stage"
              style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${s})` }}
            >
              {imgUrl && (
                <img
                  key={currentAssetId ?? "none"}
                  src={imgUrl}
                  alt={imgData?.asset.file_name ?? ""}
                  draggable={false}
                  // Filter is on the image only — the SVG overlay is a sibling,
                  // so annotation colours stay true while the photo is adjusted.
                  style={imgFilter ? { filter: imgFilter } : undefined}
                  {...(imgSize ? { width: W, height: H } : {})}
                  onLoad={(e) => {
                    setImgReady(true);
                    if (!latest.current.imgSize) {
                      const el = e.currentTarget;
                      if (el.naturalWidth && el.naturalHeight) {
                        setImgSize({ W: el.naturalWidth, H: el.naturalHeight });
                      }
                    }
                  }}
                  onError={() => setImgError(true)}
                />
              )}

              {/* Masks render below the vector overlay so boxes and polygons
                  stay visible on top of a painted region. Separate element
                  rather than a sibling inside the overlay's conditional: this
                  is a <canvas>, the overlay is an <svg>, and they need
                  different sizing. */}
              {imgSize && (
                <MaskLayer
                  width={W}
                  height={H}
                  shapes={maskShapes}
                  liveBuffer={liveBufRef.current}
                  liveColor={liveColor}
                  liveVersion={liveVersion}
                  visible={showAnnotations}
                />
              )}

              {imgSize && (
                <svg
                  className="ann-overlay"
                  viewBox={`0 0 ${W} ${H}`}
                  width={W}
                  height={H}
                  // Hidden rather than unmounted: the draft shape being drawn
                  // and the drag handles live in this same <svg>, and tearing
                  // them out mid-interaction would abort an in-progress draw.
                  style={showAnnotations ? undefined : { opacity: 0, pointerEvents: "none" }}
                >
                  {/* committed shapes: big → small so small ones sit on top */}
                  {sortedShapes
                    .filter((a) => a.clientId !== selectedId)
                    .map((a) => renderShape(a, false))}
                  {selected && selected.kind !== "classification" && renderShape(selected, true)}
                  {selected && selected.kind !== "classification" && renderHandles(selected)}

                  {/* crosshair guides while a draw tool is active */}
                  {(tool === "bbox" || tool === "polygon") && cursorPos && !draftRect && (
                    <g>
                      <line
                        x1={0} y1={cursorPos[1] * H} x2={W} y2={cursorPos[1] * H}
                        stroke="#f97316" strokeOpacity={0.45} strokeWidth={1}
                        strokeDasharray={`${4 / s} ${4 / s}`} vectorEffect="non-scaling-stroke"
                      />
                      <line
                        x1={cursorPos[0] * W} y1={0} x2={cursorPos[0] * W} y2={H}
                        stroke="#f97316" strokeOpacity={0.45} strokeWidth={1}
                        strokeDasharray={`${4 / s} ${4 / s}`} vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  )}

                  {/* bbox draft */}
                  {draftRect && activeClass && (
                    <rect
                      x={draftRect.x * W} y={draftRect.y * H}
                      width={draftRect.w * W} height={draftRect.h * H}
                      fill={activeClass.color} fillOpacity={0.12}
                      stroke={activeClass.color} strokeWidth={1.5}
                      strokeDasharray={`${5 / s} ${3 / s}`} vectorEffect="non-scaling-stroke"
                    />
                  )}

                  {/* polygon draft */}
                  {polyDraft.length > 0 && activeClass && (
                    <g>
                      <polyline
                        points={polyDraft.map(([px, py]) => `${px * W},${py * H}`).join(" ")}
                        fill="none" stroke={activeClass.color} strokeWidth={1.5}
                        vectorEffect="non-scaling-stroke"
                      />
                      {cursorPos && (
                        <line
                          x1={polyDraft[polyDraft.length - 1][0] * W}
                          y1={polyDraft[polyDraft.length - 1][1] * H}
                          x2={cursorPos[0] * W} y2={cursorPos[1] * H}
                          stroke={activeClass.color} strokeWidth={1.5}
                          strokeDasharray={`${4 / s} ${3 / s}`} vectorEffect="non-scaling-stroke"
                        />
                      )}
                      {polyDraft.map((p, i) => (
                        <circle
                          key={i}
                          cx={p[0] * W} cy={p[1] * H}
                          r={(i === 0 ? 5 : 3) / s}
                          fill={i === 0 ? "#fff" : activeClass.color}
                          stroke={activeClass.color} strokeWidth={1.5}
                          vectorEffect="non-scaling-stroke"
                        />
                      ))}
                    </g>
                  )}
                </svg>
              )}
            </div>

            {/* guard: no classes yet */}
            {bootstrapped && classes.length === 0 && !imgLoading && (
              <div className="ann-guard">
                <div className="ann-guard__box">
                  <div className="ann-guard__title">Add a class to start annotating</div>
                  {/* Arrow leads, pointing LEFT: the classes panel moved to the
                      left side, and this hint still nudged users to the right —
                      straight at the tool rail. */}
                  <div className="ann-guard__hint">
                    <span className="ann-guard__arrow">&larr;</span> Use the &quot;New class name&quot; field in the panel
                  </div>
                </div>
              </div>
            )}

            {/* Coach strip. pointer-events:none on the wrapper so it can sit
                over the canvas without intercepting a drag that starts
                underneath it — the hint tells you to draw, so it must not be
                the thing preventing you. Only the dismiss button takes
                pointer events back. */}
            {coach && (
              <div className="ann-coach" key={coach.id}>
                <div className="ann-coach__box">
                  <span className="ann-coach__text">
                    Press <kbd className="ann-kbd">{coach.key}</kbd> {coach.text}
                  </span>
                  <button
                    className="ann-coach__x"
                    onClick={dismissGuide}
                    title="Hide tips for this dataset"
                    aria-label="Hide tips"
                  >
                    &times;
                  </button>
                </div>
              </div>
            )}

            {/* loading / error */}
            {(imgLoading || (!!imgUrl && !imgReady && !imgError)) && (
              <div className="ann-canvas__loading">
                <span className="ann-spinner" />
              </div>
            )}
            {imgError && (
              <div className="ann-canvas__loading ann-canvas__loading--error">
                Failed to load image
              </div>
            )}
            {!bootstrapped && (
              <div className="ann-canvas__loading">
                <span className="ann-spinner" />
              </div>
            )}
          </div>

          {/* ── Zoom bar ──
              Moved off the tool rail and under the canvas: zoom is a property
              of the view, not a drawing tool, and the percentage belongs next
              to the controls that change it. */}
          <div className="ann-zoombar">
            <button className="ann-zbtn" title="Zoom out (−)" onClick={() => zoomAtCenter(0.8)}>−</button>
            {/* The percentage doubles as the reset control: clicking a zoom
                readout to return to 100% is the convention, and it removes a
                separate button from a bar that had grown to eight of them. */}
            <button
              className="ann-zoombar__pct"
              title="Click for actual size, 100% (0)"
              onClick={resetZoom}
            >
              {Math.round(s * 100)}%
            </button>
            <button className="ann-zbtn" title="Zoom in (+)" onClick={() => zoomAtCenter(1.25)}>+</button>
            <div className="ann-zoombar__sep" />
            <button className="ann-zbtn ann-zbtn--wide" title="Fit to screen (F)" onClick={fitToContainer}>Fit</button>
            {/* Icon-only: the label was the widest thing in the bar, and the
                state is already obvious from the icon plus the active style. */}
            <button
              className={`ann-zbtn ${zoomLocked ? "ann-zbtn--on" : ""}`}
              title={
                zoomLocked
                  ? "Zoom locked — this view is kept when you change image (L)"
                  : "Lock zoom — keep this view when changing image (L)"
              }
              onClick={() => setZoomLocked((v) => !v)}
            >
              {zoomLocked ? "🔒" : "🔓"}
            </button>

            {/* Brush size, shown only while a paint tool is active so the bar
                stays quiet the rest of the time. Bracket keys adjust it too. */}
            {(tool === "brush" || tool === "eraser") && (
              <>
                <div className="ann-zoombar__sep" />
                <label className="ann-brushsize" title="Brush size in image pixels ( [ and ] )">
                  <span>{tool === "eraser" ? "Eraser" : "Brush"}</span>
                  <input
                    type="range" min={2} max={200} step={1}
                    value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                  />
                  <b>{brushSize}px</b>
                </label>
              </>
            )}

            <div className="ann-zoombar__sep" />

            {/* Display adjustments. Popover rather than always-on sliders: they
                are reached occasionally, and two permanent sliders would eat
                the bar for a control most sessions never touch. */}
            <div className="ann-display">
              <button
                className={`ann-zbtn ann-zbtn--wide ${displayAdjusted ? "ann-zbtn--on" : ""}`}
                title="Brightness and contrast (viewing only — the image is not modified)"
                onClick={() => setShowDisplay((v) => !v)}
              >
                Display{displayAdjusted ? " •" : ""}
              </button>
              {showDisplay && (
                <div className="ann-display__pop">
                  <label className="ann-display__row">
                    <span>Brightness</span>
                    <input
                      type="range" min={20} max={250} step={1}
                      value={brightness}
                      onChange={(e) => setBrightness(Number(e.target.value))}
                    />
                    <b>{brightness}%</b>
                  </label>
                  <label className="ann-display__row">
                    <span>Contrast</span>
                    <input
                      type="range" min={20} max={250} step={1}
                      value={contrast}
                      onChange={(e) => setContrast(Number(e.target.value))}
                    />
                    <b>{contrast}%</b>
                  </label>
                  <div className="ann-display__foot">
                    <span className="ann-display__note">Viewing only — pixels are unchanged.</span>
                    <button className="ann-zbtn" onClick={resetDisplay} title="Reset (D)">Reset</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Class / annotation panel (rendered here, displayed LEFT) ── */}
        <aside className="ann-side" style={{ flexBasis: sideWidth, width: sideWidth }}>
          {/* First-run guide. Every tick is derived from real state, and the
              whole block removes itself once the four steps are done — so a
              returning user pays nothing for it. */}
          {!guideDismissed && (
            <LaunchGuide
              hasClass={guide.hasClass}
              hasAnnotation={guide.hasAnnotation}
              hasSaved={guide.hasSaved}
              hasApproved={guide.hasApproved}
              onDismiss={dismissGuide}
              onShowShortcuts={openShortcuts}
            />
          )}

          {/* Classes */}
          <div className="ann-side__section">
            <div className="ann-side__title">Classes</div>
            <div className="ann-classes">
              {classes.map((c, i) => (
                <div
                  key={c.id}
                  className={`ann-class ${activeClassId === c.id ? "ann-class--active" : ""}`}
                  onClick={() => selectClass(c.id)}
                  title={selected ? "Set active class and reassign selection" : "Set active class"}
                >
                  <span className="ann-class__dot" style={{ background: c.color }} />
                  <span className="ann-class__name">{c.name}</span>
                  {i < 9 && <kbd className="ann-kbd">{i + 1}</kbd>}
                  <span className="ann-class__count">{perClassCount.get(c.id) || 0}</span>
                  <span className="ann-class__actions">
                    <button
                      title="Rename class"
                      onClick={(e) => { e.stopPropagation(); void renameClass(c); }}
                    >{ICONS.pencil}</button>
                    <button
                      title="Delete class"
                      onClick={(e) => { e.stopPropagation(); void removeClass(c); }}
                    >&times;</button>
                  </span>
                </div>
              ))}
              {classes.length === 0 && (
                <div className="ann-side__empty">No classes yet — add one below.</div>
              )}
            </div>
            <form
              className="ann-class-add"
              onSubmit={(e) => { e.preventDefault(); void addClass(); }}
            >
              <input
                className={classes.length === 0 ? "ann-pulse" : ""}
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                placeholder="New class name"
                maxLength={64}
              />
              <button type="submit" className="btn btn--sm btn--secondary" disabled={!newClassName.trim()}>
                Add
              </button>
            </form>
          </div>

          {/* Annotations on this image.
              --grow: this is the only section whose content changes length as
              you work, so it takes the panel's free space instead of leaving a
              dead gap under Progress. On a long list it scrolls internally,
              which keeps Tags and Progress reachable without scrolling the
              whole panel past them. */}
          <div className="ann-side__section ann-side__section--grow">
            <div className="ann-side__titlerow">
              <div className="ann-side__title">
                Annotations ({shapes.length + maskAnnotations.length})
              </div>
              <button
                className="ann-copyprev"
                onClick={() => void copyPreviousLabels()}
                disabled={!imgData?.prev_asset_id}
                title={
                  imgData?.prev_asset_id
                    ? "Copy the previous image's labels onto this one (C) — adds, and is undoable"
                    : "No previous image"
                }
              >
                Copy previous
              </button>
            </div>
            <div className="ann-anns">
              {shapes.map((a) => (
                <div
                  key={a.clientId}
                  className={`ann-row ${selectedId === a.clientId ? "ann-row--selected" : ""}`}
                  onClick={() => setSelectedId(a.clientId)}
                >
                  <span className="ann-row__glyph">{kindGlyph(a.kind)}</span>
                  <span className="ann-class__dot" style={{ background: clsColor(a.class_id) }} />
                  {/* Relabel in place — but ONLY on the selected row.
                      A dropdown on all ten rows turned the list into a form
                      and was the single biggest source of visual noise in the
                      panel. Unselected rows show plain text; selecting a row
                      is already how you act on an annotation, so the control
                      appears exactly when it is usable.
                      stopPropagation so opening it doesn't re-fire the row's
                      own select handler. */}
                  {selectedId === a.clientId ? (
                    <select
                      className="ann-row__class"
                      value={a.class_id}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const classId = e.target.value;
                        commitChange((prev) =>
                          prev.map((x) => (x.clientId === a.clientId ? { ...x, class_id: classId } : x))
                        );
                      }}
                      title="Change this annotation's class"
                    >
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="ann-row__name">{clsName(a.class_id)}</span>
                  )}
                  <span className="ann-row__size">{(shapeArea(a) * 100).toFixed(1)}%</span>
                  <button
                    className="ann-row__x" title="Delete annotation"
                    onClick={(e) => { e.stopPropagation(); deleteAnnotation(a.clientId); }}
                  >&times;</button>
                </div>
              ))}
              {/* Masks are listed here but not in `shapes`: they have no vector
                  geometry to hit-test, so they are selected from this list or
                  by painting over them. */}
              {maskAnnotations.map((a) => (
                <div
                  key={a.clientId}
                  className={`ann-row ${selectedId === a.clientId ? "ann-row--selected" : ""}`}
                  onClick={() => setSelectedId(a.clientId)}
                >
                  <span className="ann-row__glyph" title="Segmentation mask">▦</span>
                  <span className="ann-class__dot" style={{ background: clsColor(a.class_id) }} />
                  {selectedId === a.clientId ? (
                    <select
                      className="ann-row__class"
                      value={a.class_id}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const classId = e.target.value;
                        commitChange((prev) =>
                          prev.map((x) => (x.clientId === a.clientId ? { ...x, class_id: classId } : x))
                        );
                      }}
                      title="Change this mask's class"
                    >
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="ann-row__name">{clsName(a.class_id)}</span>
                  )}
                  <span className="ann-row__size">mask</span>
                  <button
                    className="ann-row__x" title="Delete mask"
                    onClick={(e) => { e.stopPropagation(); deleteAnnotation(a.clientId); }}
                  >&times;</button>
                </div>
              ))}
              {shapes.length === 0 && maskAnnotations.length === 0 && (
                <div className="ann-side__empty">
                  No shapes yet — press B and drag, or G to paint a mask.
                </div>
              )}
            </div>
            {classes.length > 0 && (
              <>
                <div className="ann-side__subtitle">
                  <span className="ann-row__glyph">{ICONS.glyphTag}</span> Classification
                </div>
                <div className="ann-cls-chips">
                  {classes.map((c) => {
                    const on = classifications.some((a) => a.class_id === c.id);
                    return (
                      <button
                        key={c.id}
                        className={`ann-cls-chip ${on ? "ann-cls-chip--on" : ""}`}
                        style={on ? { background: c.color, borderColor: c.color } : {}}
                        onClick={() => toggleClassification(c.id)}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Tags — image metadata, not training labels. Kept visually
              separate from Classes so the distinction is obvious at a glance. */}
          <div className="ann-side__section">
            <div className="ann-side__title">Tags</div>
            <div className="ann-tags">
              {tags.map((t) => (
                <span key={t} className="ann-tag">
                  {t}
                  <button
                    className="ann-tag__x"
                    onClick={() => removeTag(t)}
                    title={`Remove "${t}"`}
                  >&times;</button>
                </span>
              ))}
              {tags.length === 0 && (
                <span className="ann-side__empty">No tags on this image.</span>
              )}
            </div>
            <input
              className="ann-tag-add"
              list="ann-tag-vocab"
              placeholder="Add a tag, press Enter"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addTag(tagInput); }
                // Backspace on an empty box removes the last tag, the
                // convention every tag input uses.
                else if (e.key === "Backspace" && !tagInput && tags.length) {
                  e.preventDefault();
                  removeTag(tags[tags.length - 1]);
                }
              }}
              disabled={!imgData}
            />
            {/* Native datalist: autocomplete against tags already in this
                dataset, with no dependency and no custom popup to manage. */}
            <datalist id="ann-tag-vocab">
              {knownTags.filter((t) => !tags.includes(t)).map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>

          {/* Progress */}
          <div className="ann-side__section">
            <div className="ann-side__title">Progress</div>
            {summary ? (
              <>
                <div className="ann-progress__grid">
                  <div className="ann-progress__cell">
                    <span>{summary.annotated}</span><label>annotated</label>
                  </div>
                  <div className="ann-progress__cell">
                    <span>{summary.approved}</span><label>approved</label>
                  </div>
                  <div className="ann-progress__cell">
                    <span>{summary.rejected}</span><label>rejected</label>
                  </div>
                  <div className="ann-progress__cell">
                    <span>{summary.total}</span><label>total</label>
                  </div>
                </div>
                <div className="ann-progress__splits">
                  train {summary.splits.train} · valid {summary.splits.valid} · test{" "}
                  {summary.splits.test} · unassigned {summary.splits.unassigned}
                </div>
              </>
            ) : (
              <div className="ann-side__empty">Loading…</div>
            )}
          </div>
        </aside>
      </div>

      {/* ── Filmstrip ──
          Extracted and memoised: 100 thumbnails re-reconciling on every
          pointer move was what made the filter buttons feel sticky. */}
      <Filmstrip
        filters={FILTERS}
        activeFilter={queueFilter}
        counts={filterCounts}
        queue={queue}
        queueTotal={queueTotal}
        currentAssetId={currentAssetId}
        statusLabel={STATUS_LABEL}
        onChangeFilter={changeFilter}
        onSelect={selectFromStrip}
        onScroll={onStripScroll}
        stripRef={stripRef}
      />

      {showHelp && <HelpSheet onClose={closeShortcuts} />}

      {/* ── Crop confirmation ──
          Deliberately a blocking, explicit dialog. Crop overwrites the stored
          image and is the only action here Ctrl+Z cannot reverse, so it states
          the new size, warns when annotations will be lost, and says plainly
          where the untouched original goes. */}
      {pendingCrop && imgSize && (
        <div className="ann-modal" onClick={() => !cropping && setPendingCrop(null)}>
          <div className="ann-modal__box" onClick={(e) => e.stopPropagation()}>
            <div className="ann-modal__title">Crop this image?</div>
            <div className="ann-modal__body">
              <p>
                The image will be cropped to{" "}
                <b>
                  {Math.round(pendingCrop.w * imgSize.W)} × {Math.round(pendingCrop.h * imgSize.H)}
                </b>{" "}
                (from {imgSize.W} × {imgSize.H}).
              </p>
              <p className="ann-modal__warn">
                This <b>replaces the stored image</b> and cannot be undone from the editor.
                Annotations are moved into the new frame; any that fall entirely
                outside it are deleted.
              </p>
              <p className="ann-modal__note">
                A copy of the untouched original is kept in storage under{" "}
                <code>_originals/</code>.
              </p>
            </div>
            <div className="ann-modal__actions">
              <button
                className="btn btn--sm btn--secondary"
                onClick={() => setPendingCrop(null)}
                disabled={cropping}
              >Cancel</button>
              <button
                className="btn btn--sm btn--primary"
                onClick={() => void applyCrop()}
                disabled={cropping}
              >{cropping ? "Cropping…" : "Crop image"}</button>
            </div>
          </div>
        </div>
      )}

      {showExport && (
        <ExportModal
          datasetId={dsId}
          summary={summary}
          onClose={() => setShowExport(false)}
          onSummaryChanged={refreshSummary}
        />
      )}
    </div>
  );
}
