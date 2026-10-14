import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  useGetWrikeConnection, getGetWrikeConnectionQueryKey, useAuthorizeWrike, useDisconnectWrike,
} from "@workspace/api-client-react";
import { Plug, Loader2, Check, AlertTriangle, Unplug, RefreshCw, Shield, Info, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { errMsg, ErrorBox, fmtDate } from "@/components/releases-wrike-panel";

const TONE: Record<string, string> = {
  connected: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/25",
  error: "text-red-300 bg-red-500/10 ring-red-500/25",
  disconnected: "text-amber-300 bg-amber-500/10 ring-amber-500/25",
  not_configured: "text-muted-foreground bg-muted/40 ring-border/60",
};
const LABEL: Record<string, string> = { connected: "Connected", error: "Needs attention", disconnected: "Not connected", not_configured: "Not configured" };

export default function MyIntegrations() {
  const auth = useAuth();
  const isAdmin = auth.status === "authenticated" && auth.user.isAdmin;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const key = getGetWrikeConnectionQueryKey();
  const q = useGetWrikeConnection({ query: { queryKey: key } });
  const authorize = useAuthorizeWrike();
  const disconnect = useDisconnectWrike({ mutation: { onSettled: () => qc.invalidateQueries({ queryKey: key }) } });
  const [confirm, setConfirm] = useState<null | "disconnect" | "reconnect">(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const w = new URLSearchParams(window.location.search).get("wrike");
    if (!w) return;
    if (w === "connected") setBanner({ ok: true, text: "Your Wrike account is connected." });
    else setBanner({ ok: false, text: "Wrike sign-in didn't complete. Try again. If it keeps failing, ask a Cue admin to check the server logs." });
    qc.invalidateQueries({ queryKey: key });
    navigate("/integrations", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    try {
      const { url } = await authorize.mutateAsync();
      window.location.assign(url);
    } catch (err) { toast({ title: "Couldn't start Wrike sign-in", description: errMsg(err), variant: "destructive" }); }
  }
  async function doDisconnect() {
    try {
      await disconnect.mutateAsync();
      toast({ title: "Your Wrike account was disconnected" });
    } catch (err) { toast({ title: "Disconnect failed", description: errMsg(err), variant: "destructive" }); }
    finally { setConfirm(null); }
  }

  const c = q.data;
  const linked = c?.linkedProjectCount ?? 0;
  const state = !c ? null : !c.configured ? "not_configured" : c.connected ? "connected" : c.lastError ? "error" : "disconnected";

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">
      <header className="space-y-1">
        <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Personal</div>
        <h1 className="font-display text-2xl font-bold tracking-tight">My integrations</h1>
        <p className="text-sm text-muted-foreground">Accounts you connect here belong to you. Cue only uses them for projects you link or take over.</p>
        {isAdmin && (
          <Link href="/admin/integrations" className="inline-flex items-center gap-1.5 text-[11px] font-mono text-primary hover:underline pt-1" data-testid="link-admin-health">
            <Shield className="w-3 h-3" /> Team integration health
          </Link>
        )}
      </header>

      {banner && (
        <div className={`rounded-xl border px-4 py-3 text-sm flex items-center gap-2 ${banner.ok ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200" : "border-red-500/30 bg-red-500/[0.06] text-red-200"}`} data-testid="banner-wrike-callback">
          {banner.ok ? <Check className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}{banner.text}
        </div>
      )}

      <section className="surface-card ring-hairline border border-border/70 rounded-2xl overflow-hidden" data-testid="card-my-wrike">
        <div className="px-5 pt-4 pb-3 border-b border-border/50 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Plug className="w-4 h-4 text-primary" />
            <h2 className="text-[14px] font-semibold tracking-tight">Wrike</h2>
            {state && <span data-testid={`status-wrike-${state}`} className={`text-[9.5px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 rounded ring-1 ring-inset ${TONE[state]}`}>{LABEL[state]}</span>}
          </div>
          {c?.configured && (
            <div className="flex gap-2">
              {c.connected && (
                <Button size="sm" variant="ghost" className="h-8 gap-1.5 hover:text-red-400" onClick={() => setConfirm("disconnect")} data-testid="button-disconnect-wrike">
                  <Unplug className="w-3.5 h-3.5" /> Disconnect
                </Button>
              )}
              <Button size="sm" className="h-8 gap-1.5" disabled={authorize.isPending}
                onClick={() => (c.connected && linked > 0 ? setConfirm("reconnect") : void connect())} data-testid="button-connect-wrike">
                {authorize.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : c.connected ? <RefreshCw className="w-3.5 h-3.5" /> : <Plug className="w-3.5 h-3.5" />}
                {c.connected ? "Reconnect" : "Connect my Wrike"}
              </Button>
            </div>
          )}
        </div>

        <div className="p-5 space-y-5">
          {q.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/3" /></div>
          ) : q.isError ? (
            <ErrorBox message={`Couldn't load your Wrike status: ${errMsg(q.error)}`} onRetry={() => q.refetch()} />
          ) : c ? (
            <>
              {!c.configured ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4 text-sm text-amber-200 flex gap-2" data-testid="text-wrike-not-configured">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    Wrike isn't set up on this Cue server yet.{" "}
                    {isAdmin
                      ? <>Finish the server setup in <Link href="/admin/integrations" className="underline">admin integrations</Link>.</>
                      : "Ask a Cue admin to configure it, then come back to connect your account."}
                  </div>
                </div>
              ) : (
                <dl className="grid sm:grid-cols-2 gap-px rounded-xl overflow-hidden ring-1 ring-border/60 bg-border/40 text-[11.5px]">
                  {[
                    ["Status", c.connected ? "Connected" : "Not connected", "status"],
                    ["Wrike host", c.host || "—", "host"],
                    ["Connected at", c.connectedAt ? fmtDate(c.connectedAt, "MMM d, yyyy · h:mm a") : "—", "connected-at"],
                    ["Projects you sync", String(linked), "linked-count"],
                  ].map(([k, v, id]) => (
                    <div key={id} className="bg-card/80 p-3">
                      <dt className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">{k}</dt>
                      <dd className="mt-1 font-mono break-all" data-testid={`text-wrike-${id}`}>{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {c.lastError && <ErrorBox message={c.lastError} />}

              <ul className="text-[12px] leading-relaxed text-muted-foreground space-y-1.5 list-disc pl-4" data-testid="text-wrike-personal-explainer">
                <li className="flex-none"><UserRound className="w-3 h-3 inline mr-1 -mt-0.5" />Your connection sees only the Wrike projects and folders your Wrike account can access.</li>
                <li>Projects you link from Cue import through your connection until someone else takes over the sync.</li>
                <li>Disconnecting pauses only the projects you sync ({linked}). Other people's connections are untouched.</li>
                <li>Reconnecting turns off auto-sync on your projects until you review and switch it back on.</li>
              </ul>
            </>
          ) : null}
        </div>
      </section>

      <AlertDialog open={confirm !== null} onOpenChange={o => !disconnect.isPending && !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "reconnect" ? "Reconnect your Wrike?" : "Disconnect your Wrike?"}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {confirm === "reconnect" ? (
                  <>
                    <p>Auto-sync turns off on the {linked} project{linked === 1 ? "" : "s"} you sync, pending your review.</p>
                    <p>After signing in, open each project and switch auto-sync back on once the link looks right.</p>
                  </>
                ) : (
                  <>
                    <p>Cue deletes your stored Wrike tokens. Imports pause for the {linked} project{linked === 1 ? "" : "s"} that sync through your account; nobody else's are affected.</p>
                    <p>Imported tasks and project links are kept. A project owner or admin can take over a paused sync with their own Wrike.</p>
                    <p>To fully revoke access, also remove the Cue app from your Wrike app settings.</p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnect.isPending || authorize.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={e => { e.preventDefault(); if (confirm === "reconnect") void connect(); else void doDisconnect(); }}
              disabled={disconnect.isPending || authorize.isPending} data-testid="button-confirm-wrike-action">
              {(disconnect.isPending || authorize.isPending) && <Loader2 className="w-3 h-3 animate-spin mr-1.5" />}
              {confirm === "reconnect" ? "Continue to Wrike" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
