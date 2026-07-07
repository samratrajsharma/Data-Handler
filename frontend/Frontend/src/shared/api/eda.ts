import api from "./client";

export interface EDARequest {
  dataset_id: string;
  version_number?: number;
  run_profiling?: boolean;
  run_embeddings?: boolean;
  run_clustering?: boolean;
  n_clusters?: number;
}

export const edaApi = {
  run: (data: EDARequest) => api.post("/eda/run", data),
  getResults: (datasetId: string) => api.get(`/eda/results/${datasetId}`),
  getProfile: (datasetId: string) => api.get(`/eda/profile/${datasetId}`),
  download: (datasetId: string, format: "json" | "pdf" | "docx" = "json") =>
    api.get(`/eda/download/${datasetId}`, { params: { format }, responseType: "blob" }),
  getColumnsData: (datasetId: string, cols: string[], limit = 1000) =>
    api.get<{ data: Record<string, (number | string | boolean | null)[]>; count: number; total: number }>(
      `/eda/columns-data/${datasetId}`, { params: { cols: cols.join(","), limit } }
    ),
};
