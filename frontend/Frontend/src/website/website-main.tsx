import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import "../shared/index.css";
import "../shared/stencil-components/index";
import WebsiteApp from "./WebsiteApp";
import PricingPage from "./pages/pricing/PricingPage";
import Tour from "./pages/tour/Tour";
import PlatformPage from "./pages/platform/Platform";
import ComingSoon from "./pages/coming-soon/ComingSoon";
import Docs from "./pages/docs/Docs";

// Marketing-website entry point.

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<WebsiteApp />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/tour" element={<Tour />} />
          <Route path="/platform" element={<PlatformPage />} />
          <Route path="/coming-soon" element={<ComingSoon />} />
          <Route path="/docs/*" element={<Docs />} />
          <Route path="*" element={<WebsiteApp />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
