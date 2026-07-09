import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import "../shared/index.css";
import "../shared/stencil-components/index";
import AppRouter from "./AppRouter";

// Phase B — localhost-app entry point.
//
// Launched by index.html. Boots the dashboard directly — no landing-page
// wrapper, no anonymous-vs-logged-in fork. The AuthProvider here is the
// Phase A single-user shim (LOCAL_USER always present), so ProtectedRoute
// and role-aware widgets keep working unchanged.

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
