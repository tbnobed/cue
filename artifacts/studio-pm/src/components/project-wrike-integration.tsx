import { useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useGetProjectWrikeLink, getGetProjectWrikeLinkQueryKey,
  useSetProjectWrikeLink, useRemoveProjectWrikeLink,
  useGetWrikeConnection, getGetWrikeConnectionQueryKey,
  useListWrikeProjects, getListWrikeProjectsQueryKey,
  useSyncWrikeProject, useListWrikeSyncRuns, getListWrikeSyncRunsQueryKey,
  useUpdateWrikeSettings, useGetWrikeAudience, getGetWrikeAudienceQueryKey, useTakeOverWrikeSync,
  type Project, type WrikeRemoteProject, type WrikeSyncRun,
} from "@workspace/api-client-react";
import {
  Link2, Unlink, ExternalLink, Loader2, RefreshCw, Search, Info, Lock, Check, AlertTriangle, History, Settings2, UserRound, Users, PauseCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
const ACTIVE = new Set(["queued", "retry_wait", "running"]);

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

/** Map server errors to safe, user-facing copy. 409s never reveal another project's details. */
function wrikeErr(err: unknown, ctx: "link" | "sync" | "takeover" | "settings" | "unlink"): string {
  const status = (err as { status?: number } | null)?.status;
  if (status === 409) {
    const raw = errMsg(err).toLowerCase();
    if (ctx === "link" && (raw.includes("already") || raw.includes("duplicate"))) {
      return "That Wrike location is already linked to another Cue project. Each Wrike project or folder can feed only one Cue project.";
    }
    // A 409 can also mean a disconnected or changed account, not just a busy
    // queue. Server messages are sanitized and contain no private destination.
    return errMsg(err);
  }
  if (status === 403) return "You don't have permission to do that on this project.";
  return errMsg(err);
}

export function ProjectWrikeIntegration({ project }: { project: Project }) {
  const canManage = useCanManageProject(project);
  const auth = useAuth();
  const userId = auth.status === "authenticated" ? auth.user.id : null;
  return <WrikeSection projectId={project.id} canManage={canManage} userId={userId} />;
}

const SYNC_TONE: Record<string, string> = {
  not_configured: "text-muted-foreground bg-muted/40 ring-border/60",
  idle: "text-muted-foreground bg-muted/40 ring-border/60",
  cancelled: "text-muted-foreground bg-muted/40 ring-border/60",
  queued: "text-violet-300 bg-violet-500/10 ring-violet-500/25",
  retry_wait: "text-amber-300 bg-amber-500/10 ring-amber-500/25",
  running: "text-sky-300 bg-sky-500/10 ring-sky-500/25",
  success: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/25",
  error: "text-red-300 bg-red-500/10 ring-red-500/25",
  paused: "text-amber-300 bg-amber-500/10 ring-amber-500/25",
};
const SYNC_LABEL: Record<string, string> = {
  not_configured: "Not configured", idle: "Idle", queued: "Queued", retry_wait: "Retrying soon", running: "Syncing",
  success: "Synced", error: "Error", paused: "Paused", cancelled: "Cancelled",
};

function Chip({ status }: { status: string }) {
  return (
    <span data-testid={`status-wrike-sync-${status}`}
      className={`inline-flex items-center gap-1 text-[9.5px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 rounded ring-1 ring-inset whitespace-nowrap ${SYNC_TONE[status] ?? SYNC_TONE.idle}`}>
      {ACTIVE.has(status) && <Loader2 className="w-2.5 h-2.5 animate-spin" />}{status === "paused" && <PauseCircle className="w-2.5 h-2.5" />}{SYNC_LABEL[status] ?? status}
    </span>
  );
}

type Pending = { kind: "link"; remote: WrikeRemoteProject } | { kind: "takeover" };

function WrikeSection({ projectId, canManage, userId }: { projectId: number; canManage: boolean; userId: number | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = getGetProjectWrikeLinkQueryKey(projectId);
  const runsKey = getListWrikeSyncRunsQueryKey(projectId);
  const conn = useGetWrikeConnection({ query: { queryKey: getGetWrikeConnectionQueryKey(), staleTime: 30_000 } });

  const q = useGetProjectWrikeLink(projectId, {
    query: {
      enabled: !!projectId, queryKey: key, refetchOnMount: "always",
      refetchInterval: (query) => (ACTIVE.has(query.state.data?.syncStatus ?? "") ? 3000 : 10_000),
    },
  });
  const link = q.data;
  const active = ACTIVE.has(link?.syncStatus ?? "");
  const runsQ = useListWrikeSyncRuns(projectId, {
    query: { enabled: !!projectId && !!link?.linked, queryKey: runsKey, refetchInterval: active ? 4000 : 10_000 },
  });

  // Notify when an active job settles (works for jobs started by anyone, persisted across reloads).
  const prevStatus = useRef<string | null>(null);
  useEffect(() => {
    const s = link?.syncStatus ?? null;
    const prev = prevStatus.current;
    prevStatus.current = s;
    if (!prev || !s || !ACTIVE.has(prev) || ACTIVE.has(s)) return;
    void (async () => {
      await qc.invalidateQueries({ queryKey: runsKey });
      invalidateAfterWrikeSync(qc, projectId);
      const runs = qc.getQueryData<WrikeSyncRun[]>(runsKey) ?? [];
      const r = runs.find(x => !ACTIVE.has(x.status));
      if (s === "error" || r?.status === "error") {
        toast({ title: "Wrike import failed", description: r?.error ?? link?.lastError ?? "The import did not complete.", variant: "destructive" });
      } else if (s === "paused") {
        toast({ title: "Wrike sync paused", description: "The sync owner's Wrike connection isn't usable. Reconnect or take over the sync.", variant: "destructive" });
      } else if (r && r.status === "success") {
        const total = r.created + r.updated + r.skipped;
        toast({
          title: total === 0 ? "Import finished: no tasks found" : "Wrike import complete",
          description: total === 0 ? "Check that the linked location is the parent folder or project that contains your tasks." : `${r.created} created · ${r.updated} updated · ${r.skipped} skipped`,
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link?.syncStatus]);

  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const setLink = useSetProjectWrikeLink({ mutation: { onSettled: invalidate } });
  const remove = useRemoveProjectWrikeLink({ mutation: { onSettled: invalidate } });
  const takeover = useTakeOverWrikeSync({ mutation: { onSuccess: (d) => qc.setQueryData(key, d), onSettled: invalidate } });
  const sync = useSyncWrikeProject({ mutation: { onSettled: () => { invalidate(); qc.invalidateQueries({ queryKey: runsKey }); } } });
  const settings = useUpdateWrikeSettings({ mutation: { onSuccess: (data) => qc.setQueryData(key, data), onSettled: invalidate } });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [confirmSync, setConfirmSync] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const c = conn.data;
  const meConnected = !!c?.configured && !!c?.connected;
  const isSyncOwner = link?.syncOwnerUserId != null && link.syncOwnerUserId === userId;
  const ready = !!link?.connectionReady;
  const canTakeOver = canManage && !!link?.linked && meConnected && !isSyncOwner;

  const personalHint = !c ? null
    : !c.configured ? "Wrike isn't configured on this Cue server. Ask an admin."
    : !c.connected ? "Connect your own Wrike account to link a project or take over a sync."
    : null;

  async function confirmPending() {
    if (!pending) return;
    setError(null);
    try {
      if (pending.kind === "link") {
        await setLink.mutateAsync({ projectId, data: { confirmVisibility: true, remoteId: pending.remote.id, url: pending.remote.permalink } });
        toast({ title: "Wrike location linked", description: `${pending.remote.title}. Syncs through your Wrike connection.` });
      } else {
        await takeover.mutateAsync({ projectId, data: { confirmVisibility: true } });
        toast({ title: "You now own this Wrike sync", description: "Imports use your Wrike connection from now on." });
      }
      setPending(null);
    } catch (err) {
      setError(wrikeErr(err, pending.kind));
      setPending(null);
    }
  }
  async function unlink() {
    setError(null);
    try { await remove.mutateAsync({ projectId }); toast({ title: "Wrike link removed" }); }
    catch (err) { setError(wrikeErr(err, "unlink")); }
    finally { setConfirmUnlink(false); }
  }
  async function runSync() {
    setError(null);
    try {
      const run = await sync.mutateAsync({ projectId });
      prevStatus.current = "queued";
      qc.setQueryData(key, (old: typeof link) => (old ? { ...old, syncStatus: run.status === "running" ? "running" : "queued" } : old));
      toast({ title: "Import queued", description: "Cue will let you know when it finishes. You can leave this page." });
    } catch (err) { setError(wrikeErr(err, "sync")); }
    finally { setConfirmSync(false); }
  }
  async function toggleAuto(v: boolean) {
    setError(null);
    try { await settings.mutateAsync({ projectId, data: { autoSync: v } }); toast({ title: v ? "Auto-sync on" : "Auto-sync off" }); }
    catch (err) { setError(wrikeErr(err, "settings")); }
  }

  const runs = (runsQ.data ?? []).slice(0, 20);
  const ownerLabel = isSyncOwner ? "You" : link?.syncOwnerName || "Unassigned";

  return (
    <section className="surface-card ring-hairline border border-border/70 rounded-2xl overflow-hidden" data-testid="section-wrike">
      <div className="px-5 pt-4 pb-3 border-b border-border/50 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-primary" />
          <h2 className="text-[13px] font-semibold tracking-tight">Wrike</h2>
          {link && <Chip status={link.syncStatus} />}
        </div>
        {link?.linked && canManage && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setPickerOpen(true)}
              disabled={!meConnected || active} title={active ? "Wait for the current import to finish." : personalHint ?? undefined} data-testid="button-change-wrike"><RefreshCw className="w-3 h-3" /> Change</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 hover:text-red-400" onClick={() => setConfirmUnlink(true)}
              disabled={active} data-testid="button-unlink-wrike"><Unlink className="w-3 h-3" /> Unlink</Button>
          </div>
        )}
      </div>

      <div className="p-5 space-y-4">
        {canManage && personalHint && (
          <div className="flex items-start gap-2 rounded-lg bg-muted/40 ring-1 ring-inset ring-border/60 px-3 py-2 text-[11px] font-mono text-muted-foreground" data-testid="text-wrike-connection-state">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span className="flex-1">{personalHint}</span>
            {c?.configured && <Link href="/integrations" className="text-primary hover:underline shrink-0" data-testid="link-my-integrations">My integrations</Link>}
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
                <div className="uppercase tracking-[0.12em] text-muted-foreground">Sync owner</div>
                <div className="text-foreground/90 mt-1 flex items-center gap-1.5" data-testid="text-wrike-sync-owner">
                  <UserRound className="w-3 h-3" />{ownerLabel}
                  <span className={ready ? "text-emerald-300" : "text-amber-300"} data-testid="text-wrike-connection-ready">{ready ? "· ready" : "· not ready"}</span>
                </div>
              </div>
              <div className="bg-card/80 p-2.5">
                <div className="uppercase tracking-[0.12em] text-muted-foreground">Last success</div>
                <div className="text-foreground/90 mt-1" data-testid="text-wrike-last-synced">{link.lastSyncedAt ? fmtDate(link.lastSyncedAt, DT) : "Never"}</div>
              </div>
              <div className="bg-card/80 p-2.5">
                <div className="uppercase tracking-[0.12em] text-muted-foreground">Auto-sync</div>
                <div className="mt-1 flex items-center gap-2">
                  <Switch checked={!!link.autoSync} disabled={!canManage || settings.isPending || !ready}
                    onCheckedChange={toggleAuto} data-testid="switch-wrike-autosync" aria-label="Auto-sync every 5 minutes" />
                  <span className="text-foreground/80">{link.autoSync ? "Every 5 min" : "Off"}</span>
                </div>
              </div>
              <div className="bg-card/80 p-2.5">
                <div className="uppercase tracking-[0.12em] text-muted-foreground">Next sync</div>
                <div className="text-foreground/90 mt-1" data-testid="text-wrike-next-sync">{link.nextSyncAt ? fmtDate(link.nextSyncAt, DT) : "—"}</div>
              </div>
            </div>
            {!canManage && <div className="text-[10px] font-mono text-muted-foreground inline-flex items-center gap-1"><Lock className="w-3 h-3" /> Read-only. The project owner or an admin manages this link.</div>}

            {(link.syncStatus === "paused" || !ready) && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-[11.5px] text-amber-200/90 flex gap-2" data-testid="text-wrike-paused">
                <PauseCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                <span>
                  Imports are paused because {isSyncOwner ? "your" : `${ownerLabel}'s`} Wrike connection isn't usable (disconnected, reconnected pending review, or deactivated).{" "}
                  {isSyncOwner ? <>Reconnect in <Link href="/integrations" className="underline">My integrations</Link>, then turn auto-sync back on.</>
                    : canManage ? (meConnected ? "You can take over the sync with your own Wrike below." : "Connect your own Wrike to take over the sync.")
                    : "Ask the project owner or an admin to reconnect or take over."}
                </span>
              </div>
            )}

            {link.lastError && link.syncStatus === "error" && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-[11px] text-red-200/90 flex gap-2" data-testid="text-wrike-last-error">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-px" /> {link.lastError}
              </div>
            )}

            {canManage && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="gap-1.5 w-full sm:w-auto" onClick={() => setConfirmSync(true)}
                  disabled={!ready || active || sync.isPending} title={!ready ? "The sync owner's Wrike connection isn't ready." : undefined} data-testid="button-sync-wrike">
                  {active || sync.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  {link.syncStatus === "queued" ? "Queued…" : link.syncStatus === "retry_wait" ? "Retrying soon…" : link.syncStatus === "running" ? "Syncing…" : "Sync now"}
                </Button>
                {canTakeOver && (
                  <Button size="sm" variant="outline" className="gap-1.5 w-full sm:w-auto" onClick={() => setPending({ kind: "takeover" })}
                    disabled={takeover.isPending} data-testid="button-takeover-wrike">
                    <UserRound className="w-3.5 h-3.5" /> Take over with my Wrike
                  </Button>
                )}
              </div>
            )}

            <SyncExplainer />
            {error && <ErrorBox message={error} />}
            <RunHistory runs={runs} loading={runsQ.isLoading} error={runsQ.isError ? errMsg(runsQ.error) : null} onRetry={() => runsQ.refetch()} />
          </div>
        ) : (
          <div className="text-center py-4 space-y-3" data-testid="empty-wrike">
            <div className="text-sm text-muted-foreground">No Wrike project or folder linked.</div>
            {canManage ? (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPickerOpen(true)} disabled={!meConnected}
                data-testid="button-link-wrike"><Link2 className="w-3.5 h-3.5" /> Link from my Wrike</Button>
            ) : <div className="text-[11px] font-mono text-muted-foreground">The project owner or an admin can link a Wrike project or folder.</div>}
            {error && <ErrorBox message={error} />}
          </div>
        )}
      </div>

      {canManage && (
        <WrikeProjectPicker open={pickerOpen} onOpenChange={setPickerOpen} currentId={link?.remoteId ?? null}
          onPick={(p) => { setPickerOpen(false); setPending({ kind: "link", remote: p }); }} />
      )}

      <AudienceConfirm projectId={projectId} pending={pending} busy={setLink.isPending || takeover.isPending}
        onCancel={() => setPending(null)} onConfirm={() => void confirmPending()} ownerName={link?.syncOwnerName ?? null} />

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
            <AlertDialogTitle>{link?.lastSyncedAt ? "Queue a Wrike import now?" : "Queue first Wrike import?"}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>The import runs in the background using {isSyncOwner ? "your" : `${ownerLabel}'s`} Wrike connection.</p>
                <p>Wrike-imported fields on Cue tasks will be overwritten with the current Wrike values. Edits made in Cue to those fields on imported tasks will be replaced.</p>
                <p>Cue-only tasks, release records, documents and project details are left alone. Nothing is written back to Wrike.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sync.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={e => { e.preventDefault(); void runSync(); }} disabled={sync.isPending} data-testid="button-confirm-sync">
              {sync.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1.5" />}Queue import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function AudienceConfirm({ projectId, pending, busy, onCancel, onConfirm, ownerName }: {
  projectId: number; pending: Pending | null; busy: boolean; onCancel: () => void; onConfirm: () => void; ownerName: string | null;
}) {
  const open = pending !== null;
  const [agreed, setAgreed] = useState(false);
  useEffect(() => { if (!open) setAgreed(false); }, [open]);
  const aud = useGetWrikeAudience(projectId, { query: { enabled: open && !!projectId, queryKey: getGetWrikeAudienceQueryKey(projectId), staleTime: 0 } });
  const members = aud.data?.members ?? [];
  const isTake = pending?.kind === "takeover";

  return (
    <Dialog open={open} onOpenChange={o => !busy && !o && onCancel()}>
      <DialogContent className="sm:max-w-[520px] max-h-[90dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isTake ? "Take over this Wrike sync?" : "Review who will see imported Wrike data"}</DialogTitle>
          <DialogDescription>
            {isTake
              ? `Cue checks that your Wrike account can access the same linked location, then switches the sync owner from ${ownerName || "the current owner"} to you. Pending imports are cancelled and auto-sync is turned off for review. Already-imported tasks and history are preserved.`
              : pending?.kind === "link" ? `Tasks from "${pending.remote.title}" will be imported through your Wrike connection.` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
          <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground"><Users className="w-3 h-3" /> Can see imported data</div>
          {aud.isLoading ? (
            <div className="space-y-1.5">{[0, 1, 2].map(i => <Skeleton key={i} className="h-7 w-full rounded-md" />)}</div>
          ) : aud.isError ? (
            <ErrorBox message={`Couldn't load the audience: ${errMsg(aud.error)}`} onRetry={() => aud.refetch()} />
          ) : (
            <>
              <ul className="flex flex-wrap gap-1.5" data-testid="list-wrike-audience">
                {members.map(m => (
                  <li key={m.id} className="text-[11.5px] px-2 py-1 rounded-md bg-muted/40 ring-1 ring-inset ring-border/60" data-testid={`text-audience-${m.id}`}>{m.name}</li>
                ))}
                {members.length === 0 && <li className="text-[11px] font-mono text-muted-foreground">No named members.</li>}
              </ul>
              {aud.data?.note && <p className="text-[11.5px] text-muted-foreground leading-relaxed" data-testid="text-audience-note">{aud.data.note}</p>}
            </>
          )}
          <p className="text-[11.5px] text-muted-foreground leading-relaxed">
            All Cue admins, the project owner, project members and anyone with an existing share link to this project can see imported tasks, even if they have no Wrike access themselves.
          </p>
          <label className="flex items-start gap-2.5 rounded-lg border border-primary/30 bg-primary/[0.05] px-3 py-2.5 text-[12px] cursor-pointer">
            <Checkbox checked={agreed} onCheckedChange={v => setAgreed(v === true)} disabled={busy || aud.isLoading || aud.isError} className="mt-0.5" data-testid="checkbox-confirm-visibility" />
            <span>I understand everyone listed above will be able to see the Wrike data imported into this project.</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy} data-testid="button-cancel-audience">Cancel</Button>
          <Button size="sm" onClick={onConfirm} disabled={!agreed || busy} data-testid="button-confirm-audience">
            {busy && <Loader2 className="w-3 h-3 animate-spin mr-1.5" />}{isTake ? "Take over sync" : "Link project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
              {(r.attempts ?? 0) > 1 && <span className="text-muted-foreground">attempt {r.attempts}</span>}
              {r.status === "retry_wait" && r.availableAt && <span className="text-amber-300/90">retry {fmtDate(r.availableAt, "h:mm a")}</span>}
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
  open: boolean; onOpenChange: (o: boolean) => void; onPick: (p: WrikeRemoteProject) => void; currentId: string | null;
}) {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [tokens, setTokens] = useState<(string | undefined)[]>([undefined]);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(input.trim()); setTokens([undefined]); }, 300);
    return () => clearTimeout(t);
  }, [input]);
  useEffect(() => {
    if (!open) { setInput(""); setSearch(""); setTokens([undefined]); }
  }, [open]);

  const token = tokens[tokens.length - 1];
  const params = { ...(search ? { search } : {}), ...(token ? { nextPageToken: token } : {}) };
  const q = useListWrikeProjects(params, { query: { enabled: open, queryKey: getListWrikeProjectsQueryKey(params) } });
  const items = q.data?.projects ?? [];
  const next = q.data?.nextPageToken ?? null;


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Link a Wrike project or folder</DialogTitle>
          <DialogDescription>Choose the parent location containing your tasks—not an individual item inside it. Showing only locations your own Wrike account can access. Cue imports tasks from this location and its descendants.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" autoFocus value={input} onChange={e => setInput(e.target.value)} placeholder="Search Wrike projects and folders…"
            className="pl-8 h-9 text-sm" data-testid="input-search-wrike-projects" />
        </div>
        <div className="flex-1 min-h-[200px] overflow-y-auto -mx-1 px-1">
          {q.isLoading || q.isFetching && !q.data ? (
            <div className="space-y-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
          ) : q.isError ? (
            <ErrorBox message={`Couldn't load Wrike projects and folders: ${errMsg(q.error)}`} onRetry={() => q.refetch()} />
          ) : items.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground font-mono" data-testid="empty-wrike-projects">
              {next ? "No results on this page. Select Next to continue." : search ? `No projects or folders match "${search}". Check that your Wrike account has access.` : "No Wrike projects or folders visible to your Wrike account."}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {items.map(p => (
                <li key={p.id}>
                  <button type="button" onClick={() => onPick(p)}
                    className="w-full text-left rounded-lg border border-border/60 hover:border-primary/40 hover:bg-primary/[0.05] px-3 py-2.5 flex items-center gap-3 transition-colors disabled:opacity-60"
                    data-testid={`button-pick-wrike-${p.id}`}>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{p.title}</div>
                      <div className="text-[10.5px] font-mono text-muted-foreground truncate">{p.id}</div>
                    </div>
                    {currentId === p.id ? <Check className="w-4 h-4 text-primary" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
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
