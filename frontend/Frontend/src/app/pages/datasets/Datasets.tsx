import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { datasetApi, inferSourceTypeFromFile } from "../../../shared/api/datasets";
import { imageApi } from "../../../shared/api/images";
import { textApi } from "../../../shared/api/text";
import type { TextDocListItem, TextSplitStrategy } from "../../../shared/api/text";
import "./Datasets.css";

/** Preview wrapper with explicit ← / → arrow buttons AND a custom
 *  drag-to-scroll progress bar that's always visible at the bottom of the
 *  table. The native horizontal scrollbar gets hidden by macOS overlay-mode
 *  / Chrome auto-hide, so we render our own permanent affordance.
 *
 *  Initial state: assume there's content to the right so the affordance
 *  appears immediately on render; ResizeObserver corrects it on first paint. */
function PreviewScroller({ children }: { children: React.ReactNode }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  // Start true so the right-arrow + scrollbar render before the
  // ResizeObserver fires for the first time.
  const [canRight, setCanRight] = useState(true);
  const [thumbLeftPct, setThumbLeftPct] = useState(0);
  const [thumbWidthPct, setThumbWidthPct] = useState(100);
  const [overflow, setOverflow] = useState(false);

  const update = () => {
    const el = scrollRef.current;
    if (!el) return;
    const overflowing = el.scrollWidth - el.clientWidth > 4;
    setOverflow(overflowing);
    setCanLeft(el.scrollLeft > 4);
    setCanRight(overflowing && el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    const ratio = el.clientWidth / Math.max(1, el.scrollWidth);
    const w = Math.max(8, ratio * 100); // % width, never thinner than 8%
    const left = (el.scrollLeft / Math.max(1, el.scrollWidth - el.clientWidth)) * (100 - w);
    setThumbWidthPct(w);
    setThumbLeftPct(isFinite(left) ? left : 0);
  };

  useEffect(() => {
    update();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Also re-check after a tick in case the inner table's width changes
    // after data arrives (the initial paint may have empty rows).
    const t = setTimeout(update, 200);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); clearTimeout(t); };
  }, []);

  const nudge = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(220, el.clientWidth * 0.7), behavior: "smooth" });
  };

  // Drag-to-scroll on the custom thumb.
  const onThumbDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const track = thumbRef.current?.parentElement;
    const el = scrollRef.current;
    if (!track || !el) return;
    const trackRect = track.getBoundingClientRect();
    const startX = e.clientX;
    const startLeftPct = thumbLeftPct;
    const onMove = (mv: MouseEvent) => {
      const dx = mv.clientX - startX;
      const dxPct = (dx / trackRect.width) * 100;
      const newLeftPct = Math.max(0, Math.min(100 - thumbWidthPct, startLeftPct + dxPct));
      // Map thumb position back to scrollLeft.
      const maxScroll = el.scrollWidth - el.clientWidth;
      el.scrollLeft = (newLeftPct / Math.max(0.001, 100 - thumbWidthPct)) * maxScroll;
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div className="ds-preview">
      <div className="ds-preview-scroll" ref={scrollRef}>
        {children}
      </div>
      {canLeft && (
        <button type="button" className="ds-preview-nav ds-preview-nav--left"
          onClick={() => nudge(-1)} aria-label="Scroll columns left">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
      )}
      {canRight && (
        <button type="button" className="ds-preview-nav ds-preview-nav--right"
          onClick={() => nudge(1)} aria-label="Scroll columns right">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      )}
      {/* Custom always-visible drag scrollbar. Lives on top of the table at
          its bottom edge so the user never has to hunt for a hidden native
          scrollbar. */}
      {overflow && (
        <div className="ds-preview-scrollbar">
          <div
            ref={thumbRef}
            className="ds-preview-scrollbar__thumb"
            onMouseDown={onThumbDragStart}
            style={{ left: `${thumbLeftPct}%`, width: `${thumbWidthPct}%` }}
            aria-label="Drag to scroll columns"
          />
        </div>
      )}
    </div>
  );
}

interface Dataset {
  id: string; name: string; description?: string; status?: string;
  source_type?: string; row_count?: number; version_count?: number; created_at: string;
}

interface PreviewBundle {
  columns: string[]; rows: string[][]; row_count?: number; truncated: boolean;
}
interface ImageThumb { id: string; file_name: string; thumbnail_url?: string }
interface TextPreviewBundle { docs: TextDocListItem[]; total: number }

type DatasetType = "tabular" | "image" | "text";
const TABULAR_ACCEPT = ".csv,.json,.jsonl,.tsv,.txt";
const TEXT_ACCEPT = ".txt,.md";
const IMAGE_BATCH = 20;
const STATUS_KEYS = ["ready", "processed", "labeled", "reviewed", "raw"];

function relativeTime(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const d = Date.now() - t;
  const min = Math.floor(d / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function statusClass(status?: string): string {
  const s = (status || "").toLowerCase();
  return STATUS_KEYS.includes(s) ? s : "raw";
}

const isImageFile = (f: File): boolean =>
  f.type.startsWith("image/") || /\.(png|jpe?g|webp|tiff?|bmp|gif)$/i.test(f.name);

const withToken = (url?: string | null): string => {
  if (!url) return "";
  const token = localStorage.getItem("orc_token") || "";
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
};

export default function Datasets() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [previews, setPreviews] = useState<Record<string, PreviewBundle>>({});
  const [imagePreviews, setImagePreviews] = useState<Record<string, ImageThumb[]>>({});
  const [imageTotals, setImageTotals] = useState<Record<string, number>>({});
  const [textPreviews, setTextPreviews] = useState<Record<string, TextPreviewBundle>>({});

  // Upload modal state
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [datasetType, setDatasetType] = useState<DatasetType>("tabular");
  const [textStrategy, setTextStrategy] = useState<TextSplitStrategy>("auto");
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [gallery, setGallery] = useState<{ id: string; name: string } | null>(null);
  const [galleryImgs, setGalleryImgs] = useState<ImageThumb[]>([]);
  const [galleryTotal, setGalleryTotal] = useState(0);
  const [galleryLoading, setGalleryLoading] = useState(false);

  // Run preview-fetching tasks with bounded concurrency so a slow MinIO read
  // for one dataset doesn't hold up the rest, and a 12s hard timeout so the
  // card flips to "Preview unavailable" rather than spinning forever.
  const runWithLimit = async <T,>(items: T[], limit: number, fn: (t: T) => Promise<void>) => {
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try { await fn(items[idx]); } catch { /* swallowed per-item */ }
      }
    });
    await Promise.all(workers);
  };

  const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("preview-timeout")), ms);
      p.then((v) => { clearTimeout(t); resolve(v); })
       .catch((e) => { clearTimeout(t); reject(e); });
    });

  const load = useCallback(() => {
    setLoading(true);
    datasetApi.list({ limit: 100 }).then((r) => {
      const list: Dataset[] = Array.isArray(r.data) ? r.data : r.data.datasets || [];
      setDatasets(list);
      // Cap to 4 concurrent preview requests with a 12s timeout each.
      runWithLimit(list, 4, async (d) => {
        if (d.source_type === "image") {
          try {
            const res = await withTimeout(imageApi.getGallery(d.id, { limit: 6 }), 12000);
            setImagePreviews((prev) => ({ ...prev, [d.id]: res.data.images || [] }));
            setImageTotals((prev) => ({ ...prev, [d.id]: res.data.total || 0 }));
          } catch {
            setImagePreviews((prev) => ({ ...prev, [d.id]: [] }));
          }
        } else if (d.source_type === "text") {
          try {
            const res = await withTimeout(textApi.listDocuments(d.id, { limit: 3 }), 12000);
            setTextPreviews((prev) => ({
              ...prev,
              [d.id]: { docs: res.data.items || [], total: res.data.total || 0 },
            }));
          } catch {
            setTextPreviews((prev) => ({ ...prev, [d.id]: { docs: [], total: 0 } }));
          }
        } else {
          try {
            const res = await withTimeout(datasetApi.getPreview(d.id, 10), 12000);
            setPreviews((prev) => ({ ...prev, [d.id]: res.data }));
          } catch {
            setPreviews((prev) => ({
              ...prev,
              [d.id]: { columns: [], rows: [], truncated: false },
            }));
          }
        }
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Let the folder input pick a whole directory (recursively).
  useEffect(() => {
    const el = folderInputRef.current;
    if (el) { el.setAttribute("webkitdirectory", ""); el.setAttribute("directory", ""); }
  }, [datasetType, showUpload]);

  const openGallery = async (d: Dataset) => {
    setGallery({ id: d.id, name: d.name });
    setGalleryImgs([]); setGalleryTotal(0); setGalleryLoading(true);
    try {
      const acc: ImageThumb[] = [];
      let skip = 0; const page = 100; let total = 0;
      for (;;) {
        const res = await imageApi.getGallery(d.id, { skip, limit: page });
        const imgs: ImageThumb[] = res.data.images || [];
        total = res.data.total ?? acc.length + imgs.length;
        acc.push(...imgs);
        setGalleryImgs([...acc]); setGalleryTotal(total);
        skip += page;
        if (imgs.length < page || acc.length >= total || acc.length >= 2000) break;
      }
    } catch { /* show whatever loaded */ }
    finally { setGalleryLoading(false); }
  };

  const resetForm = () => {
    setShowUpload(false);
    setFiles([]); setName(""); setDesc("");
    setDatasetType("tabular"); setTextStrategy("auto"); setUploadMsg("");
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) return;
    setUploading(true); setUploadMsg("");
    try {
      const defaultName = files[0].name.replace(/\.[^.]+$/, "");
      const created = await datasetApi.create({
        name: name.trim() || (datasetType === "image" ? `${defaultName} (images)` : defaultName),
        description: desc || undefined,
        source_type: datasetType === "image" ? "image"
          : datasetType === "text" ? "text"
          // Explicit "Tabular data" choice wins: a .txt here is parsed as a
          // delimited table, so never let inference flip it to "text".
          : (() => { const t = inferSourceTypeFromFile(files[0]); return t === "text" ? "csv" : t; })(),
      });
      const newId = created.data?.id;
      if (newId) {
        if (datasetType === "image") {
          const imageFiles = files.filter(isImageFile);
          if (imageFiles.length === 0) throw new Error("No image files selected");
          for (let i = 0; i < imageFiles.length; i += IMAGE_BATCH) {
            setUploadMsg(`Uploading images ${i + 1}-${Math.min(i + IMAGE_BATCH, imageFiles.length)} of ${imageFiles.length}...`);
            await imageApi.uploadBatch(newId, imageFiles.slice(i, i + IMAGE_BATCH));
          }
        } else if (datasetType === "text") {
          setUploadMsg(`Uploading ${files.length} text file${files.length === 1 ? "" : "s"}...`);
          await textApi.upload(newId, files, textStrategy);
        } else {
          await datasetApi.upload(newId, files[0]);
        }
      }
      resetForm();
      load();
    } catch (err) {
      // The backend returns either a plain string `detail` or a structured
      // `{ message, errors: [...] }` payload for validation failures. Surface
      // whichever we get so the user sees the real reason, not just a 400.
      const e = err as {
        response?: {
          status?: number;
          data?: {
            detail?: unknown;
            message?: string;
            errors?: string[];
          };
        };
        message?: string;
      };
      const status = e.response?.status;
      const detail = e.response?.data?.detail;
      let msg = "";
      if (typeof detail === "string") {
        msg = detail;
      } else if (detail && typeof detail === "object") {
        const d = detail as { message?: string; errors?: string[] };
        msg = d.message ? d.message : "";
        if (d.errors && d.errors.length > 0) {
          msg = (msg ? msg + ": " : "") + d.errors.join("; ");
        }
      }
      if (!msg) msg = e.response?.data?.message || e.message || "Unknown error";
      alert(`Upload failed${status ? ` (${status})` : ""}: ${msg}`);
    }
    finally { setUploading(false); setUploadMsg(""); }
  };

  const onFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFiles(e.target.files ? Array.from(e.target.files) : []);
  };

  const imageCount = files.filter(isImageFile).length;

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(
      `Delete dataset "${name}"?\n\n` +
      "This will also remove all uploaded files, processing results, " +
      "and labeling runs tied to it. This can't be undone."
    )) return;
    setDeletingId(id);
    try {
      await datasetApi.delete(id);
      // Optimistically drop from local state so the UI doesn't wait for the
      // next list reload.
      setDatasets((prev) => prev.filter((d) => d.id !== id));
      setPreviews((prev) => { const c = { ...prev }; delete c[id]; return c; });
      setImagePreviews((prev) => { const c = { ...prev }; delete c[id]; return c; });
      setImageTotals((prev) => { const c = { ...prev }; delete c[id]; return c; });
      setTextPreviews((prev) => { const c = { ...prev }; delete c[id]; return c; });
    } catch (err) {
      const e = err as { response?: { status?: number; data?: { detail?: unknown } } };
      const detail = e.response?.data?.detail;
      const msg = typeof detail === "string" ? detail
        : e.response?.status === 403 ? "You don't have permission to delete datasets (admin role required)."
        : "Delete failed.";
      alert(msg);
    } finally {
      setDeletingId(null);
    }
  };

  // ── Preview renderers ──
  const renderTabularPreview = (d: Dataset) => {
    const p = previews[d.id];
    if (p === undefined) {
      return <div className="ds-preview-empty">Loading preview…</div>;
    }
    if (!p.columns.length || !p.rows.length) {
      return <div className="ds-preview-empty">No preview available for this dataset.</div>;
    }
    return (
      <>
        <PreviewScroller>
          <table className="ds-preview-table">
            <thead>
              <tr>{p.columns.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {p.rows.map((row, i) => (
                <tr key={i}>
                  {p.columns.map((_, j) => (
                    <td key={j} title={row[j] ?? ""}>{row[j] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </PreviewScroller>
        <div className="ds-preview-foot">
          {p.columns.length} column{p.columns.length === 1 ? "" : "s"}
          {p.truncated && p.row_count != null
            ? ` · showing first ${p.rows.length} of ${p.row_count.toLocaleString()} rows`
            : p.row_count != null ? ` · ${p.row_count.toLocaleString()} rows total` : ""}
          <span style={{marginLeft: 10, opacity: 0.7}}>← scroll →</span>
        </div>
      </>
    );
  };

  const renderImagePreview = (d: Dataset) => {
    const imgs = imagePreviews[d.id];
    const total = imageTotals[d.id] ?? 0;
    if (imgs === undefined) {
      return <div className="ds-preview-empty">Loading thumbnails…</div>;
    }
    if (imgs.length === 0) {
      return <div className="ds-preview-empty">No images uploaded to this dataset yet.</div>;
    }
    const slots: (ImageThumb | null)[] = [...imgs];
    while (slots.length < 6) slots.push(null);
    const extra = Math.max(0, total - imgs.length);
    return (
      <div className="ds-image-strip">
        {slots.slice(0, 5).map((it, i) => (
          <div key={i} className="ds-image-strip__cell">
            {it && it.thumbnail_url ? (
              <img src={withToken(it.thumbnail_url)} alt={it.file_name} loading="lazy" />
            ) : (
              <span className="ds-image-strip__placeholder">—</span>
            )}
          </div>
        ))}
        <div className="ds-image-strip__cell">
          {extra > 0 ? (
            <span className="ds-image-strip__more" role="button" tabIndex={0} style={{ cursor: "pointer" }} onClick={() => openGallery(d)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") openGallery(d); }}>+{extra} more</span>
          ) : slots[5] && slots[5].thumbnail_url ? (
            <img src={withToken(slots[5]!.thumbnail_url)} alt={slots[5]!.file_name} loading="lazy" />
          ) : (
            <span className="ds-image-strip__placeholder">—</span>
          )}
        </div>
      </div>
    );
  };

  const renderTextPreview = (d: Dataset) => {
    const tp = textPreviews[d.id];
    if (tp === undefined) {
      return <div className="ds-preview-empty">Loading documents…</div>;
    }
    if (tp.docs.length === 0) {
      return <div className="ds-preview-empty">No text documents uploaded to this dataset yet.</div>;
    }
    return (
      <div className="ds-doc-list">
        {tp.docs.map((doc) => (
          <div key={doc.id} className="ds-doc">
            <span className="ds-doc__name" title={doc.name}>{doc.name}</span>
            <p className="ds-doc__preview">{doc.preview}</p>
          </div>
        ))}
        <div className="ds-doc-foot">
          <span>{tp.total.toLocaleString()} document{tp.total === 1 ? "" : "s"}</span>
          <Link to={`/text-labeling/${d.id}`} className="ds-doc-foot__open">Open labeler →</Link>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="ds-header">
        <div>
          <h1>Datasets</h1>
          <p>Your data assets — each shows a live preview right here</p>
        </div>
        <button className="btn btn--primary ds-header__add" onClick={() => setShowUpload(true)}>
          + New Dataset
        </button>
      </div>

      {loading ? (
        <div className="empty-state"><h3>Loading datasets...</h3></div>
      ) : datasets.length === 0 ? (
        <div className="empty-state">
          <h3>No datasets yet</h3>
          <p style={{marginTop: 8}}>Click "+ New Dataset" to upload your first one.</p>
        </div>
      ) : (
        <div className="ds-list">
          {datasets.map((d) => {
            const isImage = d.source_type === "image";
            const isText = d.source_type === "text";
            // Tabular: show real count when known, "— rows" when unknown
            // (preview is what proves whether the dataset actually has data
            // — the row_count field can lag for legacy versions).
            const previewRowCount = previews[d.id]?.row_count;
            const knownRows = d.row_count ?? previewRowCount;
            const rowsLabel = isImage
              ? `${(imageTotals[d.id] ?? 0).toLocaleString()} image${(imageTotals[d.id] ?? 0) === 1 ? "" : "s"}`
              : isText
                ? `${(textPreviews[d.id]?.total ?? 0).toLocaleString()} document${(textPreviews[d.id]?.total ?? 0) === 1 ? "" : "s"}`
                : knownRows != null
                  ? `${knownRows.toLocaleString()} row${knownRows === 1 ? "" : "s"}`
                  : "— rows";
            return (
              <div key={d.id} className="ds-card">
                <div className="ds-card__head">
                  <div className={`ds-card__icon ds-card__icon--${isImage ? "image" : isText ? "text" : "tabular"}`}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      {isImage ? (
                        <path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 21" />
                      ) : isText ? (
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M9 13h6M9 17h6M9 9h1" />
                      ) : (
                        <path d="M12 2C6.5 2 2 4 2 6.5v11C2 20 6.5 22 12 22s10-2 10-4.5v-11C22 4 17.5 2 12 2zM2 9.5c0 2.5 4.5 4.5 10 4.5s10-2 10-4.5" />
                      )}
                    </svg>
                  </div>
                  <div className="ds-card__text">
                    <Link to={`/datasets/${d.id}`} className="ds-card__name">{d.name}</Link>
                    <div className="ds-card__meta">
                      <span>{isImage ? "Image dataset" : isText ? "Text dataset" : "Tabular dataset"}</span>
                      <span className="ds-card__meta-sep">•</span>
                      <span>{rowsLabel}</span>
                      <span className="ds-card__meta-sep">•</span>
                      <span>created {relativeTime(d.created_at)}</span>
                    </div>
                  </div>
                  <span className={`ds-status ds-status--${statusClass(d.status)}`}>{d.status || "raw"}</span>
                  <Link to={`/datasets/${d.id}`} className="ds-card__open">
                    Open
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                      <path d="M2.5 7h9M7 2.5L11.5 7 7 11.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </Link>
                  <button
                    type="button"
                    className="ds-card__delete"
                    onClick={() => handleDelete(d.id, d.name)}
                    disabled={deletingId === d.id}
                    title={`Delete "${d.name}"`}
                    aria-label={`Delete ${d.name}`}>
                    {deletingId === d.id ? (
                      <span style={{fontSize: 12.5, fontWeight: 600}}>...</span>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6"/>
                      </svg>
                    )}
                  </button>
                </div>
                {isImage ? renderImagePreview(d) : isText ? renderTextPreview(d) : renderTabularPreview(d)}
              </div>
            );
          })}
          {/* Inline "add another" tile — always there so the user never loses
              their way to upload a second dataset, even if the page header
              scrolled out of view. */}
          <button type="button" className="ds-add-tile" onClick={() => setShowUpload(true)}>
            <span className="ds-add-tile__plus">+</span>
            <span className="ds-add-tile__label">Add another dataset</span>
            <span className="ds-add-tile__sub">CSV, JSON, JSONL, TSV, TXT, or images</span>
          </button>
        </div>
      )}

      {/* ── Upload modal (unchanged behaviour, just preserved) ── */}
      {showUpload && (
        <div className="modal-overlay" onClick={resetForm}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New Dataset</h2>
            <form onSubmit={handleUpload}>
              <div className="input-group">
                <label>Dataset type</label>
                <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10}}>
                  {([
                    { key: "tabular", title: "Tabular data", sub: "CSV, JSON, JSONL, TSV, TXT" },
                    { key: "image", title: "Image dataset", sub: "PNG, JPG, WEBP, BMP, TIFF" },
                    { key: "text", title: "Text (.txt)", sub: "TXT, MD — labelable documents" },
                  ] as { key: DatasetType; title: string; sub: string }[]).map((opt) => (
                    <button type="button" key={opt.key}
                      onClick={() => { setDatasetType(opt.key); setFiles([]); }}
                      style={{
                        textAlign: "left", padding: "12px 14px", borderRadius: 12,
                        border: `1.5px solid ${datasetType === opt.key ? "var(--brand-indigo)" : "var(--dash-border)"}`,
                        background: datasetType === opt.key ? "var(--dash-primary-dim)" : "#fff",
                        cursor: "pointer",
                      }}>
                      <div style={{fontWeight: 700, fontSize: 14.5, color: "var(--dash-text)"}}>{opt.title}</div>
                      <div style={{fontSize: 12.5, color: "var(--dash-text-muted)", marginTop: 2}}>{opt.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="input-group">
                <label>Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My dataset" required />
              </div>
              <div className="input-group">
                <label>Description (optional)</label>
                <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Dataset description" rows={2} />
              </div>

              {datasetType === "tabular" ? (
                <div className="input-group">
                  <label>File (CSV, JSON, JSONL, TSV, TXT)</label>
                  <input type="file" accept={TABULAR_ACCEPT} onChange={onFilesPicked} required />
                </div>
              ) : datasetType === "text" ? (
                <>
                  <div className="input-group">
                    <label>Text files (TXT, MD)</label>
                    <input type="file" accept={TEXT_ACCEPT} multiple onChange={onFilesPicked} required />
                    {files.length > 0 && (
                      <p style={{fontSize: 13, color: "var(--dash-text-muted)", marginTop: 8}}>
                        {files.length} file{files.length === 1 ? "" : "s"} selected
                      </p>
                    )}
                  </div>
                  <div className="input-group">
                    <label>Split strategy</label>
                    <select value={textStrategy} onChange={(e) => setTextStrategy(e.target.value as TextSplitStrategy)}>
                      <option value="auto">Auto (recommended)</option>
                      <option value="file">Whole file = one document</option>
                      <option value="blank_line">Split on blank lines</option>
                      <option value="line">One document per line</option>
                    </select>
                    <p className="ds-field-hint">How to break files into labelable documents</p>
                  </div>
                </>
              ) : (
                <div className="input-group">
                  <label>Images — pick files or a whole folder</label>
                  <div className="ds-imgpick">
                    <label className="btn btn--secondary ds-imgpick__btn">
                      Select images
                      <input type="file" accept="image/*" multiple onChange={onFilesPicked} />
                    </label>
                    <label className="btn btn--secondary ds-imgpick__btn">
                      Select a folder
                      <input ref={folderInputRef} type="file" multiple onChange={onFilesPicked} />
                    </label>
                  </div>
                  {imageCount > 0 && (
                    <p style={{fontSize: 13, color: "var(--dash-text-muted)", marginTop: 8}}>
                      {imageCount} image{imageCount === 1 ? "" : "s"} selected
                    </p>
                  )}
                </div>
              )}

              {uploadMsg && (
                <p style={{fontSize: 13.5, color: "var(--dash-primary)", marginBottom: 12}}>{uploadMsg}</p>
              )}

              <div style={{display: "flex", gap: 12, justifyContent: "flex-end"}}>
                <button type="button" className="btn btn--secondary" onClick={resetForm}>Cancel</button>
                <button type="submit" className="btn btn--primary" disabled={uploading || (datasetType === "image" ? imageCount === 0 : files.length === 0) || !name.trim()}>
                  {uploading ? "Uploading..." : "Create Dataset"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {gallery && (
        <div className="modal-overlay" onClick={() => setGallery(null)}>
          <div className="modal ds-gallery-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ds-gallery-modal__head">
              <h2>{gallery.name} — {galleryTotal.toLocaleString()} image{galleryTotal === 1 ? "" : "s"}</h2>
              <button type="button" className="ds-gallery-modal__close" onClick={() => setGallery(null)} aria-label="Close">✕</button>
            </div>
            <div className="ds-gallery-grid">
              {galleryImgs.map((it) => (
                <div key={it.id} className="ds-gallery-tile" title={it.file_name}>
                  {it.thumbnail_url
                    ? <img src={withToken(it.thumbnail_url)} alt={it.file_name} loading="lazy" />
                    : <span className="ds-gallery-tile__ph">—</span>}
                  <span className="ds-gallery-tile__name">{it.file_name}</span>
                </div>
              ))}
            </div>
            {galleryLoading
              ? <div className="ds-gallery-loading">Loading… {galleryImgs.length}{galleryTotal ? ` / ${galleryTotal}` : ""}</div>
              : galleryImgs.length === 0 && <div className="ds-preview-empty">No images in this dataset.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
