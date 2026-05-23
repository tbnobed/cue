import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type AuthUser = {
  id: number;
  email: string | null;
  name: string | null;
  picture: string | null;
};

type AuthState =
  | { status: "loading"; authEnabled: boolean }
  | { status: "unauthenticated"; authEnabled: boolean }
  | { status: "authenticated"; user: AuthUser; authEnabled: boolean };

type AuthContextValue = AuthState & {
  refresh: () => Promise<void>;
  signIn: (returnTo?: string) => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", authEnabled: true });

  async function refresh() {
    try {
      const cfgRes = await fetch("/api/config");
      const cfg = cfgRes.ok ? await cfgRes.json() : { authEnabled: false };
      const authEnabled = !!cfg.authEnabled;
      if (!authEnabled) {
        // Auth disabled: treat everyone as a synthetic guest so the app remains usable.
        setState({
          status: "authenticated",
          authEnabled: false,
          user: { id: 0, email: null, name: "Guest", picture: null },
        });
        return;
      }
      const meRes = await fetch("/api/auth/me");
      if (meRes.ok) {
        const user = (await meRes.json()) as AuthUser;
        setState({ status: "authenticated", user, authEnabled: true });
      } else {
        setState({ status: "unauthenticated", authEnabled: true });
      }
    } catch {
      setState({ status: "unauthenticated", authEnabled: true });
    }
  }

  useEffect(() => { void refresh(); }, []);

  function signIn(returnTo?: string) {
    const target = returnTo || window.location.pathname + window.location.search;
    window.location.href = `/api/auth/login?returnTo=${encodeURIComponent(target)}`;
  }

  async function signOut() {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      const body = res.ok ? await res.json().catch(() => ({})) : {};
      if (body?.endSessionUrl) {
        window.location.href = body.endSessionUrl;
        return;
      }
    } catch {
      // ignore
    }
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    window.location.href = `${base}/login`;
  }

  const value: AuthContextValue = { ...state, refresh, signIn, signOut };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
