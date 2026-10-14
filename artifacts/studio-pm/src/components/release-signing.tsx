import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSigningConfig, getGetSigningConfigQueryKey,
  useListReleaseTemplates, getListReleaseTemplatesQueryKey,
  useApproveReleaseTemplate, useRetireReleaseTemplate,
  useGetReleaseSigning, getGetReleaseSigningQueryKey,
  useSendReleaseSigning, useRefreshReleaseSigning, useRemindReleaseSigning, useReconcileReleaseSigning, useResendReleaseSigning,
  getListProjectReleasesQueryKey,
  type ReleaseRecord, type ReleaseSigning, type ReleaseTemplate,
} from "@workspace/api-client-react";
import {
  PenLine, Send, RefreshCw, BellRing, Loader2, Lock, Download, FileSignature, Trash2, CheckCircle2, Server, Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { ErrorBox, errMsg, fmtDate } from "@/components/releases-wrike-panel";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DT = "MMM d, yyyy · h:mm a";

export const SIGNING_META: Record<string, { label: string; tone: string }> = {
  not_sent:            { label: "Not sent",           tone: "text-muted-foreground bg-muted/40 ring-border/60" },
  sending:             { label: "Sending",            tone: "text-sky-300 bg-sky-500/10 ring-sky-500/25" },
  needs_review:        { label: "Needs review",       tone: "text-red-300 bg-red-500/10 ring-red-500/25" },
  awaiting_signatures: { label: "Out for signature",  tone: "text-amber-300 bg-amber-500/10 ring-amber-500/25" },
  declined:            { label: "Declined",           tone: "text-red-300 bg-red-500/10 ring-red-500/25" },
  expired:             { label: "Expired",            tone: "text-red-300 bg-red-500/10 ring-red-500/25" },
  filing_failed:       { label: "Filing failed",      tone: "text-red-300 bg-red-500/10 ring-red-500/25" },
  archived:            { label: "Signed & filed",     tone: "text-primary bg-primary/10 ring-primary/30" },
};

export function SigningChip({ state, testId }: { state: string; testId?: string }) {
  const m = SIGNING_META[state] ?? SIGNING_META.not_sent;
  return (
    <span data-testid={testId ?? `status-signing-${state}`}
      className={`inline-flex items-center gap-1 text-[9.5px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 rounded ring-1 ring-inset whitespace-nowrap ${m.tone}`}>
      <FileSignature className="w-2.5 h-2.5" />{m.label}
    </span>
  );
}

/** Per-release signing state; polls on the list cadence (15s) or faster while the dialog is open. */
export function useReleaseSigningState(releaseId: number, intervalMs = 15_000) {
  return useGetReleaseSigning(releaseId, {
    query: { queryKey: getGetReleaseSigningQueryKey(releaseId), enabled: !!releaseId, refetchInterval: intervalMs },
  });
}

export function isDocuSealManaged(s: ReleaseSigning | undefined) {
  return !!s && s.state !== "not_sent";
}

/** Approved template selector used by the release creation form. */
export function ApprovedTemplatePicker({ value, onPick }: { value: string; onPick: (t: ReleaseTemplate) => void }) {
  const tq = useListReleaseTemplates({ query: { queryKey: getListReleaseTemplatesQueryKey() } });
  const list = tq.data ?? [];
  if (tq.isLoading) return <Skeleton className="h-9 w-full" />;
  if (tq.isError) return <div className="text-[11px] text-red-300" role="alert">Couldn't load approved templates: {errMsg(tq.error)}</div>;
  if (list.length === 0) return <div className="text-[11px] font-mono text-muted-foreground" data-testid="text-no-approved-templates">No approved DocuSeal templates yet. An admin approves them under Admin · Integrations.</div>;
  const selected = list.find(t => t.version === value);
  return (
    <Select value={selected ? String(selected.id) : ""} onValueChange={v => { const t = list.find(x => String(x.id) === v); if (t) onPick(t); }}>
      <SelectTrigger data-testid="select-release-approved-template"><SelectValue placeholder="Pick an approved template (optional)" /></SelectTrigger>
      <SelectContent>
        {list.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name} · {t.version}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ─── SIGNING DIALOG ─────────────────────────────────────────────────────────

type Extra = { name: string; email: string };

export function SigningDialog({ release, canManage, onClose }: { release: ReleaseRecord | null; canManage: boolean; onClose: () => void }) {
  return (
    <Dialog open={!!release} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[600px] max-h-[90dvh] overflow-y-auto">
        {release && <SigningBody release={release} canManage={canManage} />}
      </DialogContent>
    </Dialog>
  );
}

function SigningBody({ release, canManage }: { release: ReleaseRecord; canManage: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const sq = useReleaseSigningState(release.id, 10_000);
  const cfg = useGetSigningConfig({ query: { queryKey: getGetSigningConfigQueryKey() } });
  const tq = useListReleaseTemplates({ query: { queryKey: getListReleaseTemplatesQueryKey(), enabled: canManage } });

  const s = sq.data;
  const prevState = s?.state;
  useEffect(() => {
    // keep list in sync with background state changes (e.g. auto-archive)
    setError(null);
    void qc.invalidateQueries({ queryKey: getListProjectReleasesQueryKey(release.projectId) });
  }, [prevState, qc, release.projectId]);

  const onSettled = () => {
    void qc.invalidateQueries({ queryKey: getGetReleaseSigningQueryKey(release.id) });
    void qc.invalidateQueries({ queryKey: getListProjectReleasesQueryKey(release.projectId) });
  };
  const send = useSendReleaseSigning({ mutation: { onSettled } });
  const refresh = useRefreshReleaseSigning({ mutation: { onSettled } });
  const remind = useRemindReleaseSigning({ mutation: { onSettled } });
  const resend = useResendReleaseSigning({ mutation: { onSettled } });
  const auth = useAuth();
  const isAdmin = auth.status === "authenticated" && auth.user.isAdmin;
  const reconcile = useReconcileReleaseSigning({ mutation: { onSettled } });

  const [templateId, setTemplateId] = useState<string>("");
  const [extras, setExtras] = useState<Record<string, Extra>>({});
  const [submissionId, setSubmissionId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const templates = tq.data ?? [];
  const tpl = templates.find(t => String(t.id) === templateId);
  const otherRoles = useMemo(() => (tpl ? tpl.roles.filter(r => r !== tpl.guestRole) : []), [tpl]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setError(null);
    try {
      const result = await fn() as ReleaseSigning;
      // Provider errors are already rendered from the polled signing record.
      if (result.lastError) return;
      toast({ title: label });
    } catch (err) { setError(errMsg(err)); }
  }

  function doSend() {
    if (!tpl) { setError("Pick an approved template."); return; }
    const signers = otherRoles.map(role => ({ role, name: (extras[role]?.name ?? "").trim(), email: (extras[role]?.email ?? "").trim() }));
    const missing = signers.find(x => !x.name || !x.email);
    if (missing) { setError(`Name and email are required for the ${missing.role} role.`); return; }
    void run("Sent for signature", () => send.mutateAsync({ id: release.id, data: { templateId: tpl.id, signers } }));
  }

  const anyBusy = send.isPending || refresh.isPending || remind.isPending || resend.isPending || reconcile.isPending;
  const state = s?.state ?? "not_sent";
  const isDraft = release.status === "draft";

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><PenLine className="w-4 h-4 text-primary" /> DocuSeal signing</DialogTitle>
        <DialogDescription>{release.guestName} · {release.title}. Status updates every 10 seconds while this is open.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 py-3">
        {sq.isLoading ? <Skeleton className="h-24 w-full" />
          : sq.isError ? <ErrorBox message={`Couldn't load signing status: ${errMsg(sq.error)}`} onRetry={() => sq.refetch()} />
          : s ? (
            <div className="rounded-xl border border-border/60 bg-white/[0.015] p-3.5 space-y-3" data-testid="panel-signing-status">
              <div className="flex items-center gap-2 flex-wrap">
                <SigningChip state={state} testId="status-signing-dialog" />
                {s.submissionId != null && <span className="text-[10.5px] font-mono text-muted-foreground" data-testid="text-signing-submission">submission #{s.submissionId}</span>}
                {s.updatedAt && <span className="ml-auto text-[10.5px] font-mono text-muted-foreground">updated {fmtDate(s.updatedAt, DT)}</span>}
              </div>
              {s.signers.length > 0 && (
                <ul className="divide-y divide-border/40 rounded-lg ring-1 ring-border/50 overflow-hidden">
                  {s.signers.map((p, i) => (
                    <li key={`${p.role}-${i}`} className="px-3 py-2 text-[12px] flex items-center gap-3 flex-wrap" data-testid={`row-signer-${i}`}>
                      <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground w-20 shrink-0 truncate">{p.role}</span>
                      <span className="font-medium">{p.name}</span>
                      <span className="font-mono text-[10.5px] text-muted-foreground truncate">{p.email}</span>
                      <span className="ml-auto text-[10px] font-mono uppercase tracking-[0.1em] text-foreground/80">{p.status ?? "pending"}</span>
                    </li>
                  ))}
                </ul>
              )}
              {(s.reminderCount ?? 0) > 0 && (
                <div className="text-[10.5px] font-mono text-muted-foreground">{s.reminderCount} reminder{s.reminderCount === 1 ? "" : "s"} · last {fmtDate(s.lastReminderAt, DT)}</div>
              )}
              {s.lastError && <ErrorBox message={s.lastError} />}
              {state === "archived" && (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] text-primary/90 inline-flex items-center gap-1.5"><Lock className="w-3 h-3" /> Signed PDF filed and sealed.</span>
                  <Button asChild size="sm" variant="outline" className="h-7 gap-1.5 text-xs">
                    <a href={`${BASE}/api/releases/${release.id}/file`} target="_blank" rel="noreferrer" data-testid="link-signing-download"><Download className="w-3 h-3" /> Signed PDF</a>
                  </Button>
                </div>
              )}
            </div>
          ) : null}

        {cfg.isError && <ErrorBox message={`Couldn't load DocuSeal configuration: ${errMsg(cfg.error)}`} onRetry={() => cfg.refetch()} />}
        {cfg.data && !cfg.data.configured && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3 text-xs text-amber-200" data-testid="text-signing-unconfigured">
            DocuSeal is not configured on this server. An admin sets it up under Admin · Integrations.
          </div>
        )}

        {!canManage ? (
          <div className="text-[11px] font-mono text-muted-foreground inline-flex items-center gap-1.5" data-testid="text-signing-readonly"><Lock className="w-3 h-3" /> Read-only · the project owner or an admin sends and manages signing.</div>
        ) : s && state === "not_sent" ? (
          !isDraft ? (
            <div className="text-xs text-muted-foreground" data-testid="text-signing-not-draft">Only draft releases can be sent through DocuSeal. This record uses the legacy manual workflow.</div>
          ) : cfg.data?.configured ? (
            <div className="space-y-3" data-testid="form-send-signing">
              <div className="grid gap-1.5">
                <Label className="text-xs">Approved template *</Label>
                {tq.isLoading ? <Skeleton className="h-9 w-full" />
                  : tq.isError ? <ErrorBox message={`Couldn't load templates: ${errMsg(tq.error)}`} onRetry={() => tq.refetch()} />
                  : templates.length === 0 ? <div className="text-[11px] font-mono text-muted-foreground">No approved templates. An admin approves one under Admin · Integrations.</div>
                  : (
                    <Select value={templateId} onValueChange={v => { setTemplateId(v); setExtras({}); }}>
                      <SelectTrigger data-testid="select-signing-template"><SelectValue placeholder="Choose template" /></SelectTrigger>
                      <SelectContent>{templates.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name} · {t.version}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                {tpl && <p className="text-[11px] text-muted-foreground">The release will record version <b>{tpl.version}</b> on send. The {tpl.guestRole} role is filled from this release ({release.guestName}, {release.guestEmail}).</p>}
              </div>
              {otherRoles.map(role => (
                <div key={role} className="grid sm:grid-cols-2 gap-3 rounded-lg ring-1 ring-border/50 p-3">
                  <div className="sm:col-span-2 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">{role}</div>
                  <Input placeholder="Name" maxLength={200} value={extras[role]?.name ?? ""} data-testid={`input-signer-name-${role}`}
                    onChange={e => setExtras(x => ({ ...x, [role]: { name: e.target.value, email: x[role]?.email ?? "" } }))} />
                  <Input placeholder="Email" type="email" maxLength={254} value={extras[role]?.email ?? ""} data-testid={`input-signer-email-${role}`}
                    onChange={e => setExtras(x => ({ ...x, [role]: { name: x[role]?.name ?? "", email: e.target.value } }))} />
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground inline-flex items-start gap-1.5"><Smartphone className="w-3 h-3 mt-0.5 shrink-0" /> Each signer receives an emailed link that works on a phone. Guests need no Cue account.</p>
            </div>
          ) : null
        ) : canManage && state === "needs_review" ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/[0.05] p-3 space-y-2" data-testid="form-reconcile">
            <div className="text-xs text-foreground/90">Cue could not confirm whether DocuSeal created this submission. To avoid duplicate requests, it will not resend. Check DocuSeal: if the submission exists, enter its ID to link it. If none exists, have an administrator verify that before creating a replacement draft release.</div>
            <div className="flex gap-2">
              <Input inputMode="numeric" placeholder="DocuSeal submission ID" value={submissionId} onChange={e => setSubmissionId(e.target.value.replace(/\D/g, ""))} data-testid="input-reconcile-submission" />
              <Button size="sm" className="h-9" disabled={!submissionId || anyBusy} data-testid="button-reconcile"
                onClick={() => run("Submission linked", () => reconcile.mutateAsync({ id: release.id, data: { submissionId: Number(submissionId) } }))}>
                {reconcile.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}Link
              </Button>
            </div>
          </div>
        ) : null}

        {error && <ErrorBox message={error} />}
      </div>

      {canManage && (
        <DialogFooter className="gap-2 flex-wrap">
          {s && state !== "not_sent" && state !== "archived" && (
            <Button variant="outline" size="sm" disabled={anyBusy} data-testid="button-signing-refresh"
              onClick={() => run("Status rechecked", () => refresh.mutateAsync({ id: release.id }))}>
              {refresh.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
              {state === "filing_failed" ? "Retry filing" : "Recheck"}
            </Button>
          )}
          {state === "awaiting_signatures" && (
            <Button variant="outline" size="sm" disabled={anyBusy} data-testid="button-signing-remind"
              onClick={() => run("Reminder sent", () => remind.mutateAsync({ id: release.id }))}>
              {remind.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <BellRing className="w-3.5 h-3.5 mr-1.5" />}Remind
            </Button>
          )}
          {isAdmin && state === "awaiting_signatures" && (
            <Button variant="outline" size="sm" disabled={anyBusy} data-testid="button-signing-resend"
              title="Admin recovery: bypass the one-hour reminder wait"
              onClick={() => {
                if (window.confirm("Resend signing emails now to outstanding signers? This bypasses the one-hour wait. Anyone who already received an invitation may receive another email. No new release is created.")) {
                  void run("Resend requested — inbox delivery is not confirmed", () => resend.mutateAsync({ id: release.id }));
                }
              }}>
              {resend.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
              Resend now
            </Button>
          )}
          {s && state === "not_sent" && isDraft && cfg.data?.configured && (
            <Button size="sm" disabled={!tpl || anyBusy} onClick={doSend} data-testid="button-signing-send">
              {send.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}Send for signature
            </Button>
          )}
        </DialogFooter>
      )}
    </>
  );
}

// ─── ADMIN SECTION ──────────────────────────────────────────────────────────

const FIELDS = ["GuestName", "GuestEmail", "ProjectName", "ReleaseTitle", "ProductionDate"];

export function DocuSealAdminSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const cfg = useGetSigningConfig({ query: { queryKey: getGetSigningConfigQueryKey() } });
  const tq = useListReleaseTemplates({ query: { queryKey: getListReleaseTemplatesQueryKey() } });
  const invalidate = () => qc.invalidateQueries({ queryKey: getListReleaseTemplatesQueryKey() });
  const approve = useApproveReleaseTemplate({ mutation: { onSettled: invalidate } });
  const retire = useRetireReleaseTemplate({ mutation: { onSettled: invalidate } });

  const [remoteId, setRemoteId] = useState("");
  const [version, setVersion] = useState("");
  const [guestRole, setGuestRole] = useState("Guest");
  const [error, setError] = useState<string | null>(null);
  const [retireErr, setRetireErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!remoteId || !version.trim() || !guestRole.trim()) { setError("Template ID, version and guest role are required."); return; }
    try {
      const t = await approve.mutateAsync({ data: { remoteId: Number(remoteId), version: version.trim(), guestRole: guestRole.trim() } });
      toast({ title: "Template approved", description: `${t.name} · ${t.version}` });
      setRemoteId(""); setVersion("");
    } catch (err) { setError(errMsg(err)); }
  }

  const c = cfg.data;
  const list = tq.data ?? [];

  return (
    <section className="surface-card ring-hairline border border-border/70 rounded-2xl overflow-hidden" data-testid="card-docuseal">
      <div className="px-5 pt-4 pb-3 border-b border-border/50 flex items-center gap-2 flex-wrap">
        <FileSignature className="w-4 h-4 text-primary" /><h2 className="text-[14px] font-semibold tracking-tight">DocuSeal release signing</h2>
        {c && <span className={`text-[9.5px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 rounded ring-1 ring-inset ${c.configured ? "text-emerald-300 bg-emerald-500/10 ring-emerald-500/25" : "text-amber-300 bg-amber-500/10 ring-amber-500/25"}`} data-testid="status-docuseal-configured">{c.configured ? "Configured" : "Not configured"}</span>}
        {c?.publicUrl && <code className="ml-auto text-[10.5px] font-mono text-muted-foreground break-all" data-testid="text-docuseal-public-url">{c.publicUrl}</code>}
      </div>
      <div className="p-5 space-y-5">
        {cfg.isLoading ? <Skeleton className="h-5 w-1/2" /> : cfg.isError ? <ErrorBox message={`Couldn't load DocuSeal config: ${errMsg(cfg.error)}`} onRetry={() => cfg.refetch()} /> : null}

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground"><Server className="w-3 h-3" /> Self-hosted setup</div>
          <p className="text-[12.5px] text-muted-foreground leading-relaxed">Run DocuSeal alongside Cue on your Docker host. Add these to the Cue server environment and restart the container. The API key stays on the server and is never shown in the browser.</p>
          <ul className="text-[12px] font-mono space-y-1 text-foreground/85">
            <li><code>DOCUSEAL_API_URL=http://docuseal:3000</code> <span className="text-muted-foreground">· internal Docker address</span></li>
            <li><code>DOCUSEAL_PUBLIC_URL</code> <span className="text-muted-foreground">· the public HTTPS origin where signers reach your DocuSeal</span></li>
            <li><code>DOCUSEAL_API_KEY</code> <span className="text-muted-foreground">· from DocuSeal settings, API</span></li>
          </ul>
          <p className="text-[12.5px] text-muted-foreground leading-relaxed">Configure SMTP inside DocuSeal so it can email signing links. Guests sign from that link on any phone, with no Cue account.</p>
        </div>

        <div className="space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Building a template in DocuSeal</div>
          <ol className="list-decimal pl-5 text-[12.5px] text-muted-foreground space-y-1 leading-relaxed">
            <li>Signature and signing date stay under the signer's control. Address, phone and unrecognized fields are left for the signer; Cue does not invent those values.</li>
            <li>Keep the existing fields in your approved PDF. Cue recognizes Print Name, Email, and Name of Program and fills them from the guest and project. These original Cue field names are also supported, but are not required:
              <span className="flex flex-wrap gap-1.5 pt-1">{FIELDS.map(f => <code key={f} className="text-[11px] font-mono px-2 py-0.5 rounded bg-muted/40 ring-1 ring-border/60 text-foreground/85">{f}</code>)}</span>
            </li>
            <li>Define roles, for example <code>Guest</code> plus any countersigner such as <code>Producer</code>. The guest role entered below must match the DocuSeal role name exactly.</li>
            <li>Approve it here. Approval captures the template as it is now; any later edit in DocuSeal needs a fresh approval.</li>
          </ol>
        </div>

        <form onSubmit={submit} className="grid sm:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end" data-testid="form-approve-template">
          <div className="grid gap-1.5"><Label htmlFor="ds-id" className="text-xs">DocuSeal template ID</Label>
            <Input id="ds-id" inputMode="numeric" value={remoteId} onChange={e => setRemoteId(e.target.value.replace(/\D/g, ""))} data-testid="input-template-remote-id" /></div>
          <div className="grid gap-1.5"><Label htmlFor="ds-ver" className="text-xs">Version label</Label>
            <Input id="ds-ver" maxLength={100} placeholder="e.g. GR v4" value={version} onChange={e => setVersion(e.target.value)} data-testid="input-template-version" /></div>
          <div className="grid gap-1.5"><Label htmlFor="ds-role" className="text-xs">Guest role (exact)</Label>
            <Input id="ds-role" maxLength={100} value={guestRole} onChange={e => setGuestRole(e.target.value)} data-testid="input-template-guest-role" /></div>
          <Button type="submit" className="h-9" disabled={approve.isPending || !c?.configured} data-testid="button-approve-template">
            {approve.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />}Fetch & approve
          </Button>
        </form>
        {error && <ErrorBox message={error} />}

        <div className="space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Approved templates</div>
          {tq.isLoading ? <Skeleton className="h-14 w-full" />
            : tq.isError ? <ErrorBox message={`Couldn't load templates: ${errMsg(tq.error)}`} onRetry={() => tq.refetch()} />
            : list.length === 0 ? <div className="text-[12px] font-mono text-muted-foreground py-3" data-testid="empty-templates">No templates approved yet.</div>
            : (
              <ul className="divide-y divide-border/40 rounded-lg ring-1 ring-border/50 overflow-hidden">
                {list.map(t => (
                  <li key={t.id} className="px-3 py-2.5 text-[12px] flex items-center gap-3 flex-wrap" data-testid={`row-template-${t.id}`}>
                    <span className="font-medium">{t.name}</span>
                    <span className="font-mono text-[10.5px] text-primary">{t.version}</span>
                    <span className="font-mono text-[10.5px] text-muted-foreground">DocuSeal #{t.remoteId}</span>
                    <span className="font-mono text-[10.5px] text-muted-foreground">roles: {t.roles.map(r => r === t.guestRole ? `${r} (guest)` : r).join(", ")}</span>
                    <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1.5 text-xs" disabled={retire.isPending} data-testid={`button-retire-template-${t.id}`}
                      onClick={async () => { setRetireErr(null); try { await retire.mutateAsync({ id: t.id }); toast({ title: "Template retired" }); } catch (err) { setRetireErr(errMsg(err)); } }}>
                      <Trash2 className="w-3 h-3" /> Retire
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          {retireErr && <ErrorBox message={retireErr} />}
        </div>
      </div>
    </section>
  );
}
