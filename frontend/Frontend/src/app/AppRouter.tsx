import { Routes, Route, Navigate } from "react-router-dom";
import DashboardLayout from "./layouts/DashboardLayout";
import Dashboard from "./pages/dashboard/Dashboard";
import Datasets from "./pages/datasets/Datasets";
import DatasetDetail from "./pages/datasets/DatasetDetail";
import Structuring from "./pages/structuring/Structuring";
import EDA from "./pages/eda/EDA";
import Labeling from "./pages/labeling/Labeling";
import AILabeling from "./pages/ai-labeling/AILabeling";
import ImagePipeline from "./pages/images/ImagePipeline";
import ReviewPage from "./pages/review/ReviewPage";
import Workflows from "./pages/workflows/Workflows";
import WorkflowDetail from "./pages/workflows/WorkflowDetail";
import LLMConfig from "./pages/llm/LLMConfig";
import Tasks from "./pages/tasks/Tasks";

// Phase C — single-user pivot complete.
//
// The localhost app is the dashboard, and nothing else. Admin (user
// management), Audit Logs, and the SuperAdmin entry are deleted. The
// legacy /app/* redirects from Phase B are gone too — nothing internal
// links to them anymore. Anything unknown lands on the dashboard home.

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<DashboardLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="datasets" element={<Datasets />} />
        <Route path="datasets/:id" element={<DatasetDetail />} />
        <Route path="structuring" element={<Structuring />} />
        <Route path="eda" element={<EDA />} />
        <Route path="labeling" element={<Labeling />} />
        <Route path="ai-labeling" element={<AILabeling />} />
        <Route path="images" element={<ImagePipeline />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="workflows" element={<Workflows />} />
        <Route path="workflows/:id" element={<WorkflowDetail />} />
        <Route path="llm" element={<LLMConfig />} />
        <Route path="tasks" element={<Tasks />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
