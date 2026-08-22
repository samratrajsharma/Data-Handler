import api from "./client";

// ── Types ────────────────────────────────────────────────────────────────

export type TextSplitStrategy = "auto" | "file" | "blank_line" | "line";
export type TextAnnotationKind = "doc" | "span";
export type TextExportFormat = "jsonl" | "csv" | "spans-jsonl";

export interface TextUploadResponse {
  documents_created: number;
  total_documents: number;
  strategy_used: TextSplitStrategy;
  warnings: string[];
}

export interface TextDocListItem {
  id: string;
  doc_index: number;
  name: string;
  char_count: number;
  status: "unlabeled" | "labeled";
  preview: string;
  doc_labels: { class_id: string; name: string; color: string }[];
  span_count: number;
}

export interface TextDocListResponse {
  items: TextDocListItem[];
  total: number;
}

export interface TextAnnotationOut {
  id: string;
  class_id: string;
  kind: TextAnnotationKind;
  start_offset: number | null;
  end_offset: number | null;
  snippet: string | null;
}

export interface TextAnnotationIn {
  class_id: string;
  kind: TextAnnotationKind;
  start_offset?: number | null;
  end_offset?: number | null;
}

export interface TextDocDetailResponse {
  id: string;
  doc_index: number;
  name: string;
  content: string;
  status: "unlabeled" | "labeled";
  annotations: TextAnnotationOut[];
  prev_doc_id: string | null;
  next_doc_id: string | null;
}

export interface TextSummary {
  total_documents: number;
  labeled: number;
  unlabeled: number;
  total_spans: number;
  class_counts: { class_id: string; name: string; color: string; count: number }[];
}

// ── API ──────────────────────────────────────────────────────────────────

export const textApi = {
  upload: (datasetId: string, files: File[], strategy: TextSplitStrategy = "auto") => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    form.append("split_strategy", strategy);
    return api.post<TextUploadResponse>(`/text/${datasetId}/upload`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  getSummary: (datasetId: string) =>
    api.get<TextSummary>(`/text/${datasetId}/summary`),

  listDocuments: (
    datasetId: string,
    params?: { skip?: number; limit?: number; q?: string; status?: "unlabeled" | "labeled" }
  ) => api.get<TextDocListResponse>(`/text/${datasetId}/documents`, { params }),

  getDocument: (
    datasetId: string,
    docId: string,
    params?: { q?: string; status?: "unlabeled" | "labeled" }
  ) => api.get<TextDocDetailResponse>(`/text/${datasetId}/documents/${docId}`, { params }),

  saveAnnotations: (datasetId: string, docId: string, annotations: TextAnnotationIn[]) =>
    api.put<{ annotations: TextAnnotationOut[]; status: "unlabeled" | "labeled" }>(
      `/text/${datasetId}/documents/${docId}/annotations`,
      { annotations }
    ),

  deleteDocument: (datasetId: string, docId: string) =>
    api.delete(`/text/${datasetId}/documents/${docId}`),

  // Synchronous download — returns the file blob.
  exportText: (datasetId: string, format: TextExportFormat) =>
    api.post(`/text/${datasetId}/export`, { format }, { responseType: "blob" }),
};
