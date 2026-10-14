import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, FileSignature, Loader2, MailCheck, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, HttpError } from "@/components/release-share-links";

type PublicLink = {
  title: string; projectName: string; productionDate: string | null;
  templateName: string; templateVersion: string; expiresAt: string;
};

function fmt(d: string | null, withTime = false) {
  if (!d) return null;
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T00:00:00") : new Date(d);
  if (isNaN(dt.getTime())) return d;
  return withTime
    ? dt.toLocaleString(undefined, { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })
    : dt.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

export default function ReleaseSign() {
  const { token = "" } = useParams<{ token: string }>();
  const enc = encodeURIComponent(token);
  const q = useQuery({
    queryKey: ["public-release-link", token],
    queryFn: () => apiFetch<PublicLink>(`/api/public/release-links/${enc}`),
    enabled: !!token, retry: false,
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const reg = useMutation({
    mutationFn: (body: { name: string; email: string; consent: true }) =>
      apiFetch<{ message: string }>(`/api/public/release-links/${enc}/register`, { method: "POST", body: JSON.stringify(body) }),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault(); setFormErr(null);
    if (!name.trim()) { setFormErr("Enter your full name."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setFormErr("Enter a valid email address."); return; }
    if (!consent) { setFormErr("Tick the box so we can email your signing link."); return; }
    reg.mutate({ name: name.trim(), email: email.trim(), consent: true });
  }

  const status = q.error instanceof HttpError ? q.error.status : 0;
  const regErr = reg.error as HttpError | null;

  return (
    <div className="dark min-h-[100dvh] w-full bg-background text-foreground flex flex-col">
      <header className="border-b border-border/60 px-6 py-3 flex items-center gap-2 sticky top-0 z-10 backdrop-blur bg-background/80">
        <div className="w-7 h-7 rounded-md bg-primary/15 ring-1 ring-primary/30 flex items-center justify-center">
          <span className="text-primary font-bold text-sm leading-none">C</span>
        </div>
        <span className="text-sm font-semibold tracking-tight">Cue</span>
        <span className="ml-auto text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Appearance release</span>
      </header>
      <main className="flex-1 w-full max-w-md mx-auto px-5 py-10">
        {q.isLoading ? (
          <div className="space-y-3"><Skeleton className="h-8 w-3/4" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-48 w-full rounded-2xl" /></div>
        ) : q.isError ? (
          <div className="surface-card border border-border/70 rounded-2xl p-6 text-center space-y-3" data-testid="release-sign-error">
            <AlertTriangle className="w-7 h-7 mx-auto text-amber-300" />
            <h1 className="text-lg font-semibold">
              {status === 404 ? "This link isn't available" : status === 409 || status === 503 ? "Registration is paused" : "Something went wrong"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {status === 404 ? "It may have expired or been withdrawn. Ask the production for a new link."
                : status === 409 || status === 503 ? "The production needs to update this release. Please try again later or contact them."
                : (q.error as Error).message}
            </p>
            {status !== 404 && <Button variant="outline" size="sm" onClick={() => q.refetch()}>Try again</Button>}
          </div>
        ) : q.data && reg.isSuccess ? (
          <div className="surface-card border border-primary/30 rounded-2xl p-6 text-center space-y-3" data-testid="release-sign-success" role="status">
            <MailCheck className="w-8 h-8 mx-auto text-primary" />
            <h1 className="text-lg font-semibold">Check your inbox</h1>
            <p className="text-sm text-foreground/85">{reg.data?.message || "If everything checks out, you'll receive an email with your personal link to review and sign."}</p>
            <p className="text-xs text-muted-foreground">Nothing has been signed yet. Open the email to review the release before signing.</p>
          </div>
        ) : q.data ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="text-[10.5px] font-mono uppercase tracking-[0.14em] text-primary">{q.data.projectName}</div>
              <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-release-link-title">{q.data.title}</h1>
              <div className="flex flex-col gap-1 text-[12px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><FileSignature className="w-3.5 h-3.5" /> {q.data.templateName} · {q.data.templateVersion}</span>
                {q.data.productionDate && <span className="inline-flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" /> {fmt(q.data.productionDate)}</span>}
                <span className="inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Link open until {fmt(q.data.expiresAt, true)}</span>
              </div>
            </div>
            <form onSubmit={submit} className="surface-card border border-border/70 rounded-2xl p-5 space-y-4" data-testid="form-release-register">
              <p className="text-[13px] text-foreground/85 leading-relaxed">Enter your details. We'll email you a personal link to review and sign the release on your phone. No account needed.</p>
              <div className="grid gap-1.5">
                <Label htmlFor="rs-name" className="text-xs">Full name</Label>
                <Input id="rs-name" autoComplete="name" maxLength={200} value={name} onChange={e => setName(e.target.value)} data-testid="input-register-name" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="rs-email" className="text-xs">Email</Label>
                <Input id="rs-email" type="email" inputMode="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} data-testid="input-register-email" />
              </div>
              <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-white/[0.02] p-3 cursor-pointer">
                <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" data-testid="checkbox-register-consent" />
                <span className="text-xs leading-relaxed">Email me my personal signing link</span>
              </label>
              {(formErr || regErr) && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3 text-xs text-red-200 flex gap-2" role="alert">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-400" />{formErr || regErr?.message}
                </div>
              )}
              <Button type="submit" className="w-full h-10" disabled={reg.isPending || !consent} data-testid="button-register-submit">
                {reg.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Email my signing link
              </Button>
            </form>
          </div>
        ) : null}
      </main>
    </div>
  );
}
