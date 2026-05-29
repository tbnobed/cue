import { useState } from "react";
import { useParams } from "wouter";
import {
  useGetPublicCrewInvite, useRespondCrewInvite, getGetPublicCrewInviteQueryKey,
} from "@workspace/api-client-react";
import type { PublicCrewInvite } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import {
  AlertTriangle, CalendarDays, Clock, MapPin, CheckCircle2, XCircle, Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

function fmtDate(iso: string): string {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
  } catch {
    return iso;
  }
}

/**
 * Public, no-login crew availability reply page, loaded at `/crew/:token`.
 * The invitee opens the tokenized link from their email and clicks
 * Available / Not available. No account, no session.
 */
export default function CrewRespond() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useGetPublicCrewInvite(token ?? "", {
    query: { enabled: !!token, retry: false, queryKey: getGetPublicCrewInviteQueryKey(token ?? "") },
  });

  return (
    <div className="dark min-h-screen w-full bg-background text-foreground flex flex-col">
      <header className="border-b border-border/60 px-6 py-3 flex items-center gap-2 sticky top-0 z-10 backdrop-blur bg-background/80">
        <div className="w-7 h-7 rounded-md bg-primary/15 ring-1 ring-primary/30 flex items-center justify-center">
          <span className="text-primary font-bold text-sm leading-none">C</span>
        </div>
        <span className="font-bricolage text-base font-semibold tracking-tight">Cue</span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground ml-2 flex items-center gap-1">
          <Lock className="w-3 h-3" /> Availability request
        </span>
      </header>

      <main className="flex-1 w-full px-6 py-10 flex items-start justify-center">
        <div className="w-full max-w-lg">
          {isLoading && (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 rounded-full border-2 border-border border-t-primary animate-spin" />
            </div>
          )}

          {isError && (
            <div className="surface-card ring-hairline rounded-2xl p-10 text-center space-y-3">
              <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
              <h1 className="text-xl font-semibold">Link unavailable</h1>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                This availability link is invalid or has expired. Ask the producer who sent it for a new one.
              </p>
            </div>
          )}

          {data && <Reply token={token ?? ""} invite={data} />}
        </div>
      </main>
    </div>
  );
}

function Reply({ token, invite }: { token: string; invite: PublicCrewInvite }) {
  const respond = useRespondCrewInvite();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"available" | "unavailable" | null>(null);
  const [result, setResult] = useState<"available" | "unavailable" | null>(
    invite.status === "available" || invite.status === "confirmed"
      ? "available"
      : invite.status === "unavailable"
        ? "unavailable"
        : null,
  );
  const [error, setError] = useState<string | null>(null);

  const rateKind = invite.rateType === "half" ? "half day" : "full day";
  const rateStr = invite.dayRate != null
    ? `$${invite.dayRate.toLocaleString()} (${rateKind})`
    : rateKind;

  async function submit(answer: "available" | "unavailable") {
    setPending(answer);
    setError(null);
    try {
      const updated = await respond.mutateAsync({ token, data: { answer, note: note.trim() || undefined } });
      setResult(updated.status === "available" ? "available" : updated.status === "unavailable" ? "unavailable" : answer);
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong. Please try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="surface-card ring-hairline border border-border/70 rounded-2xl p-6 space-y-4">
        <div className="space-y-1">
          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">You're requested for</div>
          <h1 className="text-2xl font-semibold tracking-tight">{invite.title?.trim() || invite.projectName}</h1>
          {invite.title?.trim() && (
            <div className="text-sm text-muted-foreground">{invite.projectName}</div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 text-sm border-t border-border/50 pt-4">
          <Row icon={<CalendarDays className="w-4 h-4" />} label="Date" value={fmtDate(invite.date)} />
          {invite.callTime && <Row icon={<Clock className="w-4 h-4" />} label="Call" value={invite.callTime} />}
          {invite.wrapTime && <Row icon={<Clock className="w-4 h-4" />} label="Wrap" value={invite.wrapTime} />}
          {invite.location && <Row icon={<MapPin className="w-4 h-4" />} label="Location" value={invite.location} />}
        </div>

        <div className="border-t border-border/50 pt-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Position</div>
            <div className="text-base font-medium">{invite.position}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Rate</div>
            <div className="text-base font-medium tabular-nums">{rateStr}</div>
          </div>
        </div>
      </div>

      {result ? (
        <div className={`surface-card ring-hairline border rounded-2xl p-6 text-center space-y-2 ${
          result === "available" ? "border-emerald-500/40" : "border-red-500/40"
        }`}>
          {result === "available" ? (
            <CheckCircle2 className="w-9 h-9 text-emerald-400 mx-auto" />
          ) : (
            <XCircle className="w-9 h-9 text-red-400 mx-auto" />
          )}
          <h2 className="text-lg font-semibold">
            {result === "available" ? "You're marked available" : "Thanks for letting us know"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {result === "available"
              ? "The producer has been notified. They'll confirm your booking shortly."
              : "We've recorded that you're not available for this date."}
          </p>
          <button
            type="button"
            onClick={() => setResult(null)}
            className="text-xs text-primary hover:underline pt-1"
          >
            Change my response
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Add a note (optional)</Label>
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything the producer should know — conflicts, timing, rate, etc."
              data-testid="input-crew-note"
            />
          </div>

          {error && <div className="text-sm text-red-400">{error}</div>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button
              type="button"
              size="lg"
              className="bg-emerald-500 hover:bg-emerald-500/90 text-white h-12"
              onClick={() => submit("available")}
              disabled={pending !== null}
              data-testid="button-available"
            >
              <CheckCircle2 className="w-5 h-5 mr-2" />
              {pending === "available" ? "Sending…" : "I'm available"}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300 h-12"
              onClick={() => submit("unavailable")}
              disabled={pending !== null}
              data-testid="button-unavailable"
            >
              <XCircle className="w-5 h-5 mr-2" />
              {pending === "unavailable" ? "Sending…" : "Not available"}
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground/70">{icon}</span>
      <span className="w-20 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      <span className="flex-1 font-medium">{value}</span>
    </div>
  );
}
