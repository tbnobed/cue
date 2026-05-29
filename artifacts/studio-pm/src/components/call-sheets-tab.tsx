import { useEffect, useMemo, useState } from "react";
import {
  useListCallSheets, useCreateCallSheet, useGetCallSheet, useUpdateCallSheet,
  useDeleteCallSheet, useSendCallSheetInvites,
  useAddCrewInvite, useUpdateCrewInvite, useDeleteCrewInvite, useSendCrewInvite,
  useListMembers,
  getListCallSheetsQueryKey, getGetCallSheetQueryKey,
} from "@workspace/api-client-react";
import type { CallSheet, CrewInvite, Member } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { motion } from "framer-motion";
import {
  Plus, CalendarDays, Clock, MapPin, Send, Trash2, Loader2, Printer,
  UserPlus, Mail, X, CheckCircle2, XCircle, CircleDashed,
} from "lucide-react";
import { printCallSheet } from "@/lib/print-call-sheet";

export const TV_POSITIONS = [
  "Director", "Producer", "Technical Director", "Camera Operator", "Audio (A1)",
  "A2", "Lighting Director", "Gaffer", "Grip", "Switcher", "Graphics Op",
  "Teleprompter", "Stage Manager", "Floor Manager", "Makeup", "Wardrobe",
  "Production Assistant", "Editor", "Engineer", "Utility",
] as const;

const SHEET_STATUS_TONE: Record<string, string> = {
  draft: "text-muted-foreground bg-muted/40 ring-border/60",
  sent:  "text-blue-400 bg-blue-500/10 ring-blue-500/20",
  final: "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
};

const CREW_STATUS_TONE: Record<string, string> = {
  pending:     "text-muted-foreground bg-muted/40 ring-border/60",
  invited:     "text-blue-400 bg-blue-500/10 ring-blue-500/20",
  available:   "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
  unavailable: "text-red-400 bg-red-500/10 ring-red-500/20",
  confirmed:   "text-primary bg-primary/10 ring-primary/20",
};

const CREW_STATUS_ICON: Record<string, React.ReactNode> = {
  pending:     <CircleDashed className="w-3 h-3" />,
  invited:     <Mail className="w-3 h-3" />,
  available:   <CheckCircle2 className="w-3 h-3" />,
  unavailable: <XCircle className="w-3 h-3" />,
  confirmed:   <CheckCircle2 className="w-3 h-3" />,
};

function CrewStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 rounded-md ring-1 ring-inset ${CREW_STATUS_TONE[status] ?? CREW_STATUS_TONE.pending}`}>
      {CREW_STATUS_ICON[status]}
      {status}
    </span>
  );
}

// ─── TAB ROOT ────────────────────────────────────────────────────────────────

export function CallSheetsTab({ projectId, projectName }: { projectId: number; projectName: string }) {
  const { data: sheets, isLoading } = useListCallSheets(projectId, {
    query: { enabled: !!projectId, queryKey: getListCallSheetsQueryKey(projectId) },
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [openSheetId, setOpenSheetId] = useState<number | null>(null);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[11px] font-mono text-muted-foreground tabular-nums">
          {sheets ? `${sheets.length} ${sheets.length === 1 ? "call sheet" : "call sheets"}` : ""}
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-new-call-sheet">
          <Plus className="w-4 h-4 mr-2" />
          New call sheet
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
        </div>
      ) : sheets && sheets.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sheets.map((s, idx) => (
            <CallSheetCard key={s.id} sheet={s} idx={idx} onOpen={() => setOpenSheetId(s.id)} />
          ))}
        </div>
      ) : (
        <div className="surface-card ring-hairline border border-dashed border-border/70 rounded-2xl p-12 text-center text-sm text-muted-foreground font-mono space-y-4">
          <div>No call sheets yet. Create one per shoot day.</div>
          <Button variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New call sheet
          </Button>
        </div>
      )}

      <CreateCallSheetDialog
        projectId={projectId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => setOpenSheetId(id)}
      />

      {openSheetId != null && (
        <CallSheetEditorDialog
          sheetId={openSheetId}
          projectId={projectId}
          projectName={projectName}
          open={openSheetId != null}
          onOpenChange={(o) => { if (!o) setOpenSheetId(null); }}
        />
      )}
    </div>
  );
}

// ─── CARD ────────────────────────────────────────────────────────────────────

function CallSheetCard({ sheet, idx, onOpen }: { sheet: CallSheet; idx: number; onOpen: () => void }) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.03 }}
      onClick={onOpen}
      className="group text-left surface-card ring-hairline border border-border/70 rounded-2xl p-5 flex flex-col gap-3 transition-all hover:border-border hover:-translate-y-0.5 hover:shadow-lg"
      data-testid={`call-sheet-card-${sheet.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold tracking-tight truncate">
            {sheet.title?.trim() || format(new Date(sheet.date), "EEEE, MMM d, yyyy")}
          </div>
          <div className="text-[11px] text-muted-foreground font-mono flex items-center gap-1.5 mt-1 tabular-nums">
            <CalendarDays className="w-3 h-3" />
            {format(new Date(sheet.date), "MMM d, yyyy")}
            {sheet.callTime && <><span className="text-border">·</span><Clock className="w-3 h-3" />{sheet.callTime}</>}
          </div>
        </div>
        <span className={`text-[10px] font-mono uppercase tracking-[0.12em] px-2 py-1 rounded-md ring-1 ring-inset shrink-0 ${SHEET_STATUS_TONE[sheet.status] ?? SHEET_STATUS_TONE.draft}`}>
          {sheet.status}
        </span>
      </div>
      {sheet.location && (
        <div className="text-[11.5px] text-muted-foreground font-mono flex items-center gap-1.5 truncate">
          <MapPin className="w-3 h-3 shrink-0" />
          <span className="truncate">{sheet.location}</span>
        </div>
      )}
    </motion.button>
  );
}

// ─── CREATE DIALOG ───────────────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function CreateCallSheetDialog({ projectId, open, onOpenChange, onCreated }: {
  projectId: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: number) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateCallSheet();
  const [date, setDate] = useState(todayISO());
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (open) { setDate(todayISO()); setTitle(""); }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!date) return;
    try {
      const row = await create.mutateAsync({
        projectId,
        data: { date, title: title.trim() || undefined },
      });
      await qc.invalidateQueries({ queryKey: getListCallSheetsQueryKey(projectId) });
      onOpenChange(false);
      onCreated(row.id);
    } catch (err: any) {
      toast({ title: "Couldn't create call sheet", description: err?.message ?? "Unknown error", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New call sheet</DialogTitle>
          <DialogDescription>One call sheet per shoot day. You can fill in the rest after.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2" data-testid="form-call-sheet">
          <div className="space-y-2">
            <Label>Shoot date <span className="text-red-400">*</span></Label>
            <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-call-sheet-date" />
          </div>
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional — defaults to the project name" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!date || create.isPending} data-testid="button-create-call-sheet">
              {create.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── EDITOR DIALOG ───────────────────────────────────────────────────────────

type SheetFields = {
  title: string; date: string; callTime: string; wrapTime: string;
  location: string; billingNote: string; notes: string; status: string;
};

function CallSheetEditorDialog({ sheetId, projectId, projectName, open, onOpenChange }: {
  sheetId: number;
  projectId: number;
  projectName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: sheet, isLoading } = useGetCallSheet(sheetId, {
    query: { enabled: !!sheetId, queryKey: getGetCallSheetQueryKey(sheetId) },
  });
  const { data: members } = useListMembers();

  const update = useUpdateCallSheet();
  const del = useDeleteCallSheet();
  const sendAll = useSendCallSheetInvites();

  const [fields, setFields] = useState<SheetFields>({
    title: "", date: "", callTime: "", wrapTime: "", location: "", billingNote: "", notes: "", status: "draft",
  });
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (sheet) {
      setFields({
        title: sheet.title ?? "",
        date: sheet.date ?? "",
        callTime: sheet.callTime ?? "",
        wrapTime: sheet.wrapTime ?? "",
        location: sheet.location ?? "",
        billingNote: sheet.billingNote ?? "",
        notes: sheet.notes ?? "",
        status: sheet.status ?? "draft",
      });
      setDirty(false);
    }
  }, [sheet?.id]);

  function setField<K extends keyof SheetFields>(k: K, v: SheetFields[K]) {
    setFields((f) => ({ ...f, [k]: v }));
    setDirty(true);
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: getGetCallSheetQueryKey(sheetId) });
    qc.invalidateQueries({ queryKey: getListCallSheetsQueryKey(projectId) });
  }

  async function saveSheet() {
    try {
      await update.mutateAsync({
        id: sheetId,
        data: {
          title: fields.title.trim() || null,
          date: fields.date,
          callTime: fields.callTime.trim() || null,
          wrapTime: fields.wrapTime.trim() || null,
          location: fields.location.trim() || null,
          billingNote: fields.billingNote.trim() || null,
          notes: fields.notes.trim() || null,
          status: fields.status as any,
        },
      });
      invalidate();
      setDirty(false);
      toast({ title: "Call sheet saved" });
    } catch (err: any) {
      toast({ title: "Couldn't save", description: err?.message ?? "Unknown error", variant: "destructive" });
    }
  }

  async function handleSendAll() {
    try {
      const res = await sendAll.mutateAsync({ id: sheetId });
      invalidate();
      toast({
        title: res.sent > 0 ? `Sent ${res.sent} invite${res.sent === 1 ? "" : "s"}` : "No invites sent",
        description: res.total === 0
          ? "Add crew lines with email addresses first."
          : `${res.sent} of ${res.total} eligible crew emailed.`,
      });
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string } | undefined;
      const description = e?.status === 503
        ? "Email is not configured on this server. Set SENDGRID_API_KEY and EMAIL_FROM."
        : (e?.message ?? "Unknown error");
      toast({ title: "Couldn't send invites", description, variant: "destructive" });
    }
  }

  async function handleDelete() {
    try {
      await del.mutateAsync({ id: sheetId });
      await qc.invalidateQueries({ queryKey: getListCallSheetsQueryKey(projectId) });
      toast({ title: "Call sheet deleted" });
      setConfirmDelete(false);
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Couldn't delete", description: err?.message ?? "Unknown error", variant: "destructive" });
    }
  }

  const crew = sheet?.crew ?? [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Call sheet</DialogTitle>
            <DialogDescription>
              Edit shoot details, manage the crew list, and email availability requests.
            </DialogDescription>
          </DialogHeader>

          {isLoading || !sheet ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <div className="space-y-6 py-2">
              {/* Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>Title</Label>
                  <Input value={fields.title} onChange={(e) => setField("title", e.target.value)} placeholder={projectName} />
                </div>
                <div className="space-y-2">
                  <Label>Shoot date <span className="text-red-400">*</span></Label>
                  <Input type="date" value={fields.date} onChange={(e) => setField("date", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={fields.status} onValueChange={(v) => setField("status", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="sent">Sent</SelectItem>
                      <SelectItem value="final">Final</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Call time</Label>
                  <Input value={fields.callTime} onChange={(e) => setField("callTime", e.target.value)} placeholder="11:00am" />
                </div>
                <div className="space-y-2">
                  <Label>Wrap time</Label>
                  <Input value={fields.wrapTime} onChange={(e) => setField("wrapTime", e.target.value)} placeholder="7:00pm" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Location</Label>
                  <Input value={fields.location} onChange={(e) => setField("location", e.target.value)} placeholder="The Plex Studios — STUDIO E" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Billing note</Label>
                  <Input value={fields.billingNote} onChange={(e) => setField("billingNote", e.target.value)} placeholder="BILLING IS A HALF DAY RATE FOR ALL CREW" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Notes</Label>
                  <Textarea rows={3} value={fields.notes} onChange={(e) => setField("notes", e.target.value)} placeholder="Parking, security, catering, special instructions…" />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Button onClick={saveSheet} disabled={!dirty || update.isPending} data-testid="button-save-call-sheet">
                  {update.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Save details
                </Button>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => printCallSheet(sheet, projectName)} data-testid="button-print-call-sheet">
                    <Printer className="w-4 h-4 mr-2" />
                    Print / PDF
                  </Button>
                  <Button variant="secondary" onClick={handleSendAll} disabled={sendAll.isPending} data-testid="button-send-all-invites">
                    {sendAll.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                    Send invites
                  </Button>
                </div>
              </div>

              {/* Crew */}
              <CrewSection
                sheetId={sheetId}
                crew={crew}
                members={members ?? []}
                onChanged={invalidate}
              />
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row sm:justify-between gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              className="text-red-400 hover:text-red-300 hover:bg-red-400/10"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete call sheet
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this call sheet?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the call sheet and all its crew lines, including any sent availability links. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-500 hover:bg-red-500/90 text-white" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── CREW SECTION ────────────────────────────────────────────────────────────

function rateLabel(c: CrewInvite): string {
  const kind = c.rateType === "half" ? "½ day" : "full day";
  return c.dayRate != null ? `$${c.dayRate.toLocaleString()} · ${kind}` : kind;
}

function CrewSection({ sheetId, crew, members, onChanged }: {
  sheetId: number;
  crew: CrewInvite[];
  members: Member[];
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const updateCrew = useUpdateCrewInvite();
  const delCrew = useDeleteCrewInvite();
  const sendOne = useSendCrewInvite();

  async function setStatus(c: CrewInvite, status: string) {
    try {
      await updateCrew.mutateAsync({ id: c.id, data: { status: status as any } });
      onChanged();
    } catch (err: any) {
      toast({ title: "Couldn't update", description: err?.message ?? "Unknown error", variant: "destructive" });
    }
  }

  async function remove(c: CrewInvite) {
    try {
      await delCrew.mutateAsync({ id: c.id });
      onChanged();
    } catch (err: any) {
      toast({ title: "Couldn't remove", description: err?.message ?? "Unknown error", variant: "destructive" });
    }
  }

  async function send(c: CrewInvite) {
    try {
      await sendOne.mutateAsync({ id: c.id });
      onChanged();
      toast({ title: `Invite sent to ${c.name}` });
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string } | undefined;
      const description = e?.status === 503
        ? "Email is not configured on this server. Set SENDGRID_API_KEY and EMAIL_FROM."
        : e?.status === 400
          ? "This crew line has no email address."
          : (e?.message ?? "Unknown error");
      toast({ title: "Couldn't send invite", description, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between border-t border-border/50 pt-4">
        <h3 className="text-[13px] font-semibold tracking-tight">Crew ({crew.length})</h3>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} data-testid="button-add-crew">
          <UserPlus className="w-3.5 h-3.5 mr-2" />
          Add crew
        </Button>
      </div>

      {crew.length === 0 ? (
        <div className="text-center py-6 text-sm text-muted-foreground font-mono border border-dashed border-border/60 rounded-xl">
          No crew yet. Add positions and send availability requests.
        </div>
      ) : (
        <div className="surface-card ring-hairline border border-border/70 rounded-xl overflow-hidden divide-y divide-border/40">
          {crew.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3 flex-wrap" data-testid={`crew-row-${c.id}`}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                  <span className="text-foreground/90">{c.position}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="truncate">{c.name}</span>
                </div>
                <div className="text-[11px] text-muted-foreground font-mono flex items-center gap-1.5 flex-wrap mt-0.5">
                  {c.email ? <span className="truncate">{c.email}</span> : <span className="text-amber-400/80">no email</span>}
                  <span className="text-border">·</span>
                  <span className="tabular-nums">{rateLabel(c)}</span>
                  {c.responseNote && <><span className="text-border">·</span><span className="italic truncate">“{c.responseNote}”</span></>}
                </div>
              </div>
              <CrewStatusBadge status={c.status} />
              <div className="flex items-center gap-1">
                {c.status === "available" && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-primary" onClick={() => setStatus(c, "confirmed")} title="Confirm booking">
                    Confirm
                  </Button>
                )}
                <Button
                  size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => send(c)} disabled={!c.email || sendOne.isPending}
                  title={c.email ? "Email availability request" : "Add an email first"}
                  data-testid={`button-send-crew-${c.id}`}
                >
                  <Send className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-red-400"
                  onClick={() => remove(c)} title="Remove"
                  data-testid={`button-remove-crew-${c.id}`}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddCrewDialog sheetId={sheetId} members={members} open={addOpen} onOpenChange={setAddOpen} onAdded={onChanged} />
    </div>
  );
}

// ─── ADD CREW DIALOG ─────────────────────────────────────────────────────────

const NONE = "__none__";

function AddCrewDialog({ sheetId, members, open, onOpenChange, onAdded }: {
  sheetId: number;
  members: Member[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdded: () => void;
}) {
  const { toast } = useToast();
  const add = useAddCrewInvite();
  const [position, setPosition] = useState<string>(TV_POSITIONS[3]);
  const [memberId, setMemberId] = useState<string>(NONE);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [rateType, setRateType] = useState<"full" | "half">("full");
  const [dayRate, setDayRate] = useState("");

  useEffect(() => {
    if (open) {
      setPosition(TV_POSITIONS[3]); setMemberId(NONE); setName(""); setEmail("");
      setRateType("full"); setDayRate("");
    }
  }, [open]);

  const selectedMember = useMemo(
    () => (memberId !== NONE ? members.find((m) => String(m.id) === memberId) : undefined),
    [memberId, members],
  );

  // When a roster member is chosen, surface their info as placeholders / prefill.
  function onPickMember(v: string) {
    setMemberId(v);
    if (v !== NONE) {
      const m = members.find((mm) => String(mm.id) === v);
      if (m) {
        setName(m.name ?? "");
        setEmail(m.email ?? "");
        const r = rateType === "half" ? m.halfDayRate : m.fullDayRate;
        setDayRate(r != null ? String(r) : "");
      }
    }
  }

  function onRateTypeChange(v: "full" | "half") {
    setRateType(v);
    if (selectedMember) {
      const r = v === "half" ? selectedMember.halfDayRate : selectedMember.fullDayRate;
      setDayRate(r != null ? String(r) : dayRate);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const finalName = name.trim() || selectedMember?.name?.trim() || "";
    if (!position.trim()) { toast({ title: "Pick a position", variant: "destructive" }); return; }
    if (!finalName) { toast({ title: "Enter a name or pick a member", variant: "destructive" }); return; }
    const rate = dayRate.trim() ? parseInt(dayRate.trim(), 10) : undefined;
    if (rate != null && (Number.isNaN(rate) || rate < 0)) { toast({ title: "Rate must be a positive number", variant: "destructive" }); return; }
    try {
      await add.mutateAsync({
        id: sheetId,
        data: {
          position: position.trim(),
          memberId: memberId !== NONE ? Number(memberId) : undefined,
          name: finalName,
          email: email.trim() || undefined,
          rateType,
          dayRate: rate,
        },
      });
      onAdded();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Couldn't add crew", description: err?.message ?? "Unknown error", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add crew</DialogTitle>
          <DialogDescription>Pick a roster member or enter someone ad-hoc. Rates pre-fill from the member.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2" data-testid="form-add-crew">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Position <span className="text-red-400">*</span></Label>
              <Select value={position} onValueChange={setPosition}>
                <SelectTrigger data-testid="select-crew-position"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {TV_POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Roster member</Label>
              <Select value={memberId} onValueChange={onPickMember}>
                <SelectTrigger data-testid="select-crew-member"><SelectValue placeholder="Ad-hoc (no member)" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE}>Ad-hoc (no member)</SelectItem>
                  {members.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Name <span className="text-red-400">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" data-testid="input-crew-name" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Needed to email an availability request" />
            </div>
            <div className="space-y-2">
              <Label>Rate type</Label>
              <Select value={rateType} onValueChange={(v) => onRateTypeChange(v as "full" | "half")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full day</SelectItem>
                  <SelectItem value="half">Half day</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Day rate ($)</Label>
              <Input type="number" min={0} value={dayRate} onChange={(e) => setDayRate(e.target.value)} placeholder="e.g. 750" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={add.isPending} data-testid="button-submit-crew">
              {add.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Add to call sheet
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
