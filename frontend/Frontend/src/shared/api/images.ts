import api from "./client";

export const imageApi = {
  upload: (datasetId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/images/${datasetId}/upload`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  uploadBatch: (datasetId: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return api.post(`/images/${datasetId}/upload-batch`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  getGallery: (datasetId: string, params?: { skip?: number; limit?: number; cluster_id?: number }) =>
    api.get(`/images/${datasetId}/gallery`, { params }),
  getAsset: (datasetId: string, assetId: string) =>
    api.get(`/images/${datasetId}/${assetId}`),
  generateEmbeddings: (datasetId: string) =>
    api.post(`/images/${datasetId}/embeddings`),
  cluster: (datasetId: string, min_cluster_size?: number) =>
    api.post(`/images/${datasetId}/cluster`, { min_cluster_size: min_cluster_size || 5 }),
  getClusters: (datasetId: string) =>
    api.get(`/images/${datasetId}/clusters`),
  modelStatus: () => api.get(`/images/model/status`),
  prepareModel: (datasetId: string) =>
    api.post(`/images/model/prepare`, null, { params: { dataset_id: datasetId } }),
  search: (datasetId: string, query_text: string, top_k?: number) =>
    api.post(`/images/${datasetId}/search`, { query_text, top_k: top_k || 10 }),
  deleteAsset: (datasetId: string, assetId: string) =>
    api.delete(`/images/${datasetId}/${assetId}`),
};
