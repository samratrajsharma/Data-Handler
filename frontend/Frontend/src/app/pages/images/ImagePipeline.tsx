import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { datasetApi } from "../../../shared/api/datasets";
import { imageApi } from "../../../shared/api/images";
import { useTaskPolling } from "../../hooks/usePolling";
import TaskMonitor from "../../components/TaskMonitor/TaskMonitor";
import "./ImagePipeline.css";

interface ImageAsset {
  id: string; file_name: string; width?: number; height?: number;
  mime_type?: string; file_size?: number; cluster_id?: number;
  thumbnail_url?: string; original_url?: string;
}

const PAGE_SIZE = 50;

export default function ImagePipeline() {
  const [datasets, setDatasets] = useState<Array<{id:string; name:string; source_type?:string}>>([]);
  const [datasetId, setDatasetId] = useState("");
  const [tab, setTab] = useState<"gallery" | "clusters" | "search">("gallery");
  const [gallery, setGallery] = useState<ImageAsset[]>([]);
  const [totalImages, setTotalImages] = useState(0);
  const [page, setPage] = useState(0);
  const [clusters, setClusters] = useState<Record<string, unknown> | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{asset: ImageAsset; score: number}>>([]);
  const [searchTopK, setSearchTopK] = useState(20);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [selectedImage, setSelectedImage] = useState<ImageAsset | null>(null);
  const [searchError, setSearchError] = useState("");
  const [clusterFilter, setClusterFilter] = useState<number | null>(null);
  const { task, steps, stuck, progressPct } = useTaskPolling(taskId);
  const [modelReady, setModelReady] = useState<boolean | null>(null);
  const [preparingModel, setPreparingModel] = useState(false);
  const [embeddingsDone, setEmbeddingsDone] = useState(false);
  const [lastRun, setLastRun] = useState<"embeddings" | "clustering" | "prepare" | null>(null);
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    // Only image-type datasets are usable here — they are created and
    // populated on the Datasets page.
    datasetApi.list({ limit: 100 }).then((r) => {
      const all = Array.isArray(r.data) ? r.data : r.data.datasets || [];
      setDatasets(all.filter((d: {source_type?: string}) => d.source_type === "image"));
    }).catch(() => {});
  }, []);

  // CLIP model readiness — drives the "Prepare model" step.
  const refreshModelStatus = useCallback(() => {
    imageApi.modelStatus()
      .then((r) => setModelReady(!!r.data.ready))
      .catch(() => setModelReady(true)); // don't block the UI if unavailable
  }, []);
  useEffect(() => { refreshModelStatus(); }, [refreshModelStatus]);

  const loadGallery = useCallback(() => {
    if (!datasetId) return;
    const params: Record<string, number> = { limit: PAGE_SIZE, skip: page * PAGE_SIZE };
    if (clusterFilter !== null) (params as Record<string, number>).cluster_id = clusterFilter;
    imageApi.getGallery(datasetId, params).then((r) => {
      setGallery(r.data.images || []);
      setTotalImages(r.data.total || 0);
      if (typeof r.data.embedded_count === "number") setEmbeddingsDone(r.data.embedded_count > 0);
    }).catch(() => {});
  }, [datasetId, page, clusterFilter]);

  useEffect(() => { loadGallery(); }, [loadGallery]);

  // Handle completion exactly once per task id — a fast task that ends in the
  // same "completed" status as the previous one would otherwise be missed.
  useEffect(() => {
    if (!task || !taskId) return;
    if (task.status !== "completed" && task.status !== "failed") return;
    if (handledRef.current === taskId) return;
    handledRef.current = taskId;
    setRunning(false);
    if (lastRun === "prepare") setPreparingModel(false);
    if (task.status === "completed") {
      if (lastRun === "clustering") { loadClusters(); setTab("clusters"); }
      else if (lastRun === "prepare") { setModelReady(true); }
      else { setEmbeddingsDone(true); loadGallery(); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.status, taskId, lastRun]);

  // Auto-load clusters when the Clusters tab is opened.
  useEffect(() => {
    if (tab === "clusters" && datasetId && !clusters) loadClusters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, datasetId]);

  // Proxied image URLs are loaded by <img> tags, which cannot send an
  // Authorization header — append the JWT as a query param so they resolve.
  const withToken = (url?: string | null): string => {
    if (!url) return "";
    const token = localStorage.getItem("orc_token") || "";
    return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  };

  const runEmbeddings = async () => {
    if (!datasetId) return;
    setLastRun("embeddings");
    setRunning(true);
    try {
      const res = await imageApi.generateEmbeddings(datasetId);
      setTaskId(res.data.task_id);
    } catch { setRunning(false); alert("Failed to start embedding generation"); }
  };

  const runClustering = async () => {
    if (!datasetId) return;
    setLastRun("clustering");
    setRunning(true);
    try {
      const res = await imageApi.cluster(datasetId);
      setTaskId(res.data.task_id);
    } catch { setRunning(false); alert("Failed to start clustering"); }
  };

  const prepareModel = async () => {
    if (!datasetId) return;
    setLastRun("prepare");
    setPreparingModel(true);
    setRunning(true);
    try {
      const res = await imageApi.prepareModel(datasetId);
      setTaskId(res.data.task_id);
    } catch {
      setPreparingModel(false); setRunning(false);
      alert("Failed to start model preparation. Make sure the worker is running.");
    }
  };

  const loadClusters = () => {
    if (!datasetId) return;
    imageApi.getClusters(datasetId).then((r) => setClusters(r.data)).catch(() => {});
  };

  const handleSearch = async () => {
    if (!datasetId || !searchQuery.trim()) return;
    setSearchError("");
    try {
      const res = await imageApi.search(datasetId, searchQuery.trim(), searchTopK);
      setSearchResults(Array.isArray(res.data) ? res.data : []);
    } catch (err: unknown) {
      const msg = (err && typeof err === "object" && "response" in err)
        ? ((err as { response?: { data?: { detail?: string } } }).response?.data?.detail || "Search failed")
        : "Search failed — make sure embeddings have been generated first";
      setSearchError(String(msg));
      setSearchResults([]);
    }
  };

  const handleDelete = async (img: ImageAsset) => {
    if (!confirm(`Delete "${img.file_name}"? This cannot be undone.`)) return;
    try {
      await imageApi.deleteAsset(datasetId, img.id);
      setSelectedImage(null);
      loadGallery();
    } catch { alert("Delete failed"); }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const totalPages = Math.ceil(totalImages / PAGE_SIZE);

  // Extract cluster IDs from cluster data
  const clusterIds: number[] = clusters
    ? Object.keys((clusters as Record<string, unknown>).cluster_summary || {}).map(Number).sort((a, b) => a - b)
    : [];

  return (
    <div>
      <div className="page-header" style={{display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12}}>
        <div>
          <h1>Image Pipeline</h1>
          <p>Select an image dataset to embed, cluster, and search its images with CLIP</p>
        </div>
        {datasetId && (
          <Link to={`/annotate/${datasetId}`} className="btn btn--primary"
            title="Open the manual annotation editor">
            Annotate &rarr;
          </Link>
        )}
      </div>

      {/* Controls — a guided, ordered pipeline */}
      <div className="card pipe" style={{marginBottom: 20}}>
        <div className="pipe__top">
          <div className="input-group" style={{marginBottom: 0, minWidth: 260}}>
            <label style={{fontSize: 12}}>Image dataset</label>
            <select value={datasetId} onChange={(e) => { setDatasetId(e.target.value); setPage(0); setClusterFilter(null); setClusters(null); setEmbeddingsDone(false); }}>
              <option value="">Select image dataset</option>
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>

        {!datasetId ? (
          <p style={{marginTop: 12, fontSize: 13, color: "var(--dash-text-muted)"}}>
            {datasets.length === 0
              ? <>No image datasets yet. Create one on the{" "}
                  <Link to="/datasets" style={{color:"var(--dash-primary)", fontWeight:600}}>Datasets page</Link>
                  {" "}— choose &quot;Image dataset&quot; and upload your images there.</>
              : "Select an image dataset above to embed, cluster and search its images."}
          </p>
        ) : (
          <>
            <div className="pipe__steps">
              <div className={`pipe-step ${modelReady ? "pipe-step--done" : ""}`}>
                <span className="pipe-step__n">{modelReady ? "\u2713" : "1"}</span>
                <div className="pipe-step__body">
                  <div className="pipe-step__title">CLIP model</div>
                  <div className="pipe-step__sub">
                    {modelReady ? "Ready — no download needed"
                      : preparingModel ? "Preparing… one-time download, this can take a few minutes"
                      : "One-time setup so images can be turned into vectors"}
                  </div>
                </div>
                <div className="pipe-step__action">
                  {modelReady ? <span className="pipe-tag pipe-tag--ok">Ready</span>
                    : preparingModel ? <span className="pipe-tag pipe-tag--busy">Preparing…</span>
                    : <button className="btn btn--secondary btn--sm" onClick={prepareModel}>Prepare model</button>}
                </div>
              </div>
              <div className="pipe__arrow">→</div>
              <div className={`pipe-step ${embeddingsDone ? "pipe-step--done" : ""}`}>
                <span className="pipe-step__n">{embeddingsDone ? "\u2713" : "2"}</span>
                <div className="pipe-step__body">
                  <div className="pipe-step__title">Generate embeddings</div>
                  <div className="pipe-step__sub">Turns every image into a vector. Required before clustering and search.</div>
                </div>
                <div className="pipe-step__action">
                  <button className="btn btn--primary btn--sm" onClick={runEmbeddings}
                    disabled={!modelReady || running}
                    title={!modelReady ? "Prepare the model first" : ""}>
                    {embeddingsDone ? "Re-generate" : "Generate"}
                  </button>
                </div>
              </div>
              <div className="pipe__arrow">→</div>
              <div className="pipe-step">
                <span className="pipe-step__n">3</span>
                <div className="pipe-step__body">
                  <div className="pipe-step__title">Cluster</div>
                  <div className="pipe-step__sub">Groups visually-similar images. Browse them in the Clusters tab.</div>
                </div>
                <div className="pipe-step__action">
                  <button className="btn btn--secondary btn--sm" onClick={runClustering}
                    disabled={!embeddingsDone || running}
                    title={!embeddingsDone ? "Generate embeddings first" : ""}>
                    Run clustering
                  </button>
                </div>
              </div>
            </div>
            <p className="pipe__hint">
              Flow: prepare the model once → generate embeddings → then cluster similar images, or search by text in the Search tab.
            </p>
          </>
        )}

        <TaskMonitor task={task} steps={steps} stuck={stuck} progressPct={progressPct} running={running} />
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${tab === "gallery" ? "tab--active" : ""}`} onClick={() => setTab("gallery")}>Gallery ({totalImages})</button>
        <button className={`tab ${tab === "clusters" ? "tab--active" : ""}`} onClick={() => setTab("clusters")}>Clusters</button>
        <button className={`tab ${tab === "search" ? "tab--active" : ""}`} onClick={() => setTab("search")}>Search</button>
      </div>

      {/* ── Gallery Tab ── */}
      {tab === "gallery" && (
        <div>
          {/* Cluster filter bar */}
          {clusterIds.length > 0 && (
            <div className="cluster-filter-bar">
              <button className={`cluster-chip ${clusterFilter === null ? "cluster-chip--active" : ""}`}
                onClick={() => { setClusterFilter(null); setPage(0); }}>All</button>
              {clusterIds.map((cid) => (
                <button key={cid}
                  className={`cluster-chip ${clusterFilter === cid ? "cluster-chip--active" : ""}`}
                  onClick={() => { setClusterFilter(cid); setPage(0); }}>
                  Cluster {cid}
                </button>
              ))}
            </div>
          )}

          {gallery.length > 0 ? (
            <>
              <div className="image-grid">
                {gallery.map((img) => (
                  <div key={img.id} className="image-card" onClick={() => setSelectedImage(img)}>
                    <div className="image-card__img">
                      {img.thumbnail_url ? (
                        <img src={withToken(img.thumbnail_url)} alt={img.file_name} loading="lazy" />
                      ) : (
                        <div className="image-card__placeholder">No preview</div>
                      )}
                    </div>
                    <div className="image-card__info">
                      <span className="image-card__name" title={img.file_name}>{img.file_name}</span>
                      <span className="image-card__meta">
                        {img.width && img.height ? `${img.width}x${img.height}` : ""}
                        {img.cluster_id != null ? ` | C${img.cluster_id}` : ""}
                        {img.file_size ? ` | ${formatSize(img.file_size)}` : ""}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="img-pagination">
                  <button className="btn btn--sm btn--secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                    Previous
                  </button>
                  <span className="img-pagination__info">
                    Page {page + 1} of {totalPages} ({totalImages} images)
                  </span>
                  <button className="btn btn--sm btn--secondary" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                    Next
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <h3>No images in this dataset</h3>
              <p>Images are added when the dataset is created on the Datasets page</p>
            </div>
          )}
        </div>
      )}

      {/* ── Clusters Tab ── */}
      {tab === "clusters" && (
        clusters ? (
          <div className="card">
            {/* Cluster summary cards */}
            <div className="cluster-summary">
              {Object.entries((clusters as Record<string, Record<string, number>>).cluster_summary || {})
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([cid, count]) => (
                <div key={cid} className="cluster-stat-card" onClick={() => { setClusterFilter(Number(cid)); setTab("gallery"); setPage(0); }}>
                  <div className="cluster-stat-card__id">Cluster {cid}</div>
                  <div className="cluster-stat-card__count">{count}</div>
                  <div className="cluster-stat-card__label">images</div>
                </div>
              ))}
              {(clusters as Record<string, number>).unclustered_count > 0 && (
                <div className="cluster-stat-card cluster-stat-card--muted">
                  <div className="cluster-stat-card__id">Unclustered</div>
                  <div className="cluster-stat-card__count">{(clusters as Record<string, number>).unclustered_count}</div>
                  <div className="cluster-stat-card__label">images</div>
                </div>
              )}
            </div>
            {/* Cluster thumbnails preview */}
            {Object.entries((clusters as Record<string, Record<string, ImageAsset[]>>).clusters || {}).map(([cid, assets]) => (
              <div key={cid} style={{marginTop: 24}}>
                <h4 style={{color: "var(--dash-text)", marginBottom: 10}}>Cluster {cid} ({assets.length} images)</h4>
                <div className="image-grid">
                  {assets.slice(0, 8).map((img) => (
                    <div key={img.id} className="image-card" onClick={() => setSelectedImage(img)}>
                      <div className="image-card__img">
                        {img.thumbnail_url ? <img src={withToken(img.thumbnail_url)} alt={img.file_name} loading="lazy" /> :
                          <div className="image-card__placeholder">No preview</div>}
                      </div>
                      <div className="image-card__info">
                        <span className="image-card__name">{img.file_name}</span>
                      </div>
                    </div>
                  ))}
                  {assets.length > 8 && (
                    <div className="image-card image-card--more" onClick={() => { setClusterFilter(Number(cid)); setTab("gallery"); setPage(0); }}>
                      <div className="image-card__img" style={{display: "flex", alignItems: "center", justifyContent: "center"}}>
                        <span style={{fontSize: 18, fontWeight: 700, color: "var(--dash-text-muted)"}}>+{assets.length - 8} more</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : <div className="empty-state"><h3>No cluster data</h3><p>Run clustering (step 3 above) to group similar images.</p></div>
      )}

      {/* ── Search Tab ── */}
      {tab === "search" && (
        <div className="card">
          <div style={{display:"flex", gap: 12, marginBottom: 20, flexWrap: "wrap"}}>
            <input style={{flex: 1, minWidth: 200, padding: "10px 14px", background: "var(--dash-bg)", border: "1px solid var(--dash-border)",
              borderRadius: 8, color: "var(--dash-text)", fontSize: 14}}
              value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Describe the image you are looking for..." onKeyDown={(e) => e.key === "Enter" && handleSearch()} />
            <div className="input-group" style={{marginBottom: 0, width: 100}}>
              <select value={searchTopK} onChange={(e) => setSearchTopK(Number(e.target.value))}>
                <option value={10}>Top 10</option>
                <option value={20}>Top 20</option>
                <option value={50}>Top 50</option>
                <option value={100}>Top 100</option>
              </select>
            </div>
            <button className="btn btn--primary" onClick={handleSearch} disabled={!datasetId || !searchQuery.trim()}>
              Search
            </button>
          </div>
          {searchError && (
            <div style={{padding: "12px 16px", background: "rgba(239,68,68,0.1)", borderRadius: 8, marginBottom: 16,
              color: "var(--dash-text-muted)", fontSize: 13, border: "1px solid rgba(239,68,68,0.2)"}}>
              {searchError}
            </div>
          )}
          {searchResults.length > 0 ? (
            <div className="image-grid">
              {searchResults.map((r) => (
                <div key={r.asset.id} className="image-card" onClick={() => setSelectedImage(r.asset)}>
                  <div className="image-card__img">
                    {r.asset.thumbnail_url ? <img src={withToken(r.asset.thumbnail_url)} alt={r.asset.file_name} loading="lazy" /> :
                      <div className="image-card__placeholder">No preview</div>}
                  </div>
                  <div className="image-card__info">
                    <span className="image-card__name">{r.asset.file_name}</span>
                    <span className="image-card__meta img-score">Score: {r.score.toFixed(3)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : !searchError && <div className="empty-state"><h3>Search for images</h3><p>Enter a text description and press Search. Make sure embeddings are generated first.</p></div>}
        </div>
      )}

      {/* ── Image Detail Modal ── */}
      {selectedImage && (
        <div className="img-modal-overlay" onClick={() => setSelectedImage(null)}>
          <div className="img-modal" onClick={(e) => e.stopPropagation()}>
            <button className="img-modal__close" onClick={() => setSelectedImage(null)}>&times;</button>
            <div className="img-modal__image">
              <img src={withToken(selectedImage.original_url || selectedImage.thumbnail_url)} alt={selectedImage.file_name} />
            </div>
            <div className="img-modal__details">
              <h3>{selectedImage.file_name}</h3>
              <div className="img-modal__meta-grid">
                {selectedImage.width && selectedImage.height && (
                  <div className="img-modal__meta-item">
                    <span className="img-modal__meta-label">Dimensions</span>
                    <span className="img-modal__meta-value">{selectedImage.width} x {selectedImage.height}</span>
                  </div>
                )}
                {selectedImage.mime_type && (
                  <div className="img-modal__meta-item">
                    <span className="img-modal__meta-label">Type</span>
                    <span className="img-modal__meta-value">{selectedImage.mime_type}</span>
                  </div>
                )}
                {selectedImage.file_size && (
                  <div className="img-modal__meta-item">
                    <span className="img-modal__meta-label">Size</span>
                    <span className="img-modal__meta-value">{formatSize(selectedImage.file_size)}</span>
                  </div>
                )}
                {selectedImage.cluster_id != null && (
                  <div className="img-modal__meta-item">
                    <span className="img-modal__meta-label">Cluster</span>
                    <span className="img-modal__meta-value">{selectedImage.cluster_id}</span>
                  </div>
                )}
              </div>
              <div style={{display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap"}}>
                {selectedImage.original_url && (
                  <a href={withToken(selectedImage.original_url)} target="_blank" rel="noopener noreferrer" className="btn btn--sm btn--primary">
                    View Full Size
                  </a>
                )}
                {datasetId && (
                  <Link to={`/annotate/${datasetId}`} className="btn btn--sm btn--secondary"
                    title="Open the manual annotation editor">
                    Annotate this dataset
                  </Link>
                )}
                <button className="btn btn--sm btn--danger" onClick={() => handleDelete(selectedImage)}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
