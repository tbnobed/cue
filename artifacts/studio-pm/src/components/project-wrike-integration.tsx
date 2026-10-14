import { useEffect, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useGetProjectWrikeLink, getGetProjectWrikeLinkQueryKey,
  useSetProjectWrikeLink, useRemoveProjectWrikeLink,
  useGetWrikeConnection, getGetWrikeConnectionQueryKey,
  useListWrikeProjects, getListWrikeProjectsQueryKey,
  useSyncWrikeProject, useListWrikeSyncRuns, getListWrikeSyncRunsQueryKey,
  useUpdateWrikeSettings,
  type Project, type WrikeRemoteProject, type WrikeSyncRun,
} from "@workspace/api-client-react";
import {
  Link2, Unlink, ExternalLink, Loader2, RefreshCw, Search, Info, Lock, Check, AlertTriangle, History, Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { errMsg, useCanManageProject, ErrorBox, fmtDate } from "@/components/releases-wrike-panel";

const DT = "MMM d, yyyy · h:mm a";

/** Refresh everything a Wrike import could touch: tasks, projects, progress, dashboard. */
export function invalidateAfterWrikeSync(qc: QueryClient, projectId: number) {
  qc.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey[0];
      if (typeof k !== "string") return false;
      return k.startsWith("/api/tasks") || k.startsWith("/api/dashboard") ||
        k === "/api/projects" || k.startsWith(`/api/projects/${projectId}`);
    },
  });
}

export function ProjectWrikeIntegration({ project }: { project: Project }) {
  const canManage = useCanManageProject(project);
  const auth = useAuth();
  const isAdmin = auth.status === "authenticated" && auth.user.isAdmin;
  return <WrikeSection projectId={project.id} canManage={canManage} isAdmin={isAdmin} />;
}

const SYNC_TONE: Record<string, string> = {
  not_configured: "text-muted-foreground bg-muted/40 ring-border/60",
  idle: "text-muted-foreground bg-muted/40 ring-border/60",
  running: "text-sky-300 bg-sky-500/10 ring-sky-500/25",
  success: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/25",
  error: "text-red-300 bg-red-500/10 ring-red-500/25",
};
const SYNC_LABEL: Record<string, string> = {
  not_configured: "Not configured", idle: "Idle", running: "Syncing", success: "Synced", error: "Error",
};

function Chip({ status }: { status: string }) {
  return (
    <span data-testid={`status-wrike-sync-${status}`}
      className={`inline-flex items-center gap-1 text-[9.5px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 rounded ring-1 ring-inset whitespace-nowrap ${SYNC_TONE[status] ?? SYNC_TONE.idle}`}>
      {status === "running" && <Loader2 className="w-2.5 h-2.5 animate-spin" />}{SYNC_LABEL[status] ?? status}
    </span>
  );
}

function WrikeSection({ projectId, canManage, isAdmin }: { projectId: number; canManage: boolean; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = getGetProjectWrikeLinkQueryKey(projectId);
  const runsKey = getListWrikeSyncRunsQueryKey(projectId);
  const conn = useGetWrikeConnection({ query: { queryKey: getGetWrikeConnectionQueryKey(), staleTime: 30_000 } });
  const runsQ = useListWrikeSyncRuns(projectId, { query: { enabled: !!projectId, queryKey: runsKey } });

  const q = useGetProjectWrikeLink(projectId, {
    query: {
      enabled: !!projectId, queryKey: key, refetchOnMount: "always",
      refetchInterval: (query) => (query.state.data?.syncStatus === "running" ? 3000 : false),
    },
  });
  const link = q.data;
  const running = link?.syncStatus === "running";

  // When a run flips from running to done, refresh history + imported data.
  const [wasRunning, setWasRunning] = useState(false);
  useEffect(() => {
    if (running) { setWasRunning(true); return; }
    if (wasRunning) {
      setWasRunning(false);
      qc.invalidateQueries({ queryKey: runsKey });
      invalidateAfterWrikeSync(qc, projectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => qc.invalidateQueries({ queryKey: runsKey }), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, projectId]);

  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const setLink = useSetProjectWrikeLink({ mutation: { onSettled: invalidate } });
  const remove = useRemoveProjectWrikeLink({ mutation: { onSettled: invalidate } });
  const sync = useSyncWrikeProject({
    mutation: {
      onSettled: () => {
        invalidate();
        qc.invalidateQueries({ queryKey: runsKey });
        invalidateAfterWrikeSync(qc, projectId);
      },
    },
  });
  const settings = useUpdateWrikeSettings({
    mutation: { onSuccess: (data) => qc.setQueryData(key, data), onSettled: invalidate },
  });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [confirmSync, setConfirmSync] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = !!conn.data?.configured && !!conn.data?.connected;
  const syncDisabledReason = !conn.data ? "Checking Wrike connection…"
    : !conn.data.configured ? "Wrike isn't configured on this server."
    : !conn.data.connected ? "Wrike isn't connected. An admin can connect it in Integrations."
    : null;

  async function pick(p: WrikeRemoteProject) {
    setError(null);
    try {
      await setLink.mutateAsync({ projectId, data: { remoteId: p.id, url: p.permalink } });
      toast({ title: "Wrike project linked", description: p.title });
      setPickerOpen(false);
    } catch (err) { throw err; }
  }
  async function unlink() {
    setError(null);
    try {
      await remove.mutateAsync({ projectId });
      toast({ title: "Wrike link removed" });
    } catch (err) { setError(errMsg(err)); }
    finally { setConfirmUnlink(false); }
  }
  async function runSync() {
    setError(null);
    try {
      const run = await sync.mutateAsync({ projectId });
      if (run.status === "error") toast({ title: "Sync failed", description: run.error ?? "Wrike import failed.", variant: "destructive" });
      else if (run.status === "running") toast({ title: "Sync started" });
      else toast({ title: "Wrike sync complete", description: `${run.created} created · ${run.updated} updated · ${run.skipped} skipped` });
    } catch (err) { setError(errMsg(err)); }
    finally { setConfirmSync(false); }
  }
  async function toggleAuto(v: boolean) {
    setError(null);
    try {
      await settings.mutateAsync({ projectId, data: { autoSync: v } });
      toast({ title: v ? "Auto-sync on" : "Auto-sync off" });
    } catch (err) { setError(errMsg(err)); }
  }

  const runs = (runsQ.data ?? []).slice(0, 20);

  return (
    <section className="surface-card ring-hairline border border-border/70 rounded-2xl overflow-hidden" data-testid="section-wrike">
      <div className="px-5 pt-4 pb-3 border-b border-border/50 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-primary" />
          <h2 className="text-[13px] font-semibold tracking-tight">Wrike</h2>
          {link && <Chip status={link.syncStatus} />}
        </div>
        {link?.linked && (
          <div className="flex gap-1">
            {isAdmin && (
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setPickerOpen(true)}
                disabled={!connected} data-testid="button-change-wrike"><RefreshCw className="w-3 h-3" /> Change</Button>
            )}
            {canManage && (
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 hover:text-red-400" onClick={() => setConfirmUnlink(true)}
                data-testid="button-unlink-wrike"><Unlink className="w-3 h-3" /> Unlink</Button>
            )}
          </div>
        )}
      </div>

      <div className="p-5 space-y-4">
        {syncDisabledReason && conn.data && (
          <div className="flex items-start gap-2 rounded-lg bg-muted/40 ring-1 ring-inset ring-border/60 px-3 py-2 text-[11px] font-mono text-muted-foreground" data-testid="text-wrike-connection-state">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span className="flex-1">{syncDisabledReason}</span>
            {isAdmin && <Link href="/admin/integrations" className="text-primary hover:underline shrink-0" data-testid="link-admin-integrations">Integrations</Link>}
          </div>
        )}

        {q.isLoading ? (
          <div className="space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-9 w-1/3" /></div>
        ) : q.isError ? (
          <ErrorBox message={`Couldn't load Wrike link: ${errMsg(q.error)}`} onRetry={() => q.refetch()} />
        ) : link?.linked ? (
          <div className="space-y-4">
            <div className="space-y-1.5 text-xs">
              <div className="text-sm font-semibold break-words" data-testid="text-wrike-title">{link.remoteTitle || "Wrike project"}</div>
              <div className="font-mono text-[10.5px] text-muted-foreground break-all" data-testid="text-wrike-id">{link.remoteId}</div>
              {link.url && (
                <a href={link.url} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline inline-flex items-center gap-1 text-[11px]" data-testid="link-wrike-url">
                  Open in Wrike <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            <div className="grid grid-cols-2 gap-px rounded-xl overflow-hidden ring-1 ring-border/60 bg-border/40 text-[10.5px] font-mono">
              <div className="bg-card/80 p-2.5">
                <div className="uppercase tracking-[0.12em] text-muted-foreground">Last success</div>
                <div className="text-foreground/90 mt-1" data-testid="text-wrike-last-synced">{link.lastSyncedAt ? fmtDate(link.lastSyncedAt, DT) : "Never"}</div>
              </div>
              <div className="bg-card/80 p-2.5">
                <div className="uppercase tracking-[0.12em] text-muted-foreground">Auto-sync</div>
                <div className="mt-1 flex items-center gap-2">
                  <Switch checked={!!link.autoSync} disabled={!isAdmin || settings.isPending || !connected}
                    onCheckedChange={toggleAuto} data-testid="switch-wrike-autosync" aria-label="Auto-sync every 5 minutes" />
                  <span className="text-foreground/80">{link.autoSync ? "Every 5 min" : "Off"}</span>
                </div>
              </div>
            </div>
            {!isAdmin && <div className="text-[10px] font-mono text-muted-foreground inline-flex items-center gap-1"><Lock className="w-3 h-3" /> Auto-sync and linking are admin settings.</div>}

            {link.lastError && link.syncStatus === "error" && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-[11px] text-red-200/90 flex gap-2" data-testid="text-wrike-last-error">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-px" /> {link.lastError}
              </div>
            )}

            {canManage && (
              <Button size="sm" className="gap-1.5 w-full sm:w-auto" onClick={() => setConfirmSync(true)}
                disabled={!connected || running || sync.isPending} title={syncDisabledReason ?? undefined} data-testid="button-sync-wrike">
                {running || sync.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {running ? "Syncing…" : "Sync now"}
              </Button>
            )}

            <SyncExplainer />
            {error && <ErrorBox message={error} />}
            <RunHistory runs={runs} loading={runsQ.isLoading} error={runsQ.isError ? errMsg(runsQ.error) : null} onRetry={() => runsQ.refetch()} />
          </div>
        ) : (
          <div className="text-center py-4 space-y-3" data-testid="empty-wrike">
            <div className="text-sm text-muted-foreground">No Wrike project linked.</div>
            {isAdmin ? (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPickerOpen(true)} disabled={!connected}
                data-testid="button-link-wrike"><Link2 className="w-3.5 h-3.5" /> Link Wrike project</Button>
            ) : <div className="text-[11px] font-mono text-muted-foreground">An admin can link a Wrike project.</div>}
            {error && <ErrorBox message={error} />}
          </div>
        )}
      </div>

      {isAdmin && <WrikeProjectPicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={pick} currentId={link?.remoteId ?? null} />}

      <AlertDialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink Wrike project?</AlertDialogTitle>
            <AlertDialogDescription>
              Imports for this project stop. Tasks already imported stay in Cue as they are. Nothing is written to or deleted in Wrike.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={e => { e.preventDefault(); void unlink(); }} disabled={remove.isPending} data-testid="button-confirm-unlink">
              {remove.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1.5" />}Unlink
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmSync} onOpenChange={o => !sync.isPending && setConfirmSync(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{link?.lastSyncedAt ? "Import from Wrike now?" : "Run first Wrike import?"}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>Wrike-imported fields on Cue tasks will be overwritten with the current Wrike values. Edits made in Cue to those fields on imported tasks will be replaced.</p>
                <p>Cue-only tasks, release records, documents and project details are left alone. Nothing is written back to Wrike.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sync.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={e => { e.preventDefault(); void runSync(); }} disabled={sync.isPending} data-testid="button-confirm-sync">
              {sync.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1.5" />}Import now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function SyncExplainer() {
  return (
    <details className="group rounded-lg ring-1 ring-inset ring-border/60 bg-muted/20 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground" data-testid="text-wrike-explainer">
      <summary className="cursor-pointer select-none font-mono text-[10px] uppercase tracking-[0.12em] inline-flex items-center gap-1.5">
        <Settings2 className="w-3 h-3" /> What a sync does
      </summary>
      <ul className="mt-2 space-y-1 list-disc pl-4">
        <li>One-way: copies Wrike tasks into Cue. Cue never writes to Wrike.</li>
        <li>Copies title, description, status, priority, due date, and the assignee when exactly one matches an existing Cue team member.</li>
        <li>Those imported fields are overwritten on every import.</li>
        <li>Cue-only tasks, release docs and project metadata are preserved.</li>
        <li>Tasks deleted or moved in Wrike are kept in Cue.</li>
        <li>Imported descriptions include a provenance line pointing back to Wrike.</li>
        <li>Project membership in Cue is never changed.</li>
      </ul>
    </details>
  );
}

function RunHistory({ runs, loading, error, onRetry }: { runs: WrikeSyncRun[]; loading: boolean; error: string | null; onRetry: () => void }) {
  return (
    <div className="space-y-2" data-testid="list-wrike-runs">
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
        <History className="w-3 h-3" /> Recent runs
      </div>
      {loading ? (
        <div className="space-y-1.5">{[0, 1, 2].map(i => <Skeleton key={i} className="h-8 w-full rounded-lg" />)}</div>
      ) : error ? (
        <ErrorBox message={`Couldn't load sync history: ${error}`} onRetry={onRetry} />
      ) : runs.length === 0 ? (
        <div className="text-[11px] font-mono text-muted-foreground py-2">No syncs yet.</div>
      ) : (
        <ul className="divide-y divide-border/40 rounded-lg ring-1 ring-border/50 overflow-hidden">
          {runs.map(r => (
            <li key={r.id} className="px-3 py-2 text-[11px] font-mono flex items-center gap-3 flex-wrap" data-testid={`row-wrike-run-${r.id}`}>
              <Chip status={r.status} />
              <span className="text-muted-foreground">{fmtDate(r.startedAt, "MMM d · h:mm a")}</span>
              <span className="ml-auto tabular-nums text-foreground/80">
                <span className="text-emerald-300">+{r.created}</span> · <span className="text-sky-300">~{r.updated}</span> · <span className="text-muted-foreground">{r.skipped} skip</span>
              </span>
              {r.error && <div className="w-full text-red-300/90 break-words">{r.error}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WrikeProjectPicker({ open, onOpenChange, onPick, currentId }: {
  open: boolean; onOpenChange: (o: boolean) => void; onPick: (p: WrikeRemoteProject) => Promise<void>; currentId: string | null;
}) {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [tokens, setTokens] = useState<(string | undefined)[]>([undefined]);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(input.trim()); setTokens([undefined]); }, 300);
    return () => clearTimeout(t);
  }, [input]);
  useEffect(() => {
    if (!open) { setInput(""); setSearch(""); setTokens([undefined]); setError(null); setSaving(null); }
  }, [open]);

  const token = tokens[tokens.length - 1];
  const params = { ...(search ? { search } : {}), ...(token ? { nextPageToken: token } : {}) };
  const q = useListWrikeProjects(params, { query: { enabled: open, queryKey: getListWrikeProjectsQueryKey(params) } });
  const items = q.data?.projects ?? [];
  const next = q.data?.nextPageToken ?? null;

  async function choose(p: WrikeRemoteProject) {
    setSaving(p.id); setError(null);
    try { await onPick(p); } catch (err) { setError(errMsg(err)); } finally { setSaving(null); }
  }

  return (
    <Dialog open={open} onOpenChange={o => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[560px] max-h-[90dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Link a Wrike project</DialogTitle>
          <DialogDescription>Pick the Wrike project to import tasks from. Cue verifies it on the server.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" autoFocus value={input} onChange={e => setInput(e.target.value)} placeholder="Search Wrike projects…"
            className="pl-8 h-9 text-sm" data-testid="input-search-wrike-projects" />
        </div>
        <div className="flex-1 min-h-[200px] overflow-y-auto -mx-1 px-1">
          {q.isLoading || q.isFetching && !q.data ? (
            <div className="space-y-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
          ) : q.isError ? (
            <ErrorBox message={`Couldn't load Wrike projects: ${errMsg(q.error)}`} onRetry={() => q.refetch()} />
          ) : items.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground font-mono" data-testid="empty-wrike-projects">
              {search ? `No projects match "${search}".` : "No Wrike projects visible to the connected account."}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {items.map(p => (
                <li key={p.id}>
                  <button type="button" onClick={() => choose(p)} disabled={!!saving}
                    className="w-full text-left rounded-lg border border-border/60 hover:border-primary/40 hover:bg-primary/[0.05] px-3 py-2.5 flex items-center gap-3 transition-colors disabled:opacity-60"
                    data-testid={`button-pick-wrike-${p.id}`}>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{p.title}</div>
                      <div className="text-[10.5px] font-mono text-muted-foreground truncate">{p.id}</div>
                    </div>
                    {saving === p.id ? <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      : currentId === p.id ? <Check className="w-4 h-4 text-primary" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && <ErrorBox message={error} />}
        <DialogFooter className="flex-row justify-between sm:justify-between items-center">
          <span className="text-[10.5px] font-mono text-muted-foreground">Page {tokens.length}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={tokens.length <= 1 || q.isFetching} onClick={() => setTokens(t => t.slice(0, -1))} data-testid="button-wrike-prev">Previous</Button>
            <Button size="sm" variant="outline" disabled={!next || q.isFetching} onClick={() => next && setTokens(t => [...t, next])} data-testid="button-wrike-next">
              {q.isFetching && q.data && <Loader2 className="w-3 h-3 animate-spin mr-1.5" />}Next
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
