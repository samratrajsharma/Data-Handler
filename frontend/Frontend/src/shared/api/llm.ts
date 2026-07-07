import api from "./client";

export const llmApi = {
  getProviders: () => api.get("/llm/providers"),
  getModels: (provider: string) => api.get(`/llm/models/${provider}`),
  getConfig: () => api.get("/llm/config"),
  saveConfig: (data: {
    provider: string; model_name: string; api_key?: string;
    base_url?: string; temperature?: number; max_tokens?: number; is_default?: boolean;
  }) => api.post("/llm/config", data),
  deleteConfig: (provider: string) => api.delete(`/llm/config/${provider}`),
  test: (data: {
    provider: string; model_name: string; api_key?: string; base_url?: string;
  }) => api.post("/llm/test", data),
};
