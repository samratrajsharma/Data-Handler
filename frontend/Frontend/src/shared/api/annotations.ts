import api from "./client";

// ── Types ────────────────────────────────────────────────────────────────

export interface AnnotationClass {
  id: string;
  dataset_id: string;
  name: string;
  color: string;
  shortcut: string | null;
  order_index: number;
}

export type AnnotationKind = "bbox" | "polygon" | "classification" | "mask";

/** COCO compressed run-length encoding for a segmentation mask.
 *  `size` is [height, width] in ABSOLUTE pixels — unlike the normalized 0..1
 *  geometry on the other annotation kinds, a mask is tied to the exact pixel
 *  grid it was painted on. See app/pages/annotate/maskCodec.ts. */
export interface RleMask {
  size: [number, number];
  counts: string;
}
export type ImageStatus = "unannotated" | "annotated" | "approved" | "rejected";
export type Split = "train" | "valid" | "test";

export interface ImageAnnotationOut {
  id: string;
  class_id: string;
  kind: AnnotationKind;
  // Normalized 0..1 geometry. bbox: x/y is the top-left corner.
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  points: [number, number][] | null;
  /** Present only for kind === "mask". */
  mask?: RleMask | null;
}

export interface ImageAnnotationIn {
  class_id: string;
  kind: AnnotationKind;
  x?: number | null;
  y?: number | null;
  w?: number | null;
  h?: number | null;
  points?: [number, number][] | null;
  mask?: RleMask | null;
}

export interface AnnotateQueueItem {
  asset_id: string;
  file_name: string;
  width: number | null;
  height: number | null;
  thumbnail_url: string | null;
  status: ImageStatus;
  split: Split | null;
  annotation_count: number;
}

export interface AnnotateQueueResponse {
  items: AnnotateQueueItem[];
  total: number;
}

export interface AnnotateSummary {
  total: number;
  annotated: number;
  unannotated: number;
  approved: number;
  rejected: number;
  splits: { train: number; valid: number; test: number; unassigned: number };
  class_counts: { class_id: string; name: string; color: string; count: number }[];
}

export interface ImageAnnotationsResponse {
  asset: {
    id: string;
    file_name: string;
    width: number | null;
    height: number | null;
    original_url: string | null;
    thumbnail_url: string | null;
  };
  annotations: ImageAnnotationOut[];
  status: ImageStatus;
  split: Split | null;
  prev_asset_id: string | null;
  next_asset_id: string | null;
  /** Workflow tags on this image (lower-cased, de-duplicated by the API). */
  tags?: string[];
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface AnalyticsClassRow {
  class_id: string;
  name: string;
  color: string;
  count: number;
  image_count: number;
}

export interface AnalyticsBucket {
  label: string;
  count: number;
}

export interface AnalyticsFinding {
  level: "warn" | "info";
  message: string;
}

export interface AnnotateAnalytics {
  total_images: number;
  labelled_images: number;
  empty_images: number;
  total_annotations: number;
  avg_per_labelled_image: number;
  classes: AnalyticsClassRow[];
  kinds: AnalyticsBucket[];
  per_image: AnalyticsBucket[];
  sizes: AnalyticsBucket[];
  unsized_annotations: number;
  split_status: AnalyticsBucket[];
  findings: AnalyticsFinding[];
}

export type ImageExportFormat =
  | "yolo"
  | "coco"
  | "voc"
  | "classification"
  | "createml"
  | "tfcsv"
  | "segmentation";

/** Formats whose label files address images by a path inside the zip. The
 *  server forces include_images on for these, so the UI must not offer a
 *  checkbox that appears to turn it off. Kept next to the type so adding a
 *  format makes the omission obvious. */
export const IMAGE_CENTRIC_FORMATS: ReadonlySet<ImageExportFormat> = new Set([
  "yolo", "voc", "classification", "createml", "tfcsv", "segmentation",
]);

export interface ExportTaskResponse {
  task_id: string;
  celery_task_id: string;
  message: string;
}

export interface LatestExportResponse {
  status: string;
  format: string | null;
  export_path: string | null;
  download_url: string | null;
  image_count?: number | null;
  annotation_count?: number | null;
  created_at: string | null;
}

// ── API ──────────────────────────────────────────────────────────────────

export const annotationApi = {
  // Classes (shared by image + text datasets)
  listClasses: (datasetId: string) =>
    api.get<{ classes: AnnotationClass[] }>(`/annotations/${datasetId}/classes`),
  createClass: (datasetId: string, data: { name: string; color?: string; shortcut?: string }) =>
    api.post<AnnotationClass>(`/annotations/${datasetId}/classes`, data),
  updateClass: (
    datasetId: string,
    classId: string,
    data: { name?: string; color?: string; shortcut?: string; order_index?: number }
  ) => api.patch<AnnotationClass>(`/annotations/${datasetId}/classes/${classId}`, data),
  deleteClass: (datasetId: string, classId: string) =>
    api.delete(`/annotations/${datasetId}/classes/${classId}`),

  // Image annotation
  getAnalytics: (datasetId: string) =>
    api.get<AnnotateAnalytics>(`/annotations/${datasetId}/images/analytics`),

  getSummary: (datasetId: string) =>
    api.get<AnnotateSummary>(`/annotations/${datasetId}/images/summary`),
  getQueue: (
    datasetId: string,
    params?: { status?: ImageStatus; split?: Split; skip?: number; limit?: number }
  ) => api.get<AnnotateQueueResponse>(`/annotations/${datasetId}/images/queue`, { params }),
  getImageAnnotations: (
    datasetId: string,
    assetId: string,
    params?: { status?: ImageStatus; split?: Split }
  ) =>
    api.get<ImageAnnotationsResponse>(
      `/annotations/${datasetId}/images/${assetId}/annotations`,
      { params }
    ),
  saveImageAnnotations: (
    datasetId: string,
    assetId: string,
    data: { annotations: ImageAnnotationIn[]; status?: ImageStatus }
  ) =>
    api.put<{ annotations: ImageAnnotationOut[]; status: ImageStatus }>(
      `/annotations/${datasetId}/images/${assetId}/annotations`,
      data
    ),
  /** Apply one status to every image in the dataset, optionally restricted to
   *  images currently in `only_status`. Only images that already have a state
   *  row are touched — an image never opened has no annotations, and sweeping
   *  it into "approved" would mark an empty image as reviewed. */
  /** Every tag used in the dataset, with how many images carry it. Drives the
   *  autocomplete — offering existing tags is what stops the vocabulary
   *  fragmenting into "blurry", "blurred" and "blur". */
  listTags: (datasetId: string) =>
    api.get<{ tags: TagCount[] }>(`/annotations/${datasetId}/tags`),

  /** Replace this image's tags. Idempotent: the editor holds the whole list,
   *  so one write avoids the ordering problems separate add/remove calls
   *  would create. */
  setImageTags: (datasetId: string, assetId: string, tags: string[]) =>
    api.put<{ tags: string[] }>(
      `/annotations/${datasetId}/images/${assetId}/tags`,
      { tags }
    ),

  bulkSetState: (
    datasetId: string,
    data: { status: ImageStatus; only_status?: ImageStatus }
  ) =>
    api.post<{ updated: number; status: ImageStatus }>(
      `/annotations/${datasetId}/images/bulk-state`,
      data
    ),

  setImageState: (
    datasetId: string,
    assetId: string,
    data: { status?: ImageStatus; split?: Split | null }
  ) =>
    api.patch<{ status: ImageStatus; split: Split | null }>(
      `/annotations/${datasetId}/images/${assetId}/state`,
      data
    ),

  // Splits
  autoSplit: (
    datasetId: string,
    data: { train: number; valid: number; test: number; only_annotated?: boolean; seed?: number }
  ) =>
    api.post<{ train: number; valid: number; test: number; assigned: number }>(
      `/annotations/${datasetId}/images/split`,
      data
    ),

  // Export
  exportImages: (
    datasetId: string,
    data: { format: ImageExportFormat; include_images?: boolean }
  ) => api.post<ExportTaskResponse>(`/annotations/${datasetId}/images/export`, data),
  getLatestExport: (datasetId: string) =>
    api.get<LatestExportResponse>(`/annotations/${datasetId}/images/export/latest`),
};
