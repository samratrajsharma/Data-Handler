import api from "./client";

export interface AIExample { text: string; label: string }

export const aiLabelingApi = {
  predict: (data: {
    dataset_id: string; labels: string[]; text_column?: string;
    provider?: string; model_name?: string;
    examples?: AIExample[]; instructions?: string;
  }) => api.post("/labeling/ai/predict", data),

  preview: (data: {
    dataset_id: string; labels: string[]; text_column?: string;
    provider?: string; model_name?: string;
    examples?: AIExample[]; instructions?: string; sample_size?: number;
  }) => api.post("/labeling/ai/preview", data),

  predictImages: (data: {
    dataset_id: string; labels: string[];
    provider?: string; model_name?: string;
  }) => api.post("/labeling/ai/predict-images", data),

  getPredictions: (datasetId: string) =>
    api.get(`/labeling/ai/predictions/${datasetId}`),

  generateSynthetic: (data: {
    label: string; count?: number; provider?: string; model_name?: string;
  }) => api.post("/labeling/ai/synthetic", data),

  propagate: (data: {
    dataset_id: string; labels: string[];
    confidence_threshold?: number; top_k?: number;
  }) => api.post("/labeling/ai/propagate", data),

  getPropagation: (datasetId: string) =>
    api.get(`/labeling/ai/propagation/${datasetId}`),

  aggregate: (data: {
    dataset_id: string; strategy?: string;
    include_rule_labels?: boolean; include_ai_labels?: boolean;
    include_propagated_labels?: boolean;
  }) => api.post("/labeling/ai/aggregate", data),

  getAggregation: (datasetId: string) =>
    api.get(`/labeling/ai/aggregation/${datasetId}`),

  activeLearning: (data: { dataset_id: string; top_n?: number }) =>
    api.post("/labeling/ai/active-learning", data),
};
