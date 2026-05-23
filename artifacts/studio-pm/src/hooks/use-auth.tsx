import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type AuthUser = {
  id: number;
  email: string | null;
  name: string | null;
  picture: string | null;
  isAdmin: boolean;
};

export type AuthConfig = {
  oidcEnabled: boolean;
};

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated"; config: AuthConfig }
  | { status: "authenticated"; user: AuthUser; config: AuthConfig };

type AuthContextValue = AuthState & {
  refresh: () => Promise<void>;
  signInOidc: (returnTo?: string) => void;
  signInLocal: (email: string, password: string) => Promise<AuthUser>;
  signUp: (input: { email: string; password: string; name?: string; isAdmin?: boolean }) => Promise<AuthUser>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function readJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return null; }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  async function refresh() {
    try {
      const cfgRes = await fetch("/api/config");
      const cfgRaw = cfgRes.ok ? await cfgRes.json() : { oidcEnabled: false };
      const config: AuthConfig = {
        oidcEnabled: !!cfgRaw.oidcEnabled,
      };
      const meRes = await fetch("/api/auth/me");
      if (meRes.ok) {
        const user = (await meRes.json()) as AuthUser;
        setState({ status: "authenticated", user, config });
      } else {
        setState({ status: "unauthenticated", config });
      }
    } catch {
      setState({ status: "unauthenticated", config: { oidcEnabled: false } });
    }
  }

  useEffect(() => { void refresh(); }, []);

  function signInOidc(returnTo?: string) {
    const target = returnTo || window.location.pathname + window.location.search;
    window.location.href = `/api/auth/oidc/login?returnTo=${encodeURIComponent(target)}`;
  }

  async function signInLocal(email: string, password: string): Promise<AuthUser> {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await readJson(res);
    if (!res.ok) throw new Error(body?.error || "Sign-in failed");
    await refresh();
    return body as AuthUser;
  }

  async function signUp(input: { email: string; password: string; name?: string; isAdmin?: boolean }): Promise<AuthUser> {
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await readJson(res);
    if (!res.ok) throw new Error(body?.error || "Sign-up failed");
    await refresh();
    return body as AuthUser;
  }

  async function signOut() {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      const body = res.ok ? await readJson(res) : null;
      if (body?.endSessionUrl) {
        window.location.href = body.endSessionUrl;
        return;
      }
    } catch {
      // ignore — still redirect to /login below
    }
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    window.location.href = `${base}/login`;
  }

  const value: AuthContextValue = { ...state, refresh, signInOidc, signInLocal, signUp, signOut };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
