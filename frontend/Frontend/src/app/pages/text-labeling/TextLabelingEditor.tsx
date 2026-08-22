import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { annotationApi } from "../../../shared/api/annotations";
import type { AnnotationClass } from "../../../shared/api/annotations";
import { textApi } from "../../../shared/api/text";
import type {
  TextAnnotationIn,
  TextAnnotationOut,
  TextDocDetailResponse,
  TextDocListItem,
  TextExportFormat,
  TextSplitStrategy,
  TextSummary,
} from "../../../shared/api/text";
import "./TextLabelingEditor.css";

const PAGE_SIZE = 50;

const PALETTE = [
  "#f97316", "#3b82f6", "#22c55e", "#a855f7", "#ef4444", "#eab308",
  "#06b6d4", "#ec4899", "#84cc16", "#14b8a6", "#6366f1", "#f43f5e",
];

const EXPORT_INFO: Record<TextExportFormat, string> = {
  jsonl: "One JSON object per document: text, doc labels and spans.",
  csv: "Flat table — one row per document, spans serialized as JSON.",
  "spans-jsonl": "spaCy-style JSONL: text plus [start, end, label] span tuples.",
};
const EXPORT_EXT: Record<TextExportFormat, string> = {
  jsonl: "jsonl",
  csv: "csv",
  "spans-jsonl": "jsonl",
};

const STRATEGIES: { value: TextSplitStrategy; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "file", label: "Whole file" },
  { value: "blank_line", label: "Blank-line blocks" },
  { value: "line", label: "One per line" },
];

type StatusFilter = "all" | "unlabeled" | "labeled";

type Segment =
  | { type: "text"; start: number; text: string }
  | { type: "mark"; start: number; text: string; ann: TextAnnotationOut };

/**
 * Map a DOM selection endpoint back to a character offset in the ORIGINAL
 * document string. Every rendered segment carries data-offset (its starting
 * offset), so the math is: segment offset + text consumed inside the segment.
 * Text inside data-label="1" elements (the tiny class-name superscripts and
 * the delete button) is UI chrome, not document content — it is skipped.
 */
function resolveOffset(
  node: Node,
  offsetInNode: number,
  container: HTMLElement,
  contentLength: number
): number | null {
  // Element-level anchor (e.g. select-all / triple-click): map the child index
  // to the starting offset of the next segment element.
  if (
    node === container ||
    (node instanceof HTMLElement && node.classList.contains("txl-doc__inner"))
  ) {
    const host =
      node === container ? container.querySelector(".txl-doc__inner") ?? container : node;
    const children = host.childNodes;
    if (offsetInNode >= children.length) return contentLength;
    let target: Node | null = children[offsetInNode] ?? null;
    while (target && !(target instanceof HTMLElement && target.dataset.offset !== undefined)) {
      target = target.nextSibling;
    }
    return target instanceof HTMLElement
      ? parseInt(target.dataset.offset ?? "0", 10)
      : contentLength;
  }

  // Walk up to the segment element that owns this node.
  let seg: Node | null = node;
  while (seg && seg !== container) {
    if (seg instanceof HTMLElement && seg.dataset.label === "1") return null;
    if (seg instanceof HTMLElement && seg.dataset.offset !== undefined) break;
    seg = seg.parentNode;
  }
  if (!(seg instanceof HTMLElement) || seg.dataset.offset === undefined) return null;

  let sum = parseInt(seg.dataset.offset, 10);
  const walker = document.createTreeWalker(seg, NodeFilter.SHOW_TEXT);
  let t: Node | null = walker.nextNode();
  while (t) {
    const inLabel = t.parentElement?.closest('[data-label="1"]') != null;
    if (t === node) return inLabel ? null : sum + offsetInNode;
    if (!inLabel) sum += t.textContent?.length ?? 0;
    t = walker.nextNode();
  }
  // The anchor was an element inside the segment — fall back to segment start.
  return sum;
}

// ── Offset units ─────────────────────────────────────────────────────────
// The DOM (and all local state here) measures offsets in UTF-16 code units;
// the backend validates and slices in Python code points. They differ as soon
// as the text contains an astral character (emoji, rare CJK), so convert at
// the API boundary in both directions.
const ASTRAL_RE = /[\uD800-\uDFFF]/;

function u16ToCp(text: string, off: number | null): number | null {
  if (off == null || !ASTRAL_RE.test(text)) return off;
  return Array.from(text.slice(0, off)).length;
}

function cpToU16(text: string, off: number | null): number | null {
  if (off == null || !ASTRAL_RE.test(text)) return off;
  let u16 = 0;
  let count = 0;
  for (const ch of text) {
    if (count >= off) break;
    u16 += ch.length;
    count += 1;
  }
  return u16;
}

const fromServerAnns = (list: TextAnnotationOut[], content: string): TextAnnotationOut[] =>
  list.map((a) =>
    a.kind === "span"
      ? { ...a, start_offset: cpToU16(content, a.start_offset), end_offset: cpToU16(content, a.end_offset) }
      : a
  );

const toServerAnns = (list: TextAnnotationOut[], content: string): TextAnnotationIn[] =>
  list.map((a) => ({
    class_id: a.class_id,
    kind: a.kind,
    start_offset: a.kind === "span" ? u16ToCp(content, a.start_offset) : a.start_offset,
    end_offset: a.kind === "span" ? u16ToCp(content, a.end_offset) : a.end_offset,
  }));

let tmpIdCounter = 0;

export default function TextLabelingEditor() {
  const { datasetId = "" } = useParams<{ datasetId: string }>();

  const [classes, setClasses] = useState<AnnotationClass[]>([]);
  const [summary, setSummary] = useState<TextSummary | null>(null);

  // Left pane — document list.
  const [docs, setDocs] = useState<TextDocListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Center — current document.
  const [currentDocId, setCurrentDocId] = useState<string | null>(null);
  const [doc, setDoc] = useState<TextDocDetailResponse | null>(null);
  const [anns, setAnns] = useState<TextAnnotationOut[]>([]);
  const [docStatus, setDocStatus] = useState<"unlabeled" | "labeled">("unlabeled");
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  const [popover, setPopover] = useState<{
    left: number;
    top: number;
    start: number;
    end: number;
  } | null>(null);
  const [popNewClass, setPopNewClass] = useState("");

  // Right pane.
  const [panelNewClass, setPanelNewClass] = useState("");
  const [exportFormat, setExportFormat] = useState<TextExportFormat>("jsonl");
  const [exporting, setExporting] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadStrategy, setUploadStrategy] = useState<TextSplitStrategy>("auto");
  const [uploading, setUploading] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Mutations read/write this ref synchronously so rapid successive actions
  // compose; saves are serialized below with only the latest response adopted.
  const annsRef = useRef<TextAnnotationOut[]>([]);
  // The document the user is currently viewing, tracked synchronously so an
  // in-flight save that resolves AFTER a document switch can tell it is stale
  // and refuse to write its response onto the newly-opened document.
  const currentDocIdRef = useRef<string | null>(null);
  // Save bookkeeping is keyed PER DOCUMENT id: each document serializes its own
  // saves and has its own supersede counter, so a save belonging to one
  // document can never adopt or supersede a save belonging to another.
  const saveChainByDoc = useRef<Map<string, Promise<void>>>(new Map());
  const saveSeqByDoc = useRef<Map<string, number>>(new Map());

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const countByClass = useMemo(() => {
    const m = new Map<string, number>();
    summary?.class_counts.forEach((c) => m.set(c.class_id, c.count));
    return m;
  }, [summary]);

  const refreshSummary = useCallback(() => {
    if (!datasetId) return;
    textApi.getSummary(datasetId).then((r) => setSummary(r.data)).catch(() => {});
  }, [datasetId]);

  useEffect(() => {
    if (!datasetId) return;
    annotationApi.listClasses(datasetId).then((r) => setClasses(r.data.classes)).catch(() => {});
    refreshSummary();
  }, [datasetId, refreshSummary]);

  // Debounced search (300ms).
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const listParams = useCallback(
    (skip: number) => ({
      skip,
      limit: PAGE_SIZE,
      ...(q ? { q } : {}),
      ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    }),
    [q, statusFilter]
  );

  // (Re)load page 1 whenever the query or filter changes.
  useEffect(() => {
    if (!datasetId) return;
    let cancelled = false;
    setListLoading(true);
    textApi
      .listDocuments(datasetId, listParams(0))
      .then((r) => {
        if (cancelled) return;
        setDocs(r.data.items);
        setTotal(r.data.total);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId, listParams]);

  const loadMore = async () => {
    try {
      const r = await textApi.listDocuments(datasetId, listParams(docs.length));
      setDocs((d) => [...d, ...r.data.items]);
      setTotal(r.data.total);
    } catch {
      alert("Failed to load more documents");
    }
  };

  // Auto-open the first document once the list arrives.
  useEffect(() => {
    if (!currentDocId && docs.length > 0) {
      const first = docs[0];
      if (first) setCurrentDocId(first.id);
    }
  }, [docs, currentDocId]);

  // On every document switch, synchronously record the active document id and
  // clear the annotations mirror. This runs before any in-flight save can
  // resolve, so a save belonging to the PREVIOUS document detects the switch
  // (below) and refuses to write its spans/status onto the newly-opened one.
  useLayoutEffect(() => {
    currentDocIdRef.current = currentDocId;
    annsRef.current = [];
  }, [currentDocId]);

  // Load the current document (with the active filters so prev/next follow
  // the same chain the list shows).
  useEffect(() => {
    if (!datasetId || !currentDocId) return;
    let cancelled = false;
    const params = {
      ...(q ? { q } : {}),
      ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    };
    textApi
      .getDocument(datasetId, currentDocId, params)
      .then((r) => {
        if (cancelled) return;
        setDoc(r.data);
        const local = fromServerAnns(r.data.annotations, r.data.content);
        annsRef.current = local;
        setAnns(local);
        setDocStatus(r.data.status);
        setSelectedAnnId(null);
        setPopover(null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [datasetId, currentDocId, q, statusFilter]);

  // ── Saving (replace-all model) ─────────────────────────────────────────
  const persist = useCallback(
    (next: TextAnnotationOut[], docId: string, content: string) => {
      // Ignore edits aimed at a document the user has already navigated away
      // from (e.g. a late action fired during a switch) — never persist them.
      if (docId !== currentDocIdRef.current) return Promise.resolve();
      // Snapshot the pre-mutation annotations so a failed save can roll back
      // instead of leaving unsaved spans on screen looking saved.
      const prevAnns = annsRef.current;
      annsRef.current = next;
      setAnns(next);
      const seq = (saveSeqByDoc.current.get(docId) ?? 0) + 1;
      saveSeqByDoc.current.set(docId, seq);
      const run = async () => {
        try {
          const res = await textApi.saveAnnotations(datasetId, docId, toServerAnns(next, content));
          // Bail if superseded by a newer save to THIS doc, or if the user has
          // switched documents — never adopt this response onto another doc.
          if (seq !== saveSeqByDoc.current.get(docId) || currentDocIdRef.current !== docId) return;
          const local = fromServerAnns(res.data.annotations, content);
          annsRef.current = local;
          setAnns(local);
          setDocStatus(res.data.status);
          // Patch the list row locally — but under an active status filter a
          // row whose status no longer matches leaves the server-side set, so
          // drop it to keep skip-based pagination aligned.
          setDocs((rows) => {
            if (statusFilter !== "all" && res.data.status !== statusFilter) {
              const nextRows = rows.filter((row) => row.id !== docId);
              if (nextRows.length !== rows.length) setTotal((t) => Math.max(0, t - 1));
              return nextRows;
            }
            return rows.map((row) => {
              if (row.id !== docId) return row;
              return {
                ...row,
                status: res.data.status,
                doc_labels: res.data.annotations
                  .filter((a) => a.kind === "doc")
                  .map((a) => {
                    const c = classById.get(a.class_id);
                    return {
                      class_id: a.class_id,
                      name: c?.name ?? "?",
                      color: c?.color ?? "#888888",
                    };
                  }),
                span_count: res.data.annotations.filter((a) => a.kind === "span").length,
              };
            });
          });
          refreshSummary();
        } catch {
          // Roll back the optimistic update so unsaved spans aren't left on
          // screen looking saved — but only while this is still the latest
          // save for the document the user is actually looking at.
          if (seq === saveSeqByDoc.current.get(docId) && currentDocIdRef.current === docId) {
            annsRef.current = prevAnns;
            setAnns(prevAnns);
            alert("Failed to save annotations");
          }
        }
      };
      const prev = saveChainByDoc.current.get(docId) ?? Promise.resolve();
      const p = prev.then(run, run);
      saveChainByDoc.current.set(docId, p);
      return p;
    },
    [datasetId, classById, refreshSummary, statusFilter]
  );

  const toggleDocLabel = useCallback(
    (classId: string) => {
      if (!doc) return;
      const base = annsRef.current;
      const existing = base.find((a) => a.kind === "doc" && a.class_id === classId);
      const next = existing
        ? base.filter((a) => a.id !== existing.id)
        : [
            ...base,
            {
              id: `tmp-${++tmpIdCounter}`,
              class_id: classId,
              kind: "doc" as const,
              start_offset: null,
              end_offset: null,
              snippet: null,
            },
          ];
      void persist(next, doc.id, doc.content);
    },
    [doc, persist]
  );

  const addSpan = useCallback(
    (classId: string, start: number, end: number) => {
      if (!doc) return;
      const base = annsRef.current;
      const overlaps = base.some(
        (a) =>
          a.kind === "span" &&
          a.start_offset != null &&
          a.end_offset != null &&
          start < a.end_offset &&
          end > a.start_offset
      );
      setPopover(null);
      window.getSelection()?.removeAllRanges();
      if (overlaps) {
        alert("Overlapping spans are not supported");
        return;
      }
      void persist(
        [
          ...base,
          {
            id: `tmp-${++tmpIdCounter}`,
            class_id: classId,
            kind: "span" as const,
            start_offset: start,
            end_offset: end,
            snippet: doc.content.slice(start, end).slice(0, 200),
          },
        ],
        doc.id,
        doc.content
      );
    },
    [doc, persist]
  );

  const deleteAnn = useCallback(
    (annId: string) => {
      if (!doc) return;
      if (selectedAnnId === annId) setSelectedAnnId(null);
      void persist(annsRef.current.filter((a) => a.id !== annId), doc.id, doc.content);
    },
    [doc, selectedAnnId, persist]
  );

  // ── Class CRUD (shared with the annotation system) ─────────────────────
  const createClass = useCallback(
    async (name: string): Promise<AnnotationClass | null> => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      if (classes.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
        alert(`Class "${trimmed}" already exists`);
        return null;
      }
      const used = new Set(classes.map((c) => c.color.toLowerCase()));
      const color =
        PALETTE.find((p) => !used.has(p)) ?? PALETTE[classes.length % PALETTE.length] ?? "#f97316";
      try {
        const res = await annotationApi.createClass(datasetId, { name: trimmed, color });
        setClasses((c) => [...c, res.data]);
        return res.data;
      } catch {
        alert("Failed to create class");
        return null;
      }
    },
    [datasetId, classes]
  );

  const removeClass = async (cls: AnnotationClass) => {
    if (!confirm(`Delete class "${cls.name}"? Its annotations across the dataset will be removed.`))
      return;
    try {
      await annotationApi.deleteClass(datasetId, cls.id);
      setClasses((c) => c.filter((x) => x.id !== cls.id));
      refreshSummary();
      // Annotations referencing the class are gone server-side — reload the
      // current doc (with the active filters so prev/next stay on the same
      // chain) and the visible list.
      if (currentDocId) {
        const params = {
          ...(q ? { q } : {}),
          ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        };
        const r = await textApi.getDocument(datasetId, currentDocId, params);
        setDoc(r.data);
        const local = fromServerAnns(r.data.annotations, r.data.content);
        annsRef.current = local;
        setAnns(local);
        setDocStatus(r.data.status);
      }
      const rl = await textApi.listDocuments(datasetId, listParams(0));
      setDocs(rl.data.items);
      setTotal(rl.data.total);
    } catch {
      alert("Failed to delete class");
    }
  };

  // ── Selection → span creation ──────────────────────────────────────────
  const handleMouseUp = (e: ReactMouseEvent<HTMLDivElement>) => {
    const container = contentRef.current;
    if (!container || !doc) return;
    if (popRef.current && popRef.current.contains(e.target as Node)) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer))
      return;
    const len = doc.content.length;
    const start = resolveOffset(range.startContainer, range.startOffset, container, len);
    const end = resolveOffset(range.endContainer, range.endOffset, container, len);
    if (start === null || end === null || end <= start) return;
    // Anchor the popover just below the selection, in container coordinates
    // (it lives inside the scrollable div, so it tracks the text on scroll).
    const rect = range.getBoundingClientRect();
    const crect = container.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(
        rect.left - crect.left + container.scrollLeft + rect.width / 2 - 130,
        container.clientWidth - 272
      )
    );
    const top = rect.bottom - crect.top + container.scrollTop + 8;
    setSelectedAnnId(null);
    setPopover({ left, top, start, end });
  };

  // Outside click dismisses the popover.
  useEffect(() => {
    if (!popover) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setPopover(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [popover]);

  // ── Navigation ─────────────────────────────────────────────────────────
  const goPrev = useCallback(() => {
    if (doc?.prev_doc_id) setCurrentDocId(doc.prev_doc_id);
  }, [doc]);
  const goNext = useCallback(() => {
    if (doc?.next_doc_id) setCurrentDocId(doc.next_doc_id);
  }, [doc]);

  // ── Keyboard: 1-9 doc labels, arrows navigate, Esc dismisses ───────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (e.key === "Escape") {
        if (popover) {
          setPopover(null);
          window.getSelection()?.removeAllRanges();
        } else {
          setSelectedAnnId(null);
        }
        return;
      }
      if (typing) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
        return;
      }
      if (!popover && !selectedAnnId && /^[1-9]$/.test(e.key)) {
        const cls = classes[Number(e.key) - 1];
        if (cls) {
          e.preventDefault();
          toggleDocLabel(cls.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popover, selectedAnnId, classes, goPrev, goNext, toggleDocLabel]);

  // ── Export / upload ────────────────────────────────────────────────────
  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await textApi.exportText(datasetId, exportFormat);
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `text-export-${exportFormat}.${EXPORT_EXT[exportFormat]}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleUpload = async () => {
    if (uploadFiles.length === 0) return;
    setUploading(true);
    try {
      const res = await textApi.upload(datasetId, uploadFiles, uploadStrategy);
      const d = res.data;
      let msg = `Created ${d.documents_created} document${
        d.documents_created === 1 ? "" : "s"
      } (${d.total_documents} total) using "${d.strategy_used}" split.`;
      if (d.warnings.length > 0) msg += `\n\nWarnings:\n${d.warnings.join("\n")}`;
      alert(msg);
      setUploadFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      const rl = await textApi.listDocuments(datasetId, listParams(0));
      setDocs(rl.data.items);
      setTotal(rl.data.total);
      refreshSummary();
    } catch {
      alert("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // ── Render helpers ─────────────────────────────────────────────────────
  const segments = useMemo((): Segment[] => {
    if (!doc) return [];
    const content = doc.content;
    const spans = anns
      .filter(
        (a): a is TextAnnotationOut & { start_offset: number; end_offset: number } =>
          a.kind === "span" && a.start_offset != null && a.end_offset != null
      )
      .sort((a, b) => a.start_offset - b.start_offset);
    const segs: Segment[] = [];
    let cursor = 0;
    for (const s of spans) {
      const start = Math.max(cursor, Math.min(s.start_offset, content.length));
      const end = Math.max(start, Math.min(s.end_offset, content.length));
      if (start > cursor) segs.push({ type: "text", start: cursor, text: content.slice(cursor, start) });
      segs.push({ type: "mark", start, text: content.slice(start, end), ann: s });
      cursor = end;
    }
    if (cursor < content.length) segs.push({ type: "text", start: cursor, text: content.slice(cursor) });
    if (segs.length === 0) segs.push({ type: "text", start: 0, text: "" });
    return segs;
  }, [doc, anns]);

  const docLabels = anns.filter((a) => a.kind === "doc");
  const spanAnns = anns
    .filter((a) => a.kind === "span")
    .sort((a, b) => (a.start_offset ?? 0) - (b.start_offset ?? 0));

  const focusSpan = (annId: string) => {
    setSelectedAnnId(annId);
    contentRef.current
      ?.querySelector(`[data-ann="${annId}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const listIdx = docs.findIndex((d) => d.id === currentDocId);
  const position = doc
    ? listIdx >= 0
      ? `${listIdx + 1} / ${total}`
      : `#${doc.doc_index + 1}`
    : "";

  const snippetFor = (a: TextAnnotationOut): string => {
    if (a.snippet) return a.snippet;
    if (doc && a.start_offset != null && a.end_offset != null)
      return doc.content.slice(a.start_offset, a.end_offset);
    return "";
  };

  return (
    <div className="txl-editor">
      {/* ── LEFT: document list ── */}
      <aside className="txl-left">
        <div className="txl-left__head">
          <Link to="/text-labeling" className="txl-back">
            ← Text datasets
          </Link>
          <input
            className="txl-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents…"
          />
          <div className="txl-filters">
            {(["all", "unlabeled", "labeled"] as const).map((s) => (
              <button
                key={s}
                className={`txl-filter ${statusFilter === s ? "txl-filter--active" : ""}`}
                onClick={() => setStatusFilter(s)}
              >
                {s === "all" ? "All" : s === "unlabeled" ? "Unlabeled" : "Labeled"}
              </button>
            ))}
          </div>
        </div>

        <div className="txl-list">
          {docs.map((d) => (
            <button
              key={d.id}
              className={`txl-row ${currentDocId === d.id ? "txl-row--active" : ""}`}
              onClick={() => setCurrentDocId(d.id)}
            >
              <span
                className={`txl-row__dot ${d.status === "labeled" ? "txl-row__dot--labeled" : ""}`}
              />
              <span className="txl-row__body">
                <span className="txl-row__name" title={d.name}>
                  {d.name}
                </span>
                <span className="txl-row__meta">
                  {d.char_count.toLocaleString()} chars
                  {d.span_count > 0 && (
                    <span className="txl-row__spans">
                      {d.span_count} span{d.span_count === 1 ? "" : "s"}
                    </span>
                  )}
                </span>
                {d.doc_labels.length > 0 && (
                  <span className="txl-row__chips">
                    {d.doc_labels.map((l) => (
                      <span
                        key={l.class_id}
                        className="txl-row__chip"
                        style={{ background: `${l.color}4d`, color: l.color }}
                        title={l.name}
                      >
                        {l.name}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </button>
          ))}
          {!listLoading && docs.length === 0 && (
            <p className="txl-muted txl-list__empty">
              {q || statusFilter !== "all" ? "No documents match." : "No documents yet."}
            </p>
          )}
          {docs.length < total && (
            <button className="btn btn--secondary btn--sm txl-list__more" onClick={loadMore}>
              Load more ({docs.length} of {total})
            </button>
          )}
        </div>
      </aside>

      {/* ── CENTER: reader ── */}
      <section className="txl-center">
        {doc ? (
          <>
            <div className="txl-center__head">
              <span className="txl-center__name" title={doc.name}>
                {doc.name}
              </span>
              <span className={`badge ${docStatus === "labeled" ? "badge--success" : "badge--neutral"}`}>
                {docStatus}
              </span>
              <span className="txl-center__pos">{position}</span>
              <div className="txl-nav">
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={goPrev}
                  disabled={!doc.prev_doc_id}
                  title="Previous document (←)"
                >
                  ← Prev
                </button>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={goNext}
                  disabled={!doc.next_doc_id}
                  title="Next document (→)"
                >
                  Next →
                </button>
              </div>
            </div>

            <div className="txl-labelbar">
              {classes.length === 0 ? (
                <span className="txl-muted">
                  No classes yet — add one in the right panel, or select some text to create one.
                </span>
              ) : (
                classes.map((c, i) => {
                  const active = anns.some((a) => a.kind === "doc" && a.class_id === c.id);
                  return (
                    <button
                      key={c.id}
                      className={`txl-pill ${active ? "txl-pill--active" : ""}`}
                      style={active ? { background: `${c.color}4d`, borderColor: c.color } : undefined}
                      onClick={() => toggleDocLabel(c.id)}
                      title={i < 9 ? `Toggle doc label (key ${i + 1})` : "Toggle doc label"}
                    >
                      <span className="txl-dot" style={{ background: c.color }} />
                      {c.name}
                      {i < 9 && <kbd className="txl-kbd">{i + 1}</kbd>}
                    </button>
                  );
                })
              )}
            </div>

            <div
              className="txl-doc"
              ref={contentRef}
              onMouseUp={handleMouseUp}
              onClick={() => setSelectedAnnId(null)}
            >
              <div className="txl-doc__inner">
                {segments.map((seg, i) => {
                  if (seg.type === "text") {
                    return (
                      <span key={`t${i}`} data-offset={seg.start}>
                        {seg.text}
                      </span>
                    );
                  }
                  const cls = classById.get(seg.ann.class_id);
                  const color = cls?.color ?? "#888888";
                  const selected = selectedAnnId === seg.ann.id;
                  return (
                    <mark
                      key={seg.ann.id}
                      data-offset={seg.start}
                      data-ann={seg.ann.id}
                      className={`txl-mark ${selected ? "txl-mark--selected" : ""}`}
                      style={{ background: `${color}4d`, borderBottom: `2px solid ${color}` }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedAnnId(seg.ann.id);
                      }}
                    >
                      {seg.text}
                      <span className="txl-mark__label" data-label="1" style={{ color }}>
                        {cls?.name ?? "?"}
                      </span>
                      {selected && (
                        <button
                          className="txl-mark__x"
                          data-label="1"
                          title="Delete span"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteAnn(seg.ann.id);
                          }}
                        >
                          ×
                        </button>
                      )}
                    </mark>
                  );
                })}
              </div>

              {popover && (
                <div
                  className="txl-pop"
                  ref={popRef}
                  style={{ left: popover.left, top: popover.top }}
                  onMouseUp={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  {classes.length > 0 && (
                    <div className="txl-pop__classes">
                      {classes.map((c) => (
                        <button
                          key={c.id}
                          className="txl-pop__class"
                          onClick={() => addSpan(c.id, popover.start, popover.end)}
                        >
                          <span className="txl-dot" style={{ background: c.color }} />
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <form
                    className="txl-pop__new"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const cls = await createClass(popNewClass);
                      if (cls) {
                        setPopNewClass("");
                        addSpan(cls.id, popover.start, popover.end);
                      }
                    }}
                  >
                    <input
                      value={popNewClass}
                      onChange={(e) => setPopNewClass(e.target.value)}
                      placeholder={classes.length === 0 ? "Name a class for this span…" : "New class…"}
                      autoFocus={classes.length === 0}
                    />
                    <button
                      type="submit"
                      className="btn btn--secondary btn--sm"
                      disabled={!popNewClass.trim()}
                    >
                      Add
                    </button>
                  </form>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="empty-state txl-center__empty">
            {total === 0 && !listLoading ? (
              <>
                <h3>No documents yet</h3>
                <p>Upload .txt files with the &quot;Upload more&quot; card on the right.</p>
              </>
            ) : (
              <>
                <h3>Select a document</h3>
                <p>Pick a document from the list to start labeling.</p>
              </>
            )}
          </div>
        )}
      </section>

      {/* ── RIGHT: classes / annotations / export / upload ── */}
      <aside className="txl-right">
        <div className="card txl-panel">
          <h4 className="txl-panel__title">Classes</h4>
          {classes.length === 0 && <p className="txl-muted">No classes yet.</p>}
          <div className="txl-classes">
            {classes.map((c) => (
              <div key={c.id} className="txl-class">
                <span className="txl-dot" style={{ background: c.color }} />
                <span className="txl-class__name" title={c.name}>
                  {c.name}
                </span>
                <span className="txl-class__count">{countByClass.get(c.id) ?? 0}</span>
                <button className="txl-x" title="Delete class" onClick={() => removeClass(c)}>
                  ×
                </button>
              </div>
            ))}
          </div>
          <form
            className="txl-add"
            onSubmit={async (e) => {
              e.preventDefault();
              const c = await createClass(panelNewClass);
              if (c) setPanelNewClass("");
            }}
          >
            <input
              value={panelNewClass}
              onChange={(e) => setPanelNewClass(e.target.value)}
              placeholder="New class name…"
            />
            <button
              type="submit"
              className="btn btn--secondary btn--sm"
              disabled={!panelNewClass.trim()}
            >
              Add
            </button>
          </form>
        </div>

        <div className="card txl-panel">
          <h4 className="txl-panel__title">
            Annotations{doc ? ` (${docLabels.length + spanAnns.length})` : ""}
          </h4>
          {!doc || (docLabels.length === 0 && spanAnns.length === 0) ? (
            <p className="txl-muted">
              {doc
                ? "Toggle a doc label above or select text to add a span."
                : "Open a document to see its annotations."}
            </p>
          ) : (
            <div className="txl-anns">
              {docLabels.map((a) => {
                const c = classById.get(a.class_id);
                return (
                  <div key={a.id} className="txl-ann">
                    <span className="txl-dot" style={{ background: c?.color ?? "#888888" }} />
                    <span className="txl-ann__body">
                      <span className="txl-ann__class">{c?.name ?? "?"}</span>
                      <span className="txl-ann__kind">doc label</span>
                    </span>
                    <button className="txl-x" title="Remove doc label" onClick={() => deleteAnn(a.id)}>
                      ×
                    </button>
                  </div>
                );
              })}
              {spanAnns.map((a) => {
                const c = classById.get(a.class_id);
                return (
                  <div
                    key={a.id}
                    className={`txl-ann txl-ann--span ${selectedAnnId === a.id ? "txl-ann--selected" : ""}`}
                    onClick={() => focusSpan(a.id)}
                  >
                    <span className="txl-dot" style={{ background: c?.color ?? "#888888" }} />
                    <span className="txl-ann__body">
                      <span className="txl-ann__class">
                        {c?.name ?? "?"}
                        <span className="txl-ann__kind">
                          {a.start_offset}–{a.end_offset}
                        </span>
                      </span>
                      <span className="txl-ann__snippet">{snippetFor(a)}</span>
                    </span>
                    <button
                      className="txl-x"
                      title="Delete span"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteAnn(a.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card txl-panel">
          <h4 className="txl-panel__title">Export</h4>
          <div className="input-group txl-panel__group">
            <label>Format</label>
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as TextExportFormat)}
            >
              <option value="jsonl">JSONL</option>
              <option value="csv">CSV</option>
              <option value="spans-jsonl">spaCy spans JSONL</option>
            </select>
          </div>
          <p className="txl-hint">{EXPORT_INFO[exportFormat]}</p>
          <button className="btn btn--primary btn--sm" onClick={handleExport} disabled={exporting}>
            {exporting ? "Exporting…" : "Download"}
          </button>
        </div>

        <div className="card txl-panel">
          <h4 className="txl-panel__title">Upload more</h4>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,text/plain"
            className="txl-file"
            onChange={(e) => setUploadFiles(Array.from(e.target.files ?? []))}
          />
          <div className="input-group txl-panel__group">
            <label>Split strategy</label>
            <select
              value={uploadStrategy}
              onChange={(e) => setUploadStrategy(e.target.value as TextSplitStrategy)}
            >
              {STRATEGIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn btn--secondary btn--sm"
            onClick={handleUpload}
            disabled={uploading || uploadFiles.length === 0}
          >
            {uploading
              ? "Uploading…"
              : `Upload${uploadFiles.length > 0 ? ` ${uploadFiles.length} file${uploadFiles.length === 1 ? "" : "s"}` : ""}`}
          </button>
        </div>
      </aside>
    </div>
  );
}
