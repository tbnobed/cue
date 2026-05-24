import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import cueMark from "@assets/cue-mark_1779576125630.svg";

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

  const loading = auth.status === "loading";
  const oidcEnabled = auth.status !== "loading" && auth.config.oidcEnabled;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.signInLocal(email, password);
    } catch (err) {
      setError("Invalid email or password.");
      // eslint-disable-next-line no-console
      console.warn("sign-in failed:", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dark min-h-screen w-full text-foreground relative overflow-hidden flex items-center justify-center p-6">
      {/* Ambient aurora — three big blobs + faint grid, sitting above the
       * body atmosphere for a layered, glowing canvas. */}
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
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <img src={cueMark} alt="Cue" className="w-14 h-14 mb-4 drop-shadow-[0_10px_30px_rgba(109,92,255,0.45)]" />
          <div className="font-display text-3xl font-bold tracking-tight text-aurora">Cue</div>
          <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mt-1">
            On cue · v1
          </div>
        </div>

        {/* Card */}
        <div className="glass-card glow-aurora rounded-2xl p-7 space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
            <p className="text-sm text-muted-foreground">
              Sign in to access your studio.
            </p>
          </div>

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

          {oidcEnabled && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border/60" /></div>
                <div className="relative flex justify-center">
                  <span className="bg-card px-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-mono">or</span>
                </div>
              </div>
              <Button type="button" variant="outline" size="lg" className="w-full h-10 gap-2 font-medium border-border/80"
                disabled={loading}
                onClick={() => {
                  const stored = sessionStorage.getItem("studiopm.returnTo");
                  sessionStorage.removeItem("studiopm.returnTo");
                  auth.signInOidc(stored && stored.startsWith("/") ? stored : "/");
                }}
                data-testid="button-signin-oidc"
              >
                <span>Sign in with SSO</span>
                <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">via Authentik</span>
              </Button>
            </>
          )}
        </div>

        <div className="text-center text-[11px] text-muted-foreground/70 mt-6 font-mono">
          Members only · Contact your administrator for access
        </div>
      </div>
    </div>
  );
}
