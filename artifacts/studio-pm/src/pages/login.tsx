import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight } from "lucide-react";
import { useAuth, AuthError, type OidcProvider } from "@/hooks/use-auth";
import cueMark from "@/assets/cue-mark_1779576125630.svg";

// Friendly messages for the `?error=…` codes the OIDC callback redirects with.
// "pending" intentionally covers BOTH "you weren't invited" and "you were
// invited but not yet approved" — the server collapses those two outcomes
// into the same code so the public page can't be used as a membership oracle.
const OIDC_ERROR_COPY: Record<string, { title: string; body: string }> = {
  pending: {
    title: "Access pending",
    body: "Your sign-in attempt was received. An administrator must approve your account before you can use Cue.",
  },
  email_unverified: {
    title: "Verify your email",
    body: "Your identity provider hasn't verified this email address. Verify it there, then try again.",
  },
  wrong_domain: {
    title: "Wrong account",
    body: "This Cue server only allows sign-ins from a specific Google Workspace domain. Use your work account.",
  },
};

const PROVIDER_LABEL: Record<OidcProvider, string> = {
  authentik: "Sign in with SSO",
  google: "Continue with Google",
};

// Google "G" mark in their official 4-color form. Inline SVG so we don't ship
// a network dependency for the login page.
function GoogleMark({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.61Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.83.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.96 10.71A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58A8.97 8.97 0 0 0 9 0 9 9 0 0 0 .96 4.96l3 2.33A5.4 5.4 0 0 1 9 3.58Z" />
    </svg>
  );
}

export default function Login() {
  const auth = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (auth.status === "authenticated") {
      const stored = sessionStorage.getItem("studiopm.returnTo");
      sessionStorage.removeItem("studiopm.returnTo");
      navigate(stored && stored.startsWith("/") ? stored : "/");
    }
  }, [auth.status, navigate]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Surface OIDC callback errors that come back in the URL (?error=…).
  // We read them once on mount, strip them from the URL, and render an
  // info banner instead of the usual login error block.
  const initialOidcError = useMemo(() => {
    if (typeof window === "undefined") return null;
    const p = new URLSearchParams(window.location.search);
    const code = p.get("error");
    return code && OIDC_ERROR_COPY[code] ? code : null;
  }, []);
  const [oidcErrorCode, setOidcErrorCode] = useState<string | null>(initialOidcError);
  useEffect(() => {
    if (initialOidcError && typeof window !== "undefined") {
      const u = new URL(window.location.href);
      u.searchParams.delete("error");
      window.history.replaceState({}, "", u.pathname + (u.search ? `?${u.searchParams}` : "") + u.hash);
    }
  }, [initialOidcError]);

  const loading = auth.status === "loading";
  const providers: OidcProvider[] = auth.status === "loading" ? [] : auth.config.oidcProviders;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.signInLocal(email, password);
    } catch (err) {
      if (err instanceof AuthError && err.code === "account_inactive") {
        setOidcErrorCode("pending");
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "Invalid email or password.");
      }
      // eslint-disable-next-line no-console
      console.warn("sign-in failed:", err);
    } finally {
      setBusy(false);
    }
  }

  function startOidc(provider: OidcProvider) {
    const stored = sessionStorage.getItem("studiopm.returnTo");
    sessionStorage.removeItem("studiopm.returnTo");
    auth.signInOidc(provider, stored && stored.startsWith("/") ? stored : "/");
  }

  const oidcBanner = oidcErrorCode ? OIDC_ERROR_COPY[oidcErrorCode] : null;

  return (
    <div className="dark min-h-screen w-full text-foreground relative overflow-hidden flex items-center justify-center p-6">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute -top-56 -right-40 h-[760px] w-[800px] rounded-full blur-[110px] opacity-55"
          style={{ background: "radial-gradient(closest-side, #5b3dff, transparent 70%)" }}
        />
        <div
          className="absolute -bottom-64 -left-40 h-[700px] w-[740px] rounded-full blur-[110px] opacity-40"
          style={{ background: "radial-gradient(closest-side, #0fb89e, transparent 70%)" }}
        />
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 h-[500px] w-[600px] rounded-full blur-[130px] opacity-25"
          style={{ background: "radial-gradient(closest-side, #2a5cff, transparent 70%)" }}
        />
        <div className="absolute inset-0 opacity-[0.05]"
          style={{ backgroundImage: "linear-gradient(hsl(0 0% 100%) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100%) 1px, transparent 1px)", backgroundSize: "44px 44px" }} />
      </div>

      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src={cueMark} alt="Cue" className="w-14 h-14 mb-4 drop-shadow-[0_10px_30px_rgba(109,92,255,0.45)]" />
          <div className="font-display text-3xl font-bold tracking-tight text-aurora">Cue</div>
          <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mt-1">
            On cue · v1
          </div>
        </div>

        <div className="glass-card glow-aurora rounded-2xl p-7 space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
            <p className="text-sm text-muted-foreground">
              Sign in to access your studio.
            </p>
          </div>

          {oidcBanner && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3" data-testid="oidc-pending-banner">
              <div className="text-[13px] font-semibold text-amber-300">{oidcBanner.title}</div>
              <div className="text-[12.5px] text-amber-200/80 mt-1 leading-snug">{oidcBanner.body}</div>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4" data-testid="form-signin">
            <div className="space-y-1.5">
              <Label htmlFor="auth-email" className="text-xs font-medium text-muted-foreground">Email</Label>
              <Input id="auth-email" type="email" required autoComplete="email"
                placeholder="you@studio.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
                className="h-10 bg-background/60 border-border/80 focus-visible:ring-1 focus-visible:ring-primary/50"
                data-testid="input-email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="auth-password" className="text-xs font-medium text-muted-foreground">Password</Label>
              <Input id="auth-password" type="password" required autoComplete="current-password"
                placeholder="••••••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)}
                className="h-10 bg-background/60 border-border/80 focus-visible:ring-1 focus-visible:ring-primary/50"
                data-testid="input-password" />
            </div>

            {error && (
              <div className="text-[13px] text-red-400 bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2" data-testid="text-auth-error">
                {error}
              </div>
            )}

            <Button type="submit" size="lg" className="w-full h-10 gap-2 font-medium" disabled={loading || busy} data-testid="button-submit-auth">
              {busy ? "Signing in…" : (
                <>
                  Sign in
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </form>

          {providers.length > 0 && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border/60" /></div>
                <div className="relative flex justify-center">
                  <span className="bg-card px-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-mono">or</span>
                </div>
              </div>
              <div className="space-y-2">
                {providers.map((p) => (
                  <Button
                    key={p}
                    type="button" variant="outline" size="lg"
                    className="w-full h-10 gap-2 font-medium border-border/80"
                    disabled={loading}
                    onClick={() => startOidc(p)}
                    data-testid={`button-signin-${p}`}
                  >
                    {p === "google" && <GoogleMark />}
                    {PROVIDER_LABEL[p]}
                  </Button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="text-center text-[11px] text-muted-foreground/70 mt-6 font-mono space-y-2">
          <div>Members only · Contact your administrator for access</div>
          <div>
            <Link
              href="/privacy"
              className="hover:text-foreground transition-colors underline-offset-4 hover:underline"
              data-testid="link-privacy"
            >
              Privacy policy
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
