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

export type AnnotationKind = "bbox" | "polygon" | "classification";
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
}

export interface ImageAnnotationIn {
  class_id: string;
  kind: AnnotationKind;
  x?: number | null;
  y?: number | null;
  w?: number | null;
  h?: number | null;
  points?: [number, number][] | null;
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
}

export type ImageExportFormat = "yolo" | "coco" | "voc" | "classification";

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
