import { useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { LogIn, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export default function Login() {
  const auth = useAuth();
  const [, navigate] = useLocation();

  // If we land here already signed in, bounce home
  useEffect(() => {
    if (auth.status === "authenticated") navigate("/");
  }, [auth.status, navigate]);

  const authDisabled = auth.status !== "loading" && auth.authEnabled === false;

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
              Studio Command is members-only. Sign in with your studio account to continue.
            </p>
          </div>

          {authDisabled ? (
            <div className="flex items-start gap-3 p-3 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm">
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium mb-1">Authentication isn&rsquo;t configured</div>
                <div className="text-xs text-amber-200/80">
                  Set <code className="font-mono">AUTHENTIK_ISSUER</code>,{" "}
                  <code className="font-mono">AUTHENTIK_CLIENT_ID</code>,{" "}
                  <code className="font-mono">AUTHENTIK_CLIENT_SECRET</code>, and{" "}
                  <code className="font-mono">PUBLIC_URL</code> on the server, then restart the app.
                </div>
              </div>
            </div>
          ) : (
            <Button
              size="lg"
              className="w-full gap-2"
              disabled={auth.status === "loading"}
              onClick={() => {
                const base = import.meta.env.BASE_URL.replace(/\/$/, "");
                const stored = sessionStorage.getItem("studiopm.returnTo");
                sessionStorage.removeItem("studiopm.returnTo");
                const target = stored && stored.startsWith("/") ? `${base}${stored}` : `${base}/`;
                auth.signIn(target);
              }}
            >
              <LogIn className="w-4 h-4" />
              Continue with Authentik
            </Button>
          )}

          <p className="text-[11px] text-muted-foreground text-center font-mono">
            You&rsquo;ll be redirected to your identity provider.
          </p>
        </div>
      </div>
    </div>
  );
}
