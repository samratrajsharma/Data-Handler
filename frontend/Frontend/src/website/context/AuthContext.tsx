import { createContext, useContext, type ReactNode } from "react";

// Marketing-website AuthContext — anonymous stub.
//
// The marketing site is a separate Vite entry from the localhost app and has
// no user identity of its own. It is always rendered as "logged out" so the
// hero / features / use-cases / CTA composition shows.
//
// The signal-compatible shape is preserved so the existing marketing
// components (Navbar, WebsiteApp, UserHome) keep importing ``useAuth()``
// unchanged.

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

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const value: AuthCtx = {
    user: null,
    token: null,
    loading: false,
    login: async () => {
      // No-op on the marketing site. Auth CTAs (Sign In / Sign Up) link to
      // pages that no longer exist on this entry — they are visible-but-broken
      // by design (Phase F rewires them).
    },
    register: async () => {
      // No-op — see ``login``.
    },
    logout: () => {
      // No-op — there is no session here.
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
