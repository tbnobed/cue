import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProjectReleases, getListProjectReleasesQueryKey,
  useCreateProjectRelease, useUpdateRelease, useArchiveRelease,
  type ReleaseRecord, type ReleaseInput, type ReleaseInputStatus, type Project,
} from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  Plus, Search, Pencil, Archive, Download, Lock, ShieldCheck, AlertTriangle,
  Loader2, RefreshCw, FileCheck2, PenLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { SigningChip, SigningDialog, useReleaseSigningState, isDocuSealManaged, ApprovedTemplatePicker } from "@/components/release-signing";
import { useAuth } from "@/hooks/use-auth";

const MAX_PDF = 20 * 1024 * 1024;
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STATUS_META: Record<string, { label: string; tone: string }> = {
  draft:               { label: "Draft",               tone: "text-muted-foreground bg-muted/40 ring-border/60" },
  awaiting_signatures: { label: "Awaiting signatures", tone: "text-amber-300 bg-amber-500/10 ring-amber-500/25" },
  signed:              { label: "Signed",              tone: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/25" },
  archived:            { label: "Archived",            tone: "text-primary bg-primary/10 ring-primary/30" },
};

export function errMsg(err: unknown): string {
  const e = err as { data?: { error?: string; message?: string }; message?: string } | null;
  return e?.data?.error || e?.data?.message || e?.message || "Request failed";
}

/** Admin or project owner may mutate; members get read-only. */
export function useCanManageProject(project: Pick<Project, "ownerUserId"> | undefined | null): boolean {
  const auth = useAuth();
  if (auth.status !== "authenticated" || !project) return false;
  return auth.user.isAdmin || (project.ownerUserId != null && project.ownerUserId === auth.user.id);
}

export function fmtDate(d?: string | null, pattern = "MMM d, yyyy") {
  if (!d) return "—";
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T00:00:00") : new Date(d);
  return isNaN(dt.getTime()) ? d : format(dt, pattern);
}

function StatusChip({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <span data-testid={`status-release-${status}`}
      className={`inline-flex items-center gap-1 text-[9.5px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 rounded ring-1 ring-inset whitespace-nowrap ${m.tone}`}>
      {status === "archived" && <Lock className="w-2.5 h-2.5" />}{m.label}
    </span>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 flex items-start gap-3 text-sm" role="alert">
      <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0 text-red-200/90 break-words">{message}</div>
      {onRetry && (
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onRetry} data-testid="button-retry">
          <RefreshCw className="w-3 h-3" /> Retry
        </Button>
      )}
    </div>
  );
}

export function ReleasesPanel({ project, compact = false }: { project: Project; compact?: boolean }) {
  const canManage = useCanManageProject(project);
  return <ReleasesSection projectId={project.id} canManage={canManage} compact={compact} />;
}

export { ProjectWrikeIntegration } from "@/components/project-wrike-integration";

// ─── RELEASES ───────────────────────────────────────────────────────────────

type FormState = {
  guestName: string; guestEmail: string; title: string; templateVersion: string;
  productionDate: string; status: ReleaseInputStatus; notes: string;
};
const EMPTY: FormState = {
  guestName: "", guestEmail: "", title: "", templateVersion: "", productionDate: "", status: "draft", notes: "",
};

function ReleasesSection({ projectId, canManage, compact }: { projectId: number; canManage: boolean; compact: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const listKey = getListProjectReleasesQueryKey(projectId);
  const q = useListProjectReleases(projectId, {
    query: { enabled: !!projectId, queryKey: listKey, refetchOnMount: "always", refetchInterval: 15_000 },
  });

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<ReleaseRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<ReleaseRecord | null>(null);
  const [signingId, setSigningId] = useState<number | null>(null);
  const signing = releases_find(q.data, signingId);

  const invalidate = () => qc.invalidateQueries({ queryKey: listKey });
  const create = useCreateProjectRelease({ mutation: { onSettled: invalidate } });
  const update = useUpdateRelease({ mutation: { onSettled: invalidate } });

  const releases = q.data ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = { draft: 0, awaiting_signatures: 0, signed: 0, archived: 0 };
    for (const r of releases) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [releases]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return releases.filter(r =>
      (filter === "all" || r.status === filter) &&
      (!s || [r.guestName, r.guestEmail, r.title, r.templateVersion, r.notes, r.fileName ?? ""]
        .some(v => v.toLowerCase().includes(s))));
  }, [releases, search, filter]);

  function openNew() {
    setEditing(null); setForm(EMPTY); setFormError(null); setFormOpen(true);
  }
  function openEdit(r: ReleaseRecord) {
    if (r.status === "archived") return;
    setEditing(r);
    setForm({
      guestName: r.guestName, guestEmail: r.guestEmail, title: r.title, templateVersion: r.templateVersion,
      productionDate: r.productionDate ?? "", status: r.status as ReleaseInputStatus, notes: r.notes ?? "",
    });
    setFormError(null); setFormOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const data: ReleaseInput = {
      guestName: form.guestName.trim(), guestEmail: form.guestEmail.trim(), title: form.title.trim(),
      templateVersion: form.templateVersion.trim(), productionDate: form.productionDate || null,
      status: form.status, notes: form.notes,
    };
    if (!data.guestName || !data.title || !data.templateVersion || !data.guestEmail) {
      setFormError("Guest name, email, title and template version are required."); return;
    }
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, data });
        toast({ title: "Release updated" });
      } else {
        await create.mutateAsync({ projectId, data });
        toast({ title: "Release record created" });
      }
      setFormOpen(false);
    } catch (err) {
      setFormError(errMsg(err));
    }
  }

  const busy = create.isPending || update.isPending;

  return (
    <section className="surface-card ring-hairline border border-border/70 rounded-2xl overflow-hidden" data-testid="section-releases">
      <div className="px-5 pt-4 pb-3 border-b border-border/50 flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <h2 className="text-[13px] font-semibold tracking-tight">Guest Releases</h2>
          </div>
          <p className="text-[10.5px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            Sent and tracked through DocuSeal · legacy manual archive kept for older records
          </p>
        </div>
        {canManage ? (
          <Button size="sm" className="h-8 gap-1.5" onClick={openNew} data-testid="button-new-release">
            <Plus className="w-3.5 h-3.5" /> New release
          </Button>
        ) : (
          <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground inline-flex items-center gap-1.5" data-testid="text-release-readonly">
            <Lock className="w-3 h-3" /> Read-only · owner or admin edits
          </span>
        )}
      </div>

      {/* ledger strip */}
      <div className="grid grid-cols-4 border-b border-border/50">
        {(["draft", "awaiting_signatures", "signed", "archived"] as const).map(s => (
          <button key={s} type="button" onClick={() => setFilter(f => f === s ? "all" : s)}
            data-testid={`filter-release-${s}`}
            className={`px-3 py-2.5 text-left border-r last:border-r-0 border-border/40 transition-colors ${filter === s ? "bg-primary/[0.08]" : "hover:bg-white/[0.02]"}`}>
            <div className="font-display text-xl tabular-nums leading-none">{q.isLoading ? "–" : counts[s]}</div>
            <div className="text-[9px] font-mono uppercase tracking-[0.12em] text-muted-foreground mt-1 truncate">
              {s === "awaiting_signatures" ? (compact ? "Awaiting" : "Awaiting sig.") : STATUS_META[s].label}
            </div>
          </button>
        ))}
      </div>

      <div className="p-4 space-y-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search guest, email, title, template, file…" className="pl-8 h-9 text-sm"
            data-testid="input-search-releases" />
        </div>
        {filter !== "all" && (
          <button type="button" onClick={() => setFilter("all")} className="text-[11px] font-mono text-primary" data-testid="button-clear-filter">
            Showing {STATUS_META[filter].label.toLowerCase()} only · clear
          </button>
        )}

        {q.isLoading ? (
          <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
        ) : q.isError ? (
          <ErrorBox message={`Couldn't load releases: ${errMsg(q.error)}`} onRetry={() => q.refetch()} />
        ) : releases.length === 0 ? (
          <div className="text-center py-10 space-y-3 rounded-xl border border-dashed border-border/60" data-testid="empty-releases">
            <FileCheck2 className="w-7 h-7 mx-auto text-muted-foreground/60" />
            <div className="text-sm font-medium">No guest releases on file</div>
            <div className="text-xs text-muted-foreground max-w-xs mx-auto">
              Log every on-camera guest here, then send the release through DocuSeal. The signed PDF is filed automatically.
            </div>
            {canManage && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={openNew}><Plus className="w-3.5 h-3.5" /> Log first guest</Button>
            )}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground font-mono" data-testid="empty-release-search">No releases match.</div>
        ) : (
          <ul className="space-y-2">
            {filtered.map(r => (
              <ReleaseRow key={r.id} r={r} canManage={canManage} compact={compact}
                onEdit={() => openEdit(r)} onArchive={() => setArchiving(r)} onSigning={() => setSigningId(r.id)} />
            ))}
          </ul>
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={o => !busy && setFormOpen(o)}>
        <DialogContent className="sm:max-w-[560px] max-h-[90dvh] overflow-y-auto">
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit release record" : "New release record"}</DialogTitle>
              <DialogDescription>Save as draft, then use Sign to send it through DocuSeal. The manual status only applies to legacy records handled outside DocuSeal.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <Field id="rel-guest" label="Guest name *">
                  <Input id="rel-guest" maxLength={200} value={form.guestName} data-testid="input-release-guest-name"
                    onChange={e => setForm(f => ({ ...f, guestName: e.target.value }))} />
                </Field>
                <Field id="rel-email" label="Guest email *">
                  <Input id="rel-email" type="email" maxLength={320} value={form.guestEmail} data-testid="input-release-guest-email"
                    onChange={e => setForm(f => ({ ...f, guestEmail: e.target.value }))} />
                </Field>
              </div>
              <Field id="rel-title" label="Release title *">
                <Input id="rel-title" maxLength={200} value={form.title} placeholder="e.g. Episode 14 appearance release"
                  data-testid="input-release-title" onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              </Field>
              <div className="grid sm:grid-cols-3 gap-4">
                {!editing && (
                  <div className="sm:col-span-3 grid gap-1.5">
                    <Label className="text-xs">Approved DocuSeal template</Label>
                    <ApprovedTemplatePicker value={form.templateVersion} onPick={t => setForm(f => ({ ...f, templateVersion: t.version }))} />
                    <p className="text-[10.5px] text-muted-foreground">Fills the version below. The version actually used is set from the approved template chosen when you send.</p>
                  </div>
                )}
                <Field id="rel-tpl" label="Template version *">
                  <Input id="rel-tpl" maxLength={100} value={form.templateVersion} placeholder="TBN-GR v3.2"
                    data-testid="input-release-template" onChange={e => setForm(f => ({ ...f, templateVersion: e.target.value }))} />
                </Field>
                <Field id="rel-date" label="Production date">
                  <Input id="rel-date" type="date" value={form.productionDate} data-testid="input-release-date"
                    onChange={e => setForm(f => ({ ...f, productionDate: e.target.value }))} />
                </Field>
                <Field id="rel-status" label="Status (legacy manual)">
                  <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as ReleaseInputStatus }))}>
                    <SelectTrigger id="rel-status" data-testid="select-release-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="awaiting_signatures">Awaiting signatures</SelectItem>
                      <SelectItem value="signed">Signed</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field id="rel-notes" label="Notes">
                <Textarea id="rel-notes" rows={3} maxLength={5000} value={form.notes} data-testid="input-release-notes"
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </Field>
              {formError && <ErrorBox message={formError} />}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setFormOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy} data-testid="button-save-release">
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}{editing ? "Save changes" : "Create record"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <SigningDialog release={signing} canManage={canManage} onClose={() => setSigningId(null)} />
      <ArchiveDialog release={archiving} onClose={() => setArchiving(null)} onDone={invalidate} />
    </section>
  );
}

function releases_find(list: ReleaseRecord[] | undefined, id: number | null) {
  return id == null ? null : (list ?? []).find(r => r.id === id) ?? null;
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return <div className="grid gap-1.5"><Label htmlFor={id} className="text-xs">{label}</Label>{children}</div>;
}

function ReleaseRow({ r, canManage, compact, onEdit, onArchive, onSigning }: {
  r: ReleaseRecord; canManage: boolean; compact: boolean; onEdit: () => void; onArchive: () => void; onSigning: () => void;
}) {
  const archived = r.status === "archived";
  const sq = useReleaseSigningState(r.id);
  const managed = isDocuSealManaged(sq.data);
  const prevArchived = sq.data?.state === "archived";
  const qc = useQueryClient();
  useEffect(() => {
    if (prevArchived && !archived) void qc.invalidateQueries({ queryKey: getListProjectReleasesQueryKey(r.projectId) });
  }, [prevArchived, archived, qc, r.projectId]);
  return (
    <li data-testid={`row-release-${r.id}`}
      className={`rounded-xl border p-3.5 transition-colors ${archived ? "border-primary/25 bg-primary/[0.04]" : "border-border/60 bg-white/[0.015] hover:bg-white/[0.03]"}`}>
      <div className={`flex gap-3 ${compact ? "flex-col" : "items-start justify-between"}`}>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate" data-testid={`text-release-guest-${r.id}`}>{r.guestName}</span>
            <StatusChip status={r.status} />
            {sq.data && managed && <SigningChip state={sq.data.state} testId={`status-signing-${r.id}`} />}
            {sq.isError && <span className="text-[10px] font-mono text-red-300" role="alert" data-testid={`error-signing-${r.id}`}>signing status unavailable: {errMsg(sq.error)}</span>}
          </div>
          <div className="text-[13px] text-foreground/80 truncate">{r.title}</div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] font-mono text-muted-foreground tabular-nums">
            <span className="truncate max-w-[220px]">{r.guestEmail}</span>
            <span>tpl {r.templateVersion}</span>
            <span>shoot {fmtDate(r.productionDate)}</span>
          </div>
          {r.notes && <p className="text-xs text-muted-foreground line-clamp-2 pt-0.5">{r.notes}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          {(managed || (canManage && !archived)) && (
            <Button size="sm" variant={managed ? "outline" : "default"} className="h-7 gap-1.5 text-xs" onClick={onSigning} data-testid={`button-signing-${r.id}`}>
              <PenLine className="w-3 h-3" /> {managed ? "Signing" : "Sign"}
            </Button>
          )}
          {archived ? (
            <Button asChild size="sm" variant="outline" className="h-7 gap-1.5 text-xs">
              <a href={`${BASE}/api/releases/${r.id}/file`} target="_blank" rel="noreferrer" data-testid={`link-download-release-${r.id}`}>
                <Download className="w-3 h-3" /> PDF
              </a>
            </Button>
          ) : canManage && managed ? (
            <span className="text-[10px] font-mono text-muted-foreground inline-flex items-center gap-1" data-testid={`text-docuseal-managed-${r.id}`}><Lock className="w-3 h-3" /> Managed by DocuSeal</span>
          ) : canManage ? (
            <>
              <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={onEdit} data-testid={`button-edit-release-${r.id}`}>
                <Pencil className="w-3 h-3" /> Edit
              </Button>
              <Button size="sm" variant={r.status === "signed" ? "outline" : "ghost"} className="h-7 gap-1.5 text-xs"
                disabled={r.status !== "signed"} onClick={onArchive}
                title={r.status === "signed" ? "Legacy: upload a signed PDF manually" : "Legacy: mark as signed before manual archiving"}
                data-testid={`button-archive-release-${r.id}`}>
                <Archive className="w-3 h-3" /> Legacy archive
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {archived && (
        <div className="mt-3 pt-3 border-t border-primary/15 grid gap-1 text-[10.5px] font-mono text-muted-foreground" data-testid={`archive-meta-${r.id}`}>
          <div className="flex gap-2"><span className="w-16 shrink-0 uppercase tracking-[0.1em]">File</span><span className="text-foreground/85 break-all">{r.fileName ?? "—"}</span></div>
          <div className="flex gap-2"><span className="w-16 shrink-0 uppercase tracking-[0.1em]">SHA-256</span><span className="text-foreground/70 break-all select-all">{r.sha256 ?? "—"}</span></div>
          <div className="flex gap-2"><span className="w-16 shrink-0 uppercase tracking-[0.1em]">Sealed</span><span className="text-foreground/85">{fmtDate(r.archivedAt, "MMM d, yyyy · h:mm a")}</span></div>
          <div className="flex items-center gap-1.5 pt-1 text-primary/80"><Lock className="w-3 h-3" /> Archived records are immutable.</div>
        </div>
      )}
    </li>
  );
}

function ArchiveDialog({ release, onClose, onDone }: { release: ReleaseRecord | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archive = useArchiveRelease({ mutation: { onSettled: onDone } });

  function reset() { setFile(null); setConfirmed(false); setError(null); archive.reset(); }

  function pick(f: File | null) {
    setError(null);
    if (!f) { setFile(null); return; }
    const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) { setFile(null); setError("Only PDF files can be archived."); return; }
    if (f.size > MAX_PDF) { setFile(null); setError(`File is ${(f.size / 1048576).toFixed(1)} MB. Maximum is 20 MB.`); return; }
    setFile(f);
  }

  async function submit() {
    if (!release || !file || !confirmed) return;
    setError(null);
    try {
      await archive.mutateAsync({ id: release.id, data: { file, confirmed: "true" } });
      toast({ title: "Release archived", description: `${release.guestName} is sealed.` });
      reset(); onClose();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  return (
    <Dialog open={!!release} onOpenChange={o => { if (!o && !archive.isPending) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Legacy manual archive</DialogTitle>
          <DialogDescription>
            {release?.guestName} · {release?.title}. For records signed outside DocuSeal only. Once archived, this record and its PDF cannot be edited or replaced.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="rel-pdf" className="text-xs">Fully signed PDF (max 20 MB) *</Label>
            <Input id="rel-pdf" type="file" accept="application/pdf,.pdf" data-testid="input-release-pdf"
              onChange={e => pick(e.target.files?.[0] ?? null)} />
            {file && <div className="text-[11px] font-mono text-muted-foreground">{file.name} · {(file.size / 1048576).toFixed(2)} MB</div>}
          </div>
          <label className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3 cursor-pointer">
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" data-testid="checkbox-confirm-signatures" />
            <span className="text-xs leading-relaxed text-foreground/90">
              I confirm that <b>all required signatures</b> (guest and any countersignatures) are present on this PDF. Cue has not verified them.
            </span>
          </label>
          {error && <ErrorBox message={error} />}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { reset(); onClose(); }} disabled={archive.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={!file || !confirmed || archive.isPending} data-testid="button-confirm-archive">
            {archive.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Lock className="w-3.5 h-3.5 mr-1.5" />}
            Archive permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
