import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useGetSigningConfig, getGetSigningConfigQueryKey,
  useListReleaseTemplates, getListReleaseTemplatesQueryKey,
} from "@workspace/api-client-react";
import QRCode from "qrcode";
import { Link2, Plus, Copy, Mail, QrCode, Download, Ban, Loader2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ErrorBox, fmtDate } from "@/components/releases-wrike-panel";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DT = "MMM d, yyyy · h:mm a";

export type ReleaseLink = {
  signingMode: "email" | "immediate";
  id: number; title: string; templateId: number; productionDate: string | null;
  expiresAt: string; revokedAt: string | null; url: string; createdAt: string;
};
export type ReleaseLinkSigner = { role: string; name: string; email: string };
export type ReleaseLinkInput = {
  signingMode: "email" | "immediate";
  title: string; templateId: number; productionDate?: string | null; expiresAt?: string; signers: ReleaseLinkSigner[];
};

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = j.error; else if (j?.message) msg = j.message; } catch { /* no body */ }
    throw new HttpError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const linksKey = (projectId: number) => ["release-links", projectId] as const;

export function useReleaseLinks(projectId: number, enabled: boolean) {
  return useQuery({
    queryKey: linksKey(projectId),
    queryFn: async () => (await apiFetch<ReleaseLink[]>(`/api/projects/${projectId}/release-links`)).map(link => ({
      ...link,
      url: /^https?:\/\//.test(link.url) ? link.url : new URL(`${BASE}${link.url}`, window.location.origin).href,
    })),
    enabled: enabled && !!projectId,
    refetchInterval: 60_000,
  });
}

function linkState(l: ReleaseLink): "revoked" | "expired" | "active" {
  if (l.revokedAt) return "revoked";
  if (new Date(l.expiresAt).getTime() <= Date.now()) return "expired";
  return "active";
}

const STATE_TONE = {
  active: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/25",
  expired: "text-amber-300 bg-amber-500/10 ring-amber-500/25",
  revoked: "text-red-300 bg-red-500/10 ring-red-500/25",
};

function toDateInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Manager-only: production-wide self-registration links for guest releases. */
export function ReleaseShareLinks({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useReleaseLinks(projectId, true);
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [qrFor, setQrFor] = useState<ReleaseLink | null>(null);
  const [revoking, setRevoking] = useState<ReleaseLink | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const revoke = useMutation({
    mutationFn: (id: number) => apiFetch<void>(`/api/release-links/${id}`, { method: "DELETE" }),
    onSettled: () => qc.invalidateQueries({ queryKey: linksKey(projectId) }),
  });

  const links = q.data ?? [];
  const active = links.filter(l => linkState(l) === "active");
  const shown = showInactive ? links : active;

  async function copy(l: ReleaseLink) {
    try { await navigator.clipboard.writeText(l.url); toast({ title: "Link copied" }); }
    catch { toast({ title: "Couldn't copy", description: l.url, variant: "destructive" }); }
  }
  function mail(l: ReleaseLink) {
    const subject = encodeURIComponent(`Appearance release: ${l.title}`);
    const body = encodeURIComponent(
      `Hi,\n\nPlease register for your appearance release using the link below. ${l.signingMode === "immediate" ? "Enter your details, then review and sign immediately." : "You'll receive a personal signing link by email."}\n\n${l.url}\n\nThis link expires ${fmtDate(l.expiresAt, DT)}.\n`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  return (
    <>
      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setOpen(true)} data-testid="button-release-links">
        <Link2 className="w-3.5 h-3.5" /> Share links{q.data ? <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{active.length}</span> : null}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[640px] max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Link2 className="w-4 h-4 text-primary" /> Production release links</DialogTitle>
            <DialogDescription>
              One link for the whole production. Choose immediate signing or an emailed signing link. Completed releases are filed here automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="text-[11px] font-mono text-muted-foreground inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" data-testid="checkbox-show-inactive-links" />
                Show expired and revoked
              </label>
              <Button size="sm" className="h-8 gap-1.5" onClick={() => setCreateOpen(true)} data-testid="button-new-release-link">
                <Plus className="w-3.5 h-3.5" /> New link
              </Button>
            </div>
            {q.isLoading ? (
              <div className="space-y-2">{[0, 1].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
            ) : q.isError ? (
              <ErrorBox message={`Couldn't load links: ${(q.error as Error).message}`} onRetry={() => q.refetch()} />
            ) : shown.length === 0 ? (
              <div className="text-center py-8 space-y-2 rounded-xl border border-dashed border-border/60" data-testid="empty-release-links">
                <Link2 className="w-6 h-6 mx-auto text-muted-foreground/60" />
                <div className="text-sm font-medium">{links.length ? "No active links" : "No share links yet"}</div>
                <div className="text-xs text-muted-foreground max-w-xs mx-auto">Create a link, then text it, email it, or print the QR code for the set.</div>
              </div>
            ) : (
              <ul className="space-y-2">
                {shown.map(l => {
                  const st = linkState(l);
                  const soon = st === "active" && new Date(l.expiresAt).getTime() - Date.now() < 3 * 86400_000;
                  return (
                    <li key={l.id} className="rounded-xl border border-border/60 bg-white/[0.015] p-3.5 space-y-2" data-testid={`row-release-link-${l.id}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold truncate">{l.title}</span>
                        <span className={`text-[9.5px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 rounded ring-1 ring-inset ${STATE_TONE[st]}`} data-testid={`status-release-link-${l.id}`}>{st}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] font-mono text-muted-foreground tabular-nums">
                        <span>shoot {fmtDate(l.productionDate)}</span>
                        <span>{l.signingMode === "immediate" ? "Sign immediately" : "Email signing link"}</span>
                        <span className={`inline-flex items-center gap-1 ${soon ? "text-amber-300" : ""}`}><Clock className="w-3 h-3" />
                          {st === "revoked" ? `revoked ${fmtDate(l.revokedAt, DT)}` : `${st === "expired" ? "expired" : "expires"} ${fmtDate(l.expiresAt, DT)}`}
                        </span>
                        <span>created {fmtDate(l.createdAt)}</span>
                      </div>
                      {st === "active" && (
                        <>
                          <code className="block text-[10.5px] font-mono text-foreground/80 break-all select-all rounded bg-muted/30 ring-1 ring-border/50 px-2 py-1" data-testid={`text-release-link-url-${l.id}`}>{l.url}</code>
                          <div className="flex flex-wrap gap-1.5">
                            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => copy(l)} data-testid={`button-copy-link-${l.id}`}><Copy className="w-3 h-3" /> Copy</Button>
                            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => mail(l)} data-testid={`button-mail-link-${l.id}`}><Mail className="w-3 h-3" /> Email</Button>
                            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setQrFor(l)} data-testid={`button-qr-link-${l.id}`}><QrCode className="w-3 h-3" /> QR</Button>
                            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs text-red-300 ml-auto" onClick={() => setRevoking(l)} data-testid={`button-revoke-link-${l.id}`}><Ban className="w-3 h-3" /> Revoke</Button>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <CreateLinkDialog projectId={projectId} open={createOpen} onClose={() => setCreateOpen(false)} />
      <QrDialog link={qrFor} onClose={() => setQrFor(null)} />

      <Dialog open={!!revoking} onOpenChange={o => { if (!o && !revoke.isPending) { setRevoking(null); revoke.reset(); } }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Revoke link?</DialogTitle>
            <DialogDescription>{revoking?.title}. New guests can no longer register with this link. Signing requests already emailed are not affected.</DialogDescription>
          </DialogHeader>
          {revoke.isError && <ErrorBox message={(revoke.error as Error).message} />}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevoking(null)} disabled={revoke.isPending}>Cancel</Button>
            <Button variant="destructive" disabled={revoke.isPending} data-testid="button-confirm-revoke-link"
              onClick={async () => {
                if (!revoking) return;
                try { await revoke.mutateAsync(revoking.id); toast({ title: "Link revoked" }); setRevoking(null); } catch { /* shown */ }
              }}>
              {revoke.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateLinkDialog({ projectId, open, onClose }: { projectId: number; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const cfg = useGetSigningConfig({ query: { queryKey: getGetSigningConfigQueryKey(), enabled: open } });
  const tq = useListReleaseTemplates({ query: { queryKey: getListReleaseTemplatesQueryKey(), enabled: open } });
  const [title, setTitle] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [signingMode, setSigningMode] = useState<"email" | "immediate">("email");
  const [productionDate, setProductionDate] = useState("");
  const [expires, setExpires] = useState("");
  const [signers, setSigners] = useState<Record<string, { name: string; email: string }>>({});
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (data: ReleaseLinkInput) => apiFetch<ReleaseLink>(`/api/projects/${projectId}/release-links`, { method: "POST", body: JSON.stringify(data) }),
    onSettled: () => qc.invalidateQueries({ queryKey: linksKey(projectId) }),
  });

  useEffect(() => {
    if (open) { setTitle(""); setTemplateId(""); setSigningMode("email"); setProductionDate(""); setExpires(""); setSigners({}); setError(null); create.reset(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const templates = tq.data ?? [];
  const tpl = templates.find(t => String(t.id) === templateId);
  const otherRoles = useMemo(() => (tpl ? tpl.roles.filter(r => r !== tpl.guestRole) : []), [tpl]);
  const today = toDateInput(new Date());
  const configured = cfg.data?.configured;

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!title.trim()) { setError("Title is required."); return; }
    if (!tpl) { setError("Pick an approved template."); return; }
    const list = otherRoles.map(role => ({ role, name: (signers[role]?.name ?? "").trim(), email: (signers[role]?.email ?? "").trim() }));
    const missing = list.find(s => !s.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email));
    if (missing) { setError(`A name and valid email are required for the ${missing.role} role.`); return; }
    let expiresAt: string | undefined;
    if (expires) {
      const d = new Date(expires + "T23:59:59");
      if (d.getTime() <= Date.now()) { setError("Expiry must be in the future."); return; }
      expiresAt = d.toISOString();
    }
    try {
      await create.mutateAsync({ title: title.trim(), templateId: tpl.id, signingMode, productionDate: productionDate || null, ...(expiresAt ? { expiresAt } : {}), signers: list });
      toast({ title: "Share link created" });
      onClose();
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !create.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-[560px] max-h-[90dvh] overflow-y-auto">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New production release link</DialogTitle>
            <DialogDescription>Enter countersigners once. Every guest who registers gets their own DocuSeal request with these signers attached.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {cfg.isError && <ErrorBox message={`Couldn't load DocuSeal configuration: ${(cfg.error as Error).message}`} onRetry={() => cfg.refetch()} />}
            {cfg.data && !configured && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3 text-xs text-amber-200" data-testid="text-links-unconfigured">
                Setup needed: DocuSeal is not configured on this server. An admin sets it up under Admin · Integrations.
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="rl-title" className="text-xs">Title *</Label>
              <Input id="rl-title" maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Season 2 audience release" data-testid="input-link-title" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Approved template *</Label>
              {tq.isLoading ? <Skeleton className="h-9 w-full" />
                : tq.isError ? <ErrorBox message={`Couldn't load templates: ${(tq.error as Error).message}`} onRetry={() => tq.refetch()} />
                : templates.length === 0 ? <div className="text-[11px] font-mono text-muted-foreground" data-testid="text-link-no-templates">Setup needed: no approved templates. An admin approves one under Admin · Integrations.</div>
                : (
                  <Select value={templateId} onValueChange={v => { setTemplateId(v); setSigners({}); }}>
                    <SelectTrigger data-testid="select-link-template"><SelectValue placeholder="Choose template" /></SelectTrigger>
                    <SelectContent>{templates.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name} · {t.version}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              {tpl && <p className="text-[11px] text-muted-foreground">The {tpl.guestRole} role is filled by each guest who registers.{otherRoles.length === 0 ? " No other signers needed." : ""}</p>}
            </div>
            <fieldset className="grid gap-2 rounded-lg border border-border p-3">
              <legend className="text-xs px-1">How should guests sign?</legend>
              <label className="flex gap-2 items-start text-sm">
                <input type="radio" name="signing-mode" value="email" checked={signingMode === "email"}
                  onChange={() => setSigningMode("email")} data-testid="mode-email" className="mt-1" />
                <span>Email signing link<span className="block text-xs text-muted-foreground">Guests must open their inbox to access the signing form.</span></span>
              </label>
              <label className="flex gap-2 items-start text-sm">
                <input type="radio" name="signing-mode" value="immediate" checked={signingMode === "immediate"}
                  onChange={() => setSigningMode("immediate")} data-testid="mode-immediate" className="mt-1" />
                <span>Sign immediately<span className="block text-xs text-muted-foreground">Open the form after name and email. Email ownership is not verified; an invitation is also emailed as a backup.</span></span>
              </label>
              <p className="text-xs text-muted-foreground">Both track signatures and archive completed releases. DocuSeal emails completed copies.</p>
            </fieldset>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="rl-date" className="text-xs">Production date</Label>
                <Input id="rl-date" type="date" value={productionDate} onChange={e => setProductionDate(e.target.value)} data-testid="input-link-date" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="rl-exp" className="text-xs">Expires (default 30 days)</Label>
                <Input id="rl-exp" type="date" min={today} value={expires} onChange={e => setExpires(e.target.value)} data-testid="input-link-expires" />
              </div>
            </div>
            {otherRoles.map(role => (
              <div key={role} className="grid sm:grid-cols-2 gap-3 rounded-lg ring-1 ring-border/50 p-3">
                <div className="sm:col-span-2 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">{role} *</div>
                <Input placeholder="Name" maxLength={200} value={signers[role]?.name ?? ""} data-testid={`input-link-signer-name-${role}`}
                  onChange={e => setSigners(x => ({ ...x, [role]: { name: e.target.value, email: x[role]?.email ?? "" } }))} />
                <Input placeholder="Email" type="email" maxLength={254} value={signers[role]?.email ?? ""} data-testid={`input-link-signer-email-${role}`}
                  onChange={e => setSigners(x => ({ ...x, [role]: { name: x[role]?.name ?? "", email: e.target.value } }))} />
              </div>
            ))}
            {error && <ErrorBox message={error} />}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !tpl || !configured} data-testid="button-create-link">
              {create.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}Create link
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function QrDialog({ link, onClose }: { link: ReleaseLink | null; onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const url = link?.url;
  useEffect(() => {
    setSrc(null); setErr(null);
    if (!url) return;
    let alive = true;
    QRCode.toDataURL(url, { width: 640, margin: 2, errorCorrectionLevel: "M" })
      .then(d => { if (alive) setSrc(d); })
      .catch(e => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
  }, [url]);
  const fileName = `release-link-${(link?.title ?? "qr").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "qr"}.png`;
  return (
    <Dialog open={!!link} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>QR code</DialogTitle>
          <DialogDescription>{link?.title}. Generated on this device; print it for the set.</DialogDescription>
        </DialogHeader>
        <div className="flex justify-center py-2">
          {err ? <ErrorBox message={err} /> : src
            ? <img src={src} alt={`QR code for ${link?.title}`} className="w-64 h-64 rounded-lg ring-1 ring-border/60" data-testid="img-release-link-qr" />
            : <Skeleton className="w-64 h-64 rounded-lg" />}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button asChild disabled={!src}>
            <a href={src ?? undefined} download={fileName} data-testid="link-download-qr"><Download className="w-3.5 h-3.5 mr-1.5" /> Download PNG</a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

