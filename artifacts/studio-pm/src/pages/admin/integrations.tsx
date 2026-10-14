import { Link } from "wouter";
import {
  useGetWrikeConnection, getGetWrikeConnectionQueryKey, useGetWrikeHealth, getGetWrikeHealthQueryKey,
} from "@workspace/api-client-react";
import { Plug, Lock, Copy, Server, Activity, UserRound, AlertTriangle, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { errMsg, ErrorBox, fmtDate } from "@/components/releases-wrike-panel";
import { DocuSealAdminSection } from "@/components/release-signing";

const DOC_PUBLIC_URL = "https://cue.obtv.io";
const DOC_CALLBACK = "https://cue.obtv.io/api/integrations/wrike/callback";
const DT = "MMM d, yyyy · h:mm a";

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

function Stat({ label, value, testId, tone }: { label: string; value: number; testId: string; tone?: string }) {
  return (
    <div className="bg-card/80 p-3">
      <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-xl font-bold tabular-nums ${tone ?? ""}`} data-testid={testId}>{value}</div>
    </div>
  );
}

export default function IntegrationsAdmin() {
  const auth = useAuth();
  const isAdmin = auth.status === "authenticated" && auth.user.isAdmin;
  const conn = useGetWrikeConnection({ query: { queryKey: getGetWrikeConnectionQueryKey(), enabled: isAdmin } });
  const health = useGetWrikeHealth({ query: { queryKey: getGetWrikeHealthQueryKey(), enabled: isAdmin, refetchInterval: 30_000 } });

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-xl mx-auto text-center space-y-2" data-testid="text-admin-only">
        <Lock className="w-6 h-6 mx-auto text-muted-foreground" />
        <div className="font-semibold">Admins only</div>
        <p className="text-sm text-muted-foreground">Team integration health is visible to Cue administrators.</p>
        <Link href="/integrations" className="text-sm text-primary hover:underline" data-testid="link-my-integrations">Manage your own Wrike connection</Link>
      </div>
    );
  }

  const c = conn.data;
  const h = health.data;
  const connections = h?.connections ?? [];
  const failures = h?.failures ?? [];

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <header className="space-y-1">
        <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Admin</div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Integration health</h1>
        <p className="text-sm text-muted-foreground">Each person connects their own Wrike account. This page shows server setup, who is connected and which imports are failing. Tokens are never shown.</p>
        <Link href="/integrations" className="inline-flex items-center gap-1.5 text-[11px] font-mono text-primary hover:underline pt-1" data-testid="link-my-integrations">
          <UserRound className="w-3 h-3" /> My Wrike connection <ArrowRight className="w-3 h-3" />
        </Link>
      </header>

      <section className="surface-card ring-hairline border border-border/70 rounded-2xl overflow-hidden" data-testid="card-wrike-health">
        <div className="px-5 pt-4 pb-3 border-b border-border/50 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2"><Activity className="w-4 h-4 text-primary" /><h2 className="text-[14px] font-semibold tracking-tight">Wrike imports</h2></div>
          <span className="text-[10px] font-mono text-muted-foreground">Refreshes every 30s</span>
        </div>
        <div className="p-5 space-y-5">
          {health.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-24 w-full" /></div>
          ) : health.isError ? (
            <ErrorBox message={`Couldn't load integration health: ${errMsg(health.error)}`} onRetry={() => health.refetch()} />
          ) : h ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl overflow-hidden ring-1 ring-border/60 bg-border/40">
                <Stat label="Queued" value={h.queued} testId="text-health-queued" />
                <Stat label="Running" value={h.running} testId="text-health-running" tone="text-sky-300" />
                <Stat label="Connections" value={connections.length} testId="text-health-connections" />
                <Stat label="Recent failures" value={failures.length} testId="text-health-failures" tone={failures.length ? "text-red-300" : ""} />
              </div>

              <div className="space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Personal connections</div>
                {connections.length === 0 ? (
                  <div className="text-[12px] font-mono text-muted-foreground py-3" data-testid="empty-health-connections">Nobody has connected Wrike yet.</div>
                ) : (
                  <ul className="divide-y divide-border/40 rounded-lg ring-1 ring-border/50 overflow-hidden">
                    {connections.map(x => (
                      <li key={x.userId} className="px-3 py-2.5 text-[12px] flex items-center gap-3 flex-wrap" data-testid={`row-health-connection-${x.userId}`}>
                        <span className="font-medium">{x.userName}</span>
                        <span className={`text-[9.5px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 rounded ring-1 ring-inset ${x.active ? "text-emerald-300 bg-emerald-500/10 ring-emerald-500/25" : "text-amber-300 bg-amber-500/10 ring-amber-500/25"}`}>
                          {x.active ? "Active" : "Paused / deactivated"}
                        </span>
                        <span className="font-mono text-[10.5px] text-muted-foreground">since {fmtDate(x.connectedAt, DT)}</span>
                        <span className="ml-auto font-mono text-[10.5px] tabular-nums">{x.linkedProjects} project{x.linkedProjects === 1 ? "" : "s"}</span>
                        {x.lastError && <div className="w-full text-[11px] text-red-300/90 break-words">{x.lastError}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Failed imports</div>
                {failures.length === 0 ? (
                  <div className="text-[12px] font-mono text-muted-foreground py-3" data-testid="empty-health-failures">No recent failures.</div>
                ) : (
                  <ul className="divide-y divide-border/40 rounded-lg ring-1 ring-border/50 overflow-hidden">
                    {failures.map(f => (
                      <li key={f.id} className="px-3 py-2.5 text-[12px] flex items-center gap-3 flex-wrap" data-testid={`row-health-failure-${f.id}`}>
                        <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                        <Link href={`/projects/${f.projectId}`} className="font-medium hover:text-primary">{f.projectName}</Link>
                        <span className="font-mono text-[10.5px] text-muted-foreground">{fmtDate(f.finishedAt ?? f.startedAt, DT)}</span>
                        <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">{f.attempts ?? 1} attempt{(f.attempts ?? 1) === 1 ? "" : "s"}</span>
                        {f.error && <div className="w-full text-[11px] text-red-300/90 break-words">{f.error}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </div>
      </section>

      <section className="surface-card ring-hairline border border-border/70 rounded-2xl overflow-hidden" data-testid="card-wrike-setup">
        <div className="px-5 pt-4 pb-3 border-b border-border/50 flex items-center gap-2">
          <Plug className="w-4 h-4 text-primary" /><h2 className="text-[14px] font-semibold tracking-tight">Server setup</h2>
          {c && <span className={`text-[9.5px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 rounded ring-1 ring-inset ${c.configured ? "text-emerald-300 bg-emerald-500/10 ring-emerald-500/25" : "text-amber-300 bg-amber-500/10 ring-amber-500/25"}`} data-testid="status-wrike-configured">{c.configured ? "Configured" : "Not configured"}</span>}
        </div>
        <div className="p-5 space-y-3">
          {conn.isLoading ? <Skeleton className="h-5 w-1/2" />
            : conn.isError ? <ErrorBox message={`Couldn't load Wrike setup: ${errMsg(conn.error)}`} onRetry={() => conn.refetch()} />
            : c && c.missingSettings.length > 0 ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4 space-y-2" data-testid="list-wrike-missing">
                <div className="text-sm font-medium text-amber-200">Missing server settings</div>
                <div className="flex flex-wrap gap-1.5">
                  {c.missingSettings.map(m => <code key={m} className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-500/10 ring-1 ring-amber-500/25 text-amber-200">{m}</code>)}
                </div>
              </div>
            ) : null}
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground pt-1"><Server className="w-3 h-3" /> Self-hosted setup</div>
          <p className="text-[12.5px] text-muted-foreground leading-relaxed">
            Secrets live on the Cue Docker server, never in the browser. Create one OAuth app in Wrike (Apps & Integrations, API), set its redirect URI to the callback below, add these to the server environment and restart the container. Each person then connects their own account from My integrations.
          </p>
          <CopyLine label="PUBLIC_URL" value={DOC_PUBLIC_URL} testId="text-doc-public-url" />
          <CopyLine label="Redirect URI" value={c?.redirectUri || DOC_CALLBACK} testId="text-doc-callback" />
          <ul className="text-[12px] font-mono space-y-1 text-foreground/85">
            <li><code>WRIKE_CLIENT_ID</code> <span className="text-muted-foreground">· from the Wrike app</span></li>
            <li><code>WRIKE_CLIENT_SECRET</code> <span className="text-muted-foreground">· from the Wrike app</span></li>
            <li><code>WRIKE_TOKEN_KEY</code> <span className="text-muted-foreground">· 64 hex characters, encrypts stored tokens (openssl rand -hex 32)</span></li>
          </ul>
        </div>
      </section>

      <DocuSealAdminSection />
    </div>
  );
}
