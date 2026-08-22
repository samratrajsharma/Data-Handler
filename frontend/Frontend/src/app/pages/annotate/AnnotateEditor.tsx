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
import ExportModal from "./ExportModal";
import "./AnnotateEditor.css";

// ── Constants / small types ──────────────────────────────────────────────

type Tool = "select" | "bbox" | "polygon" | "pan";
type QueueFilter = "all" | ImageStatus;

const MIN_SCALE = 0.05;
const MAX_SCALE = 12;
const QUEUE_PAGE = 100;
const HANDLE_HIT_PX = 8;
const POLY_CLOSE_PX = 8;
const MIN_DRAW_PX = 4;
const FALLBACK_COLOR = "#94a3b8";

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
  | { type: "vertex"; clientId: string; index: number; before: LocalAnnotation[]; moved: boolean };

const FILTERS: { id: QueueFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unannotated", label: "Unannotated" },
  { id: "annotated", label: "Annotated" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];

// ── Inline SVG icons ─────────────────────────────────────────────────────

const ic = (children: ReactNode) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
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

  const { reset: historyReset, commit: historyCommit, undo: historyUndo, redo: historyRedo } =
    useAnnotationHistory();

  // Mirror of the state that stable window/keyboard handlers need.
  const latest = useRef({
    view, imgSize, annotations, tool, activeClassId, polyDraft, classes,
    imgData, dirty, queueFilter, selectedId, draftRect, spaceHeld,
  });
  latest.current = {
    view, imgSize, annotations, tool, activeClassId, polyDraft, classes,
    imgData, dirty, queueFilter, selectedId, draftRect, spaceHeld,
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

  const shapes = useMemo(() => annotations.filter((a) => a.kind !== "classification"), [annotations]);
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
  const selected = useMemo(
    () => annotations.find((a) => a.clientId === selectedId) ?? null,
    [annotations, selectedId]
  );

  const currentAssetId = imgData?.asset.id ?? null;
  const queueIndex = currentAssetId ? queue.findIndex((q) => q.asset_id === currentAssetId) : -1;
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
        setParamsRef.current({ asset: assetId }, { replace: true });
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

  const goPrev = useCallback(() => {
    void goTo(latest.current.imgData?.prev_asset_id ?? null);
  }, [goTo]);
  const goNext = useCallback(() => {
    void goTo(latest.current.imgData?.next_asset_id ?? null);
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
        const first = initialAssetRef.current || qRes.data.items[0]?.asset_id;
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

  // Fit on image load / change.
  useEffect(() => {
    if (imgSize) fitToContainer();
  }, [imgSize, currentAssetId, fitToContainer]);

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

    if (tool === "bbox") {
      if (!activeClassId) return;
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
    if (d.type === "draw-bbox") {
      const L = latest.current;
      const r = L.draftRect;
      setDraftRect(null);
      if (!r || !L.imgSize || !L.activeClassId) return;
      // Only commit boxes that are more than a slip of the mouse.
      if (r.w * L.imgSize.W * L.view.scale <= MIN_DRAW_PX) return;
      if (r.h * L.imgSize.H * L.view.scale <= MIN_DRAW_PX) return;
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
  });
  actionsRef.current = {
    saveNow, goPrev, goNext, doUndo, doRedo, deleteSelected, cancelOrDeselect,
    fitToContainer, zoomAtCenter, selectClass, toggleClassification, closePolygon,
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
        case "f": case "F": A.fitToContainer(); break;
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

  const changeFilter = (f: QueueFilter) => {
    if (f === queueFilter) return;
    setQueueFilter(f);
    latest.current.queueFilter = f;
    loadQueue(f, 0).catch(() => {});
    // Re-fetch the current image with the new filter so its prev/next ids
    // navigate within the filtered queue (saving any pending edits first).
    const cur = latest.current.imgData?.asset.id;
    if (cur) void saveNow().then(() => loadImage(cur));
  };

  const onStripScroll = (e: RUIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollLeft + el.clientWidth < el.scrollWidth - 60) return;
    if (loadMoreRef.current || queue.length >= queueTotal) return;
    loadMoreRef.current = true;
    loadQueue(queueFilter, queue.length)
      .catch(() => {})
      .finally(() => {
        loadMoreRef.current = false;
      });
  };

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
      : tool === "bbox" || tool === "polygon"
        ? "crosshair"
        : hoverCursor;

  const imgUrl = imgData ? imgData.asset.original_url || imgData.asset.thumbnail_url || "" : "";
  const saveLabel = saving ? "Saving…" : dirty ? "Unsaved •" : "Saved ✓";
  const saveMod = saving ? "saving" : dirty ? "dirty" : "saved";
  const position =
    queueIndex >= 0 ? `${queueIndex + 1} / ${queueTotal}` : `— / ${queueTotal}`;

  const TOOL_BUTTONS: { id: Tool; label: string; icon: ReactNode }[] = [
    { id: "select", label: "Select (V)", icon: ICONS.select },
    { id: "bbox", label: "Bounding box (B)", icon: ICONS.bbox },
    { id: "polygon", label: "Polygon (P)", icon: ICONS.polygon },
    { id: "pan", label: "Pan (H)", icon: ICONS.pan },
  ];

  return (
    <div className="ann-editor">
      {/* ── Header ── */}
      <header className="ann-header">
        <Link to="/annotate" className="ann-header__back">&larr; Annotate</Link>
        <div className="ann-header__name" title={datasetName}>{datasetName || "…"}</div>
        <div className="ann-header__nav">
          <button
            className="ann-header__navbtn" title="Previous image (←)"
            onClick={goPrev} disabled={!imgData?.prev_asset_id}
          >&lsaquo;</button>
          <span className="ann-header__pos">{position}</span>
          <button
            className="ann-header__navbtn" title="Next image (→)"
            onClick={goNext} disabled={!imgData?.next_asset_id}
          >&rsaquo;</button>
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
        <button className="btn btn--sm btn--primary" onClick={() => setShowExport(true)}>
          Export
        </button>
      </header>

      <div className="ann-body">
        {/* ── Tool rail ── */}
        <div className="ann-toolbar">
          {TOOL_BUTTONS.map((t) => (
            <button
              key={t.id}
              className={`ann-tool ${tool === t.id ? "ann-tool--active" : ""}`}
              title={t.label}
              onClick={() => setTool(t.id)}
            >
              {t.icon}
            </button>
          ))}
          <div className="ann-toolbar__sep" />
          <button className="ann-tool" title="Zoom in (+)" onClick={() => zoomAtCenter(1.25)}>
            {ICONS.zoomIn}
          </button>
          <button className="ann-tool" title="Zoom out (−)" onClick={() => zoomAtCenter(0.8)}>
            {ICONS.zoomOut}
          </button>
          <button className="ann-tool" title="Fit to screen (F)" onClick={fitToContainer}>
            {ICONS.fit}
          </button>
          <div className="ann-toolbar__zoom">{Math.round(s * 100)}%</div>
        </div>

        {/* ── Center: classification bar + canvas ── */}
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

              {imgSize && (
                <svg
                  className="ann-overlay"
                  viewBox={`0 0 ${W} ${H}`}
                  width={W}
                  height={H}
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
                  <div className="ann-guard__hint">
                    Use the &quot;New class name&quot; field in the panel <span className="ann-guard__arrow">&rarr;</span>
                  </div>
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
        </div>

        {/* ── Right panel ── */}
        <aside className="ann-side">
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

          {/* Annotations on this image */}
          <div className="ann-side__section">
            <div className="ann-side__title">Annotations ({shapes.length})</div>
            <div className="ann-anns">
              {shapes.map((a) => (
                <div
                  key={a.clientId}
                  className={`ann-row ${selectedId === a.clientId ? "ann-row--selected" : ""}`}
                  onClick={() => setSelectedId(a.clientId)}
                >
                  <span className="ann-row__glyph">{kindGlyph(a.kind)}</span>
                  <span className="ann-class__dot" style={{ background: clsColor(a.class_id) }} />
                  <span className="ann-row__name">{clsName(a.class_id)}</span>
                  <span className="ann-row__size">{(shapeArea(a) * 100).toFixed(1)}%</span>
                  <button
                    className="ann-row__x" title="Delete annotation"
                    onClick={(e) => { e.stopPropagation(); deleteAnnotation(a.clientId); }}
                  >&times;</button>
                </div>
              ))}
              {shapes.length === 0 && (
                <div className="ann-side__empty">
                  No shapes yet — press B and drag on the image.
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

      {/* ── Filmstrip ── */}
      <div className="ann-strip">
        <div className="ann-strip__filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={`ann-fchip ${queueFilter === f.id ? "ann-fchip--active" : ""}`}
              onClick={() => changeFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
          <span className="ann-strip__total">{queueTotal} images</span>
        </div>
        <div className="ann-strip__scroll" ref={stripRef} onScroll={onStripScroll}>
          {queue.map((q) => (
            <button
              key={q.asset_id}
              data-asset={q.asset_id}
              className={`ann-thumb ann-thumb--${q.status} ${
                q.asset_id === currentAssetId ? "ann-thumb--current" : ""
              }`}
              title={`${q.file_name} — ${STATUS_LABEL[q.status]}${q.split ? ` (${q.split})` : ""}`}
              onClick={() => void goTo(q.asset_id)}
            >
              {q.thumbnail_url ? (
                <img src={q.thumbnail_url} alt={q.file_name} loading="lazy" draggable={false} />
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
