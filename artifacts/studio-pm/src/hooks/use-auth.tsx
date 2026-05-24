import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type AuthUser = {
  id: number;
  email: string | null;
  name: string | null;
  picture: string | null;
  isAdmin: boolean;
  isActive: boolean;
  authProvider: "local" | "oidc";
};

export type OidcProvider = "authentik" | "google";

export type AuthConfig = {
  oidcEnabled: boolean;
  oidcProviders: OidcProvider[];
};

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated"; config: AuthConfig }
  | { status: "authenticated"; user: AuthUser; config: AuthConfig };

export class AuthError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

type AuthContextValue = AuthState & {
  refresh: () => Promise<void>;
  // `signInOidc(provider, returnTo)`. Provider defaults to the first configured
  // one for back-compat with older callers (they only had Authentik).
  signInOidc: (provider?: OidcProvider, returnTo?: string) => void;
  signInLocal: (email: string, password: string) => Promise<AuthUser>;
  signUp: (input: { email: string; password: string; name?: string; isAdmin?: boolean }) => Promise<AuthUser>;
  changePassword: (input: { currentPassword: string; newPassword: string }) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function readJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return null; }
}

const EMPTY_CONFIG: AuthConfig = { oidcEnabled: false, oidcProviders: [] };

function normalizeConfig(raw: any): AuthConfig {
  const providersRaw = Array.isArray(raw?.oidcProviders) ? raw.oidcProviders : [];
  const oidcProviders = providersRaw.filter(
    (p: unknown): p is OidcProvider => p === "authentik" || p === "google",
  );
  return {
    oidcEnabled: !!raw?.oidcEnabled || oidcProviders.length > 0,
    oidcProviders,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  async function refresh() {
    try {
      const cfgRes = await fetch("/api/config");
      const cfgRaw = cfgRes.ok ? await cfgRes.json() : null;
      const config = normalizeConfig(cfgRaw);
      const meRes = await fetch("/api/auth/me");
      if (meRes.ok) {
        const user = (await meRes.json()) as AuthUser;
        setState({ status: "authenticated", user, config });
      } else {
        setState({ status: "unauthenticated", config });
      }
    } catch {
      setState({ status: "unauthenticated", config: EMPTY_CONFIG });
    }
  }

  useEffect(() => { void refresh(); }, []);

  function signInOidc(provider?: OidcProvider, returnTo?: string) {
    // Same-origin relative paths only (server re-validates; this is just UX).
    const raw = returnTo || window.location.pathname + window.location.search;
    const target =
      raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") && !raw.includes("\\")
        ? raw
        : "/";
    // Pick a provider: explicit > first configured > "authentik" (legacy default).
    let chosen: OidcProvider = provider ?? "authentik";
    if (!provider && state.status !== "loading") {
      chosen = state.config.oidcProviders[0] ?? "authentik";
    }
    // Authentik uses the legacy path; Google uses the new provider-scoped one.
    const path = chosen === "authentik"
      ? "/api/auth/oidc/login"
      : `/api/auth/${chosen}/login`;
    window.location.href = `${path}?returnTo=${encodeURIComponent(target)}`;
  }

  async function signInLocal(email: string, password: string): Promise<AuthUser> {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await readJson(res);
    if (!res.ok) throw new AuthError(body?.error || "Sign-in failed", body?.code);
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
    if (!res.ok) throw new AuthError(body?.error || "Sign-up failed", body?.code);
    await refresh();
    return body as AuthUser;
  }

  async function changePassword(input: { currentPassword: string; newPassword: string }): Promise<void> {
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await readJson(res);
    if (!res.ok) throw new AuthError(body?.error || "Couldn't change password", body?.code);
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

  const value: AuthContextValue = { ...state, refresh, signInOidc, signInLocal, signUp, changePassword, signOut };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
