import api from "./client";

export interface RuleCondition {
  column: string;
  operator: string;
  value: string;
}

/**
 * A labeling rule.
 *
 * Two shapes are supported (both round-trip through the backend):
 *   - Compound (preferred): { label, priority, logic, conditions: [...] }
 *   - Legacy flat: { label, priority, column, operator, value }
 *
 * The UI always writes the compound shape now. Legacy flat rules loaded from
 * a saved rule set are normalised to compound on read.
 */
export interface RuleDefinition {
  label: string;
  priority?: number;
  // Compound
  logic?: "and" | "or";
  conditions?: RuleCondition[];
  // Legacy flat (still accepted by the API)
  column?: string;
  operator?: string;
  value?: string;
}

export interface LabelingRequest {
  dataset_id: string;
  version_number?: number;
  rules?: RuleDefinition[];
  conflict_strategy?: string;
}

export interface PreviewRulesRequest {
  dataset_id: string;
  rules: RuleDefinition[];
  conflict_strategy?: string;
  sample_size?: number;
  samples_per_rule?: number;
}

export interface PreviewRulesResponse {
  sample_size: number;
  total_rows: number;
  report: {
    total_rows: number;
    labeled_count: number;
    unlabeled_count: number;
    label_distribution: Record<string, number>;
    rules_applied: number;
    conflict_count: number;
    per_rule_stats: Array<{ rule_index: number; matches: number; label: string }>;
    warnings: string[];
  };
  per_rule_samples: Array<Array<Record<string, string | number | boolean | null>>>;
  columns: string[];
}

export interface RuleSetSummary {
  id: string;
  name: string;
  description: string;
  created_at: string | null;
  rule_count: number;
}

export interface RuleSetDetail {
  id: string;
  name: string;
  description: string;
  rules: RuleDefinition[];
  created_at: string | null;
}

export const labelingApi = {
  run: (data: LabelingRequest) => api.post("/labeling/run", data),
  getResults: (datasetId: string) => api.get(`/labeling/results/${datasetId}`),
  getOperators: () => api.get("/labeling/rules/operators"),
  download: (datasetId: string) =>
    api.get(`/labeling/download/${datasetId}`, { responseType: "blob" }),
  previewRules: (data: PreviewRulesRequest) =>
    api.post<PreviewRulesResponse>("/labeling/preview-rules", data),
  // Saved rule sets
  listRuleSets: () => api.get<{ rule_sets: RuleSetSummary[] }>("/labeling/rule-sets"),
  createRuleSet: (data: { name: string; description?: string; rules: RuleDefinition[] }) =>
    api.post<{ id: string; name: string }>("/labeling/rule-sets", data),
  getRuleSet: (id: string) => api.get<RuleSetDetail>(`/labeling/rule-sets/${id}`),
  updateRuleSet: (id: string, data: { name?: string; description?: string; rules?: RuleDefinition[] }) =>
    api.put<RuleSetDetail>(`/labeling/rule-sets/${id}`, data),
  deleteRuleSet: (id: string) => api.delete(`/labeling/rule-sets/${id}`),
};
