import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export default function Login() {
  const auth = useAuth();
  const [, navigate] = useLocation();

  // If we land here already signed in, bounce to the stored returnTo or home.
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
  const needsBootstrap = auth.status !== "loading" && auth.config.needsBootstrap;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.signInLocal(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-8 text-primary font-bold text-xl tracking-tight uppercase justify-center">
          <div className="w-5 h-5 bg-primary rounded-sm" />
          Studio Command
        </div>

        <div className="border border-border bg-card rounded-lg p-8 space-y-6">
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold">Sign in</h1>
            <p className="text-sm text-muted-foreground">
              Studio Command is members-only. Sign in with your account to continue.
            </p>
          </div>

          {needsBootstrap && (
            <div className="flex items-start gap-3 p-3 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm" data-testid="banner-needs-bootstrap">
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="space-y-2">
                <div className="font-medium">No admin account exists yet</div>
                <div className="text-xs text-amber-200/80">
                  For security, the first admin must be created on the server, not from this page.
                  Ask the operator to run:
                </div>
                <pre className="text-[11px] font-mono bg-black/40 text-amber-100 p-2 rounded border border-amber-500/30 whitespace-pre-wrap break-all">{`docker compose exec app \\
  pnpm --filter @workspace/scripts create-admin \\
  --email you@example.com --password '…'`}</pre>
                <div className="text-[11px] text-amber-200/70 font-mono">
                  Then reload this page and sign in.
                </div>
              </div>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4" data-testid="form-signin">
            <div className="grid gap-2">
              <Label htmlFor="auth-email">Email</Label>
              <Input id="auth-email" type="email" required autoComplete="email"
                value={email} onChange={(e) => setEmail(e.target.value)}
                data-testid="input-email" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="auth-password">Password</Label>
              <Input id="auth-password" type="password" required autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)}
                data-testid="input-password" />
            </div>

            {error && (
              <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-md p-2" data-testid="text-auth-error">
                {error}
              </div>
            )}

            <Button type="submit" size="lg" className="w-full gap-2" disabled={loading || busy} data-testid="button-submit-auth">
              <LogIn className="w-4 h-4" />
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          {oidcEnabled && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
                <div className="relative flex justify-center text-[10px] uppercase tracking-wider font-mono">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>
              <Button type="button" variant="outline" size="lg" className="w-full gap-2"
                disabled={loading}
                onClick={() => {
                  const stored = sessionStorage.getItem("studiopm.returnTo");
                  sessionStorage.removeItem("studiopm.returnTo");
                  auth.signInOidc(stored && stored.startsWith("/") ? stored : "/");
                }}
                data-testid="button-signin-oidc"
              >
                <LogIn className="w-4 h-4" />
                Continue with Authentik
              </Button>
              <p className="text-[11px] text-muted-foreground text-center font-mono">
                Authentik sign-in creates a non-admin member account.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
