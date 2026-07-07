import api from "./client";

export interface EncodeSpec { column: string; mode: "onehot" | "label" }

export interface StructuringRequest {
  dataset_id: string;
  version_number?: number;
  null_strategy?: string;
  remove_duplicates?: boolean;
  handle_outliers?: boolean;
  drop_cols?: string[];
  case_normalize?: "none" | "lower" | "upper" | "title";
  standardize_columns?: boolean;
  encode_columns?: EncodeSpec[];
}

export interface ColumnAction {
  kind: "drop" | "fill_nulls" | "encode" | "handle_outliers"
      | "trim_whitespace" | "parse_date" | "coerce_numeric" | "noop";
  label: string;
  reason: string;
  mode?: string;
  priority?: number;
}

export interface PerColumnRecommendation {
  column: string;
  dtype: "numeric" | "boolean" | "text";
  distinct: number;
  null_count: number;
  null_pct: number;
  actions: ColumnAction[];
}

export interface StructuringRecommendations {
  total_rows: number;
  total_columns: number;
  drop_columns: Array<{ column: string; reason: string }>;
  encode_columns: Array<{ column: string; mode: "onehot" | "label"; reason: string; cardinality: number }>;
  standardize_columns: boolean;
  case_normalize: { mode: "lower" | "upper" | "title"; reason: string } | null;
  null_strategy: "fill_mode" | "fill_mean" | "fill_median" | "fill_empty" | "drop_rows" | null;
  per_column: PerColumnRecommendation[];
}

export const structuringApi = {
  run: (data: StructuringRequest) => api.post("/structuring/run", data),
  getResults: (datasetId: string) => api.get(`/structuring/results/${datasetId}`),
  download: (datasetId: string) =>
    api.get(`/structuring/download/${datasetId}`, { responseType: "blob" }),
  getRecommendations: (datasetId: string) =>
    api.get<StructuringRecommendations>(`/structuring/recommendations/${datasetId}`),
  getCleanedPreview: (datasetId: string, limit = 5) =>
    api.get<{ columns: string[]; rows: string[][] }>(
      `/structuring/cleaned-preview/${datasetId}`, { params: { limit } }
    ),
};
