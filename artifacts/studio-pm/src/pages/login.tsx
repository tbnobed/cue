import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, ShieldAlert, UserPlus } from "lucide-react";
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

  const [mode, setMode] = useState<"signin" | "bootstrap">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Switch into bootstrap mode the moment we know no admin exists.
  useEffect(() => {
    if (auth.status !== "loading" && auth.config.needsBootstrap) {
      setMode("bootstrap");
    }
  }, [auth.status, "config" in auth ? auth.config.needsBootstrap : null]);

  const loading = auth.status === "loading";
  const oidcEnabled = auth.status !== "loading" && auth.config.oidcEnabled;
  const needsBootstrap = auth.status !== "loading" && auth.config.needsBootstrap;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "bootstrap") {
        await auth.signUp({ email, password, name: name || undefined });
      } else {
        await auth.signInLocal(email, password);
      }
      // refresh() inside signInLocal/signUp will flip auth.status to
      // "authenticated" and the effect above will navigate away.
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
            <h1 className="text-2xl font-semibold">
              {mode === "bootstrap" ? "Create the first admin" : "Sign in"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {mode === "bootstrap"
                ? "No admin account exists yet. The first account you create will be the admin for this Studio Command instance."
                : "Studio Command is members-only. Sign in with your account to continue."}
            </p>
          </div>

          {needsBootstrap && mode !== "bootstrap" && (
            <div className="flex items-start gap-3 p-3 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm">
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="text-xs">
                No admin yet — switch to <button type="button" className="underline" onClick={() => setMode("bootstrap")}>create the first admin</button>.
              </div>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4" data-testid="form-auth">
            {mode === "bootstrap" && (
              <div className="grid gap-2">
                <Label htmlFor="auth-name">Name</Label>
                <Input id="auth-name" autoComplete="name" value={name}
                  onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="auth-email">Email</Label>
              <Input id="auth-email" type="email" required autoComplete="email"
                value={email} onChange={(e) => setEmail(e.target.value)}
                data-testid="input-email" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="auth-password">Password</Label>
              <Input id="auth-password" type="password" required
                autoComplete={mode === "bootstrap" ? "new-password" : "current-password"}
                minLength={mode === "bootstrap" ? 8 : undefined}
                value={password} onChange={(e) => setPassword(e.target.value)}
                data-testid="input-password" />
              {mode === "bootstrap" && (
                <p className="text-[11px] text-muted-foreground font-mono">At least 8 characters.</p>
              )}
            </div>

            {error && (
              <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-md p-2" data-testid="text-auth-error">
                {error}
              </div>
            )}

            <Button type="submit" size="lg" className="w-full gap-2" disabled={loading || busy} data-testid="button-submit-auth">
              {mode === "bootstrap" ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
              {busy ? "Working…" : mode === "bootstrap" ? "Create admin account" : "Sign in"}
            </Button>
          </form>

          {oidcEnabled && mode === "signin" && (
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
              >
                <LogIn className="w-4 h-4" />
                Continue with Authentik
              </Button>
              <p className="text-[11px] text-muted-foreground text-center font-mono">
                Authentik sign-in creates a non-admin member account.
              </p>
            </>
          )}

          {mode === "bootstrap" && !needsBootstrap && (
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground w-full text-center"
              onClick={() => setMode("signin")}>
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
