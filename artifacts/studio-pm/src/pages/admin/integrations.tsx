import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  useGetWrikeConnection, getGetWrikeConnectionQueryKey, useAuthorizeWrike, useDisconnectWrike,
} from "@workspace/api-client-react";
import { Plug, Loader2, Lock, Check, AlertTriangle, Copy, Unplug, RefreshCw, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { errMsg, ErrorBox, fmtDate } from "@/components/releases-wrike-panel";

const DOC_PUBLIC_URL = "https://cue.obtv.io";
const DOC_CALLBACK = "https://cue.obtv.io/api/integrations/wrike/callback";

function CopyLine({ label, value, testId }: { label: string; value: string; testId: string }) {
  const { toast } = useToast();
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/30 ring-1 ring-inset ring-border/60 px-3 py-2">
      <span className="w-24 shrink-0 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      <code className="flex-1 min-w-0 text-[12px] font-mono break-all select-all" data-testid={testId}>{value}</code>
      <button type="button" className="p-1 rounded text-muted-foreground hover:text-primary" aria-label={`Copy ${label}`}
        onClick={() => { void navigator.clipboard?.writeText(value); toast({ title: "Copied" }); }} data-testid={`button-copy-${testId}`}>
        <Copy className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function IntegrationsAdmin() {
  const auth = useAuth();
  const isAdmin = auth.status === "authenticated" && auth.user.isAdmin;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const key = getGetWrikeConnectionQueryKey();
  const q = useGetWrikeConnection({ query: { queryKey: key, enabled: isAdmin } });
  const authorize = useAuthorizeWrike();
  const disconnect = useDisconnectWrike({ mutation: { onSettled: () => qc.invalidateQueries({ queryKey: key }) } });
  const [confirm, setConfirm] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const w = p.get("wrike");
    if (!w) return;
    if (w === "connected") setBanner({ ok: true, text: "Wrike connected." });
    else setBanner({ ok: false, text: "Wrike connection didn't complete. Try again, or check the server logs." });
    qc.invalidateQueries({ queryKey: key });
    navigate("/admin/integrations", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-xl mx-auto text-center space-y-2" data-testid="text-admin-only">
        <Lock className="w-6 h-6 mx-auto text-muted-foreground" />
        <div className="font-semibold">Admins only</div>
        <p className="text-sm text-muted-foreground">Integrations are managed by Cue administrators.</p>
      </div>
    );
  }

  async function connect() {
    try {
      const { url } = await authorize.mutateAsync();
      window.location.assign(url);
    } catch (err) { toast({ title: "Couldn't start Wrike sign-in", description: errMsg(err), variant: "destructive" }); }
  }
  async function doDisconnect() {
    try {
      await disconnect.mutateAsync();
      toast({ title: "Wrike disconnected" });
    } catch (err) { toast({ title: "Disconnect failed", description: errMsg(err), variant: "destructive" }); }
    finally { setConfirm(false); }
  }

  const c = q.data;
  const state = !c ? null : !c.configured ? "not_configured" : c.connected ? "connected" : c.lastError ? "error" : "disconnected";
  const tone: Record<string, string> = {
    connected: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/25",
    error: "text-red-300 bg-red-500/10 ring-red-500/25",
    disconnected: "text-amber-300 bg-amber-500/10 ring-amber-500/25",
    not_configured: "text-muted-foreground bg-muted/40 ring-border/60",
  };
  const label: Record<string, string> = { connected: "Connected", error: "Error", disconnected: "Not connected", not_configured: "Not configured" };

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">
      <header className="space-y-1">
        <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Admin</div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground">Server-side connections Cue uses on behalf of the whole team.</p>
      </header>

      {banner && (
        <div className={`rounded-xl border px-4 py-3 text-sm flex items-center gap-2 ${banner.ok ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200" : "border-red-500/30 bg-red-500/[0.06] text-red-200"}`} data-testid="banner-wrike-callback">
          {banner.ok ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}{banner.text}
        </div>
      )}

      <section className="surface-card ring-hairline border border-border/70 rounded-2xl overflow-hidden" data-testid="card-wrike-integration">
        <div className="px-5 pt-4 pb-3 border-b border-border/50 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Plug className="w-4 h-4 text-primary" />
            <h2 className="text-[14px] font-semibold tracking-tight">Wrike</h2>
            {state && <span data-testid={`status-wrike-${state}`} className={`text-[9.5px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 rounded ring-1 ring-inset ${tone[state]}`}>{label[state]}</span>}
          </div>
          {c && (
            <div className="flex gap-2">
              {c.connected && (
                <Button size="sm" variant="ghost" className="h-8 gap-1.5 hover:text-red-400" onClick={() => setConfirm(true)} data-testid="button-disconnect-wrike">
                  <Unplug className="w-3.5 h-3.5" /> Disconnect
                </Button>
              )}
              <Button size="sm" className="h-8 gap-1.5" onClick={connect} disabled={!c.configured || authorize.isPending} title={!c.configured ? "Configure the missing settings on your Docker host first." : undefined} data-testid="button-connect-wrike">
                {authorize.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : c.connected ? <RefreshCw className="w-3.5 h-3.5" /> : <Plug className="w-3.5 h-3.5" />}
                {c.connected ? "Reconnect" : "Connect Wrike"}
              </Button>
            </div>
          )}
        </div>

        <div className="p-5 space-y-5">
          {q.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/3" /></div>
          ) : q.isError ? (
            <ErrorBox message={`Couldn't load Wrike status: ${errMsg(q.error)}`} onRetry={() => q.refetch()} />
          ) : c ? (
            <>
              <dl className="grid sm:grid-cols-2 gap-px rounded-xl overflow-hidden ring-1 ring-border/60 bg-border/40 text-[11.5px]">
                {[
                  ["Configured", c.configured ? "Yes" : "No"],
                  ["Connected", c.connected ? "Yes" : "No"],
                  ["Wrike host", c.host || "—"],
                  ["Connected at", c.connectedAt ? fmtDate(c.connectedAt, "MMM d, yyyy · h:mm a") : "—"],
                ].map(([k, v]) => (
                  <div key={k} className="bg-card/80 p-3">
                    <dt className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">{k}</dt>
                    <dd className="mt-1 font-mono break-all" data-testid={`text-wrike-${k.toLowerCase().replace(/\s/g, "-")}`}>{v}</dd>
                  </div>
                ))}
              </dl>
              {c.redirectUri && <CopyLine label="Callback" value={c.redirectUri} testId="text-wrike-redirect-uri" />}
              {c.lastError && <ErrorBox message={c.lastError} />}
              {c.missingSettings.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4 space-y-2" data-testid="list-wrike-missing">
                  <div className="text-sm font-medium text-amber-200">Missing server settings</div>
                  <div className="flex flex-wrap gap-1.5">
                    {c.missingSettings.map(m => <code key={m} className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-500/10 ring-1 ring-amber-500/25 text-amber-200">{m}</code>)}
                  </div>
                </div>
              )}
            </>
          ) : null}

          <div className="space-y-3 pt-2 border-t border-border/40">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground pt-3">
              <Server className="w-3 h-3" /> Self-hosted setup
            </div>
            <p className="text-[12.5px] text-muted-foreground leading-relaxed">
              Secrets live on the Cue Docker server, never in the browser. Create an OAuth app in Wrike (Apps & Integrations, API), set its redirect URI to the callback below, then add these to the server environment and restart the container.
            </p>
            <CopyLine label="PUBLIC_URL" value={DOC_PUBLIC_URL} testId="text-doc-public-url" />
            <CopyLine label="Redirect URI" value={c?.redirectUri || DOC_CALLBACK} testId="text-doc-callback" />
            <ul className="text-[12px] font-mono space-y-1 text-foreground/85">
              <li><code>WRIKE_CLIENT_ID</code> <span className="text-muted-foreground">· from the Wrike app</span></li>
              <li><code>WRIKE_CLIENT_SECRET</code> <span className="text-muted-foreground">· from the Wrike app</span></li>
              <li><code>WRIKE_TOKEN_KEY</code> <span className="text-muted-foreground">· 64 hex characters, encrypts stored tokens (openssl rand -hex 32)</span></li>
            </ul>
          </div>
        </div>
      </section>

      <AlertDialog open={confirm} onOpenChange={o => !disconnect.isPending && setConfirm(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Wrike?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>Cue deletes its stored Wrike tokens and automatic imports stop for every project.</p>
                <p>Imported Cue tasks, project links and files are kept.</p>
                <p>To fully revoke access, also remove the Cue app from your Wrike account's app settings.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnect.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={e => { e.preventDefault(); void doDisconnect(); }} disabled={disconnect.isPending} data-testid="button-confirm-disconnect">
              {disconnect.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1.5" />}Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
