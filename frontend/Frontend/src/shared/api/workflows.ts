import api from "./client";

export const workflowApi = {
  create: (data: {
    name: string; description?: string; dataset_id: string;
    steps: Record<string, unknown>[]; template_id?: string;
  }) => api.post("/workflows", data),
  list: (params?: { dataset_id?: string }) =>
    api.get("/workflows", { params }),
  getTemplates: () => api.get("/workflows/templates"),
  createTemplate: (data: {
    name: string; description?: string;
    steps: Record<string, unknown>[]; category?: string;
  }) => api.post("/workflows/templates", data),
  get: (id: string) => api.get(`/workflows/${id}`),
  pause: (id: string) => api.put(`/workflows/${id}/pause`),
  resume: (id: string) => api.put(`/workflows/${id}/resume`),
  delete: (id: string) => api.delete(`/workflows/${id}`),
  quickStart: (datasetId: string, source_type?: string) =>
    api.post(`/workflows/quick-start/${datasetId}`, null, { params: { source_type } }),
};
