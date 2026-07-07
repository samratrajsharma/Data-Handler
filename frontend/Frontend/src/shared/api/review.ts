import api from "./client";

export const reviewApi = {
  runQuality: (datasetId: string, expected_labels?: string[]) =>
    api.post(`/review/quality/${datasetId}`, { dataset_id: datasetId, expected_labels }),
  getQuality: (datasetId: string) =>
    api.get(`/review/quality/${datasetId}`),
  submitActions: (data: {
    dataset_id: string;
    actions: { item_id: string; action: string; new_label?: string }[];
  }) => api.post("/review/actions", data),
  getStatus: (datasetId: string) =>
    api.get(`/review/status/${datasetId}`),
  exportDataset: (datasetId: string, format: string) =>
    api.post(`/review/export/${datasetId}`, { dataset_id: datasetId, format }),
  getExport: (datasetId: string) =>
    api.get(`/review/export/${datasetId}`),
  updateDatasetStatus: (datasetId: string, status: string) =>
    api.put(`/review/dataset/${datasetId}/status`, { status }),
};
