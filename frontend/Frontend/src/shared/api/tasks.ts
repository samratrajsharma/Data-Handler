import api from "./client";

export const taskApi = {
  list: (params?: {
    dataset_id?: string; task_type?: string; status?: string;
    skip?: number; limit?: number;
  }) => api.get("/tasks", { params }),
  get: (taskId: string) => api.get(`/tasks/${taskId}`),
  getByCeleryId: (celeryId: string) => api.get(`/tasks/celery/${celeryId}`),
};
