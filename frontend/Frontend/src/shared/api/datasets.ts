import api from "./client";

export interface DatasetCreatePayload {
  name: string;
  description?: string;
  source_type: "csv" | "json" | "api" | "database" | "image" | "text";
}

export const datasetApi = {
  list: (params?: { skip?: number; limit?: number }) =>
    api.get("/datasets", { params }),
  get: (id: string) => api.get(`/datasets/${id}`),
  create: (data: DatasetCreatePayload) => api.post("/datasets", data),
  upload: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/datasets/${id}/upload`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  getVersions: (id: string) => api.get(`/datasets/${id}/versions`),
  getPermissions: (id: string) => api.get(`/datasets/${id}/permissions`),
  getColumns: (id: string) => api.get<{ columns: string[] }>(`/datasets/${id}/columns`),
  getPreview: (id: string, limit = 10) =>
    api.get<{ columns: string[]; rows: string[][]; row_count?: number; truncated: boolean }>(
      `/datasets/${id}/preview`, { params: { limit } }
    ),
  getColumnValues: (id: string, column: string, limit = 100) =>
    api.get<{
      column: string;
      is_numeric: boolean;
      values: string[];
      truncated: boolean;
      stats?: { min?: number; max?: number; mean?: number };
    }>(`/datasets/${id}/column-values`, { params: { column, limit } }),
  getColumnTypes: (id: string) =>
    api.get<{ columns: Array<{ name: string; is_numeric: boolean }> }>(
      `/datasets/${id}/column-types`
    ),
  delete: (id: string) => api.delete(`/datasets/${id}`),
};

export function inferSourceTypeFromFile(file: File): DatasetCreatePayload["source_type"] {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json") || name.endsWith(".jsonl")) return "json";
  if (name.match(/\.(png|jpe?g|webp|tiff?|bmp)$/)) return "image";
  if (name.endsWith(".txt") || name.endsWith(".md")) return "text";
  return "csv";
}
