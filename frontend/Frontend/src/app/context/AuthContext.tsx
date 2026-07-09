import { createContext, useContext, type ReactNode } from "react";

// Phase A — single-user pivot.
//
// The backend no longer validates tokens; ``get_current_user`` returns a
// fixed LOCAL_USER (role = superadmin) on every request. The frontend
// therefore stops gating routes behind a login: this context now serves
// a constant synthetic user so ProtectedRoute, role badges, and any
// ``useAuth()`` consumer keep working unchanged.
//
// ``login`` / ``register`` / ``logout`` remain on the API as no-ops so
// the legacy Login / Register pages (and any imports that still call
// them) don't crash. Phase C will delete those pages and this file.

interface User {
  id: string;
  email: string;
  full_name?: string;
  role: string;
  is_active: boolean;
}

interface AuthCtx {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, full_name: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

// Must line up with auth_service.LOCAL_USER_ID on the backend.
const LOCAL_USER: User = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "local@orchestraty.local",
  full_name: "Local User",
  role: "superadmin",
  is_active: true,
};

// A non-null sentinel so ProtectedRoute's ``if (!token)`` check passes.
// The backend ignores it.
const LOCAL_TOKEN = "local-single-user";

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const value: AuthCtx = {
    user: LOCAL_USER,
    token: LOCAL_TOKEN,
    loading: false,
    login: async () => {
      // No-op in single-user mode.
    },
    register: async () => {
      // No-op in single-user mode.
    },
    logout: () => {
      // No-op in single-user mode — there is nothing to log out of.
    },
  };

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
