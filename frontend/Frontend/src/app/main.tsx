import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import "../shared/index.css";
import "../shared/stencil-components/index";
import AppRouter from "./AppRouter";

// App entry point. Boots the dashboard directly — no landing page and no
// logged-in/anonymous fork. AuthProvider supplies the constant local user so
// route guards and role-aware widgets keep working.

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
