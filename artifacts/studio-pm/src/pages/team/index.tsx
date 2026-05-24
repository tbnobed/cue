import { useEffect, useState } from "react";
import {
  useListMembers, useCreateMember, useUpdateMember, useDeleteMember,
  getListMembersQueryKey,
} from "@workspace/api-client-react";
import type { Member, MemberInput, MemberUpdate } from "@workspace/api-client-react";
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
import { motion } from "framer-motion";
import {
  UserPlus, Mail, Phone, Smartphone, MapPin, Building2, Briefcase,
  StickyNote, Pencil, Trash2, Loader2,
} from "lucide-react";

const ROLES = ["producer", "engineer", "it", "integrator", "manager", "contractor"] as const;
type Role = (typeof ROLES)[number];

type FormState = {
  name: string;
  email: string;
  role: Role;
  department: string;
  title: string;
  phone: string;
  mobilePhone: string;
  location: string;
  company: string;
  avatarUrl: string;
  notes: string;
};

const EMPTY: FormState = {
  name: "", email: "", role: "engineer", department: "",
  title: "", phone: "", mobilePhone: "", location: "", company: "",
  avatarUrl: "", notes: "",
};

function fromMember(m: Member): FormState {
  return {
    name: m.name ?? "",
    email: m.email ?? "",
    role: (m.role as Role) ?? "engineer",
    department: m.department ?? "",
    title: m.title ?? "",
    phone: m.phone ?? "",
    mobilePhone: m.mobilePhone ?? "",
    location: m.location ?? "",
    company: m.company ?? "",
    avatarUrl: m.avatarUrl ?? "",
    notes: m.notes ?? "",
  };
}

const OPTIONAL_KEYS = [
  "email", "department", "title", "phone", "mobilePhone",
  "location", "company", "avatarUrl", "notes",
] as const satisfies readonly (keyof FormState)[];

/** For creates: drop empty strings so we don't write blanks. */
function toCreatePayload(f: FormState): MemberInput {
  const out = { name: f.name.trim(), role: f.role } as MemberInput & Record<string, string>;
  for (const k of OPTIONAL_KEYS) {
    const v = (f[k] ?? "").trim();
    if (v) out[k] = v;
  }
  return out;
}

/** For edits: send `null` for cleared optional fields so they get unset server-side. */
function toUpdatePayload(f: FormState): MemberUpdate {
  const out = { name: f.name.trim(), role: f.role } as MemberUpdate & Record<string, string | null>;
  for (const k of OPTIONAL_KEYS) {
    const v = (f[k] ?? "").trim();
    out[k] = v ? v : null;
  }
  return out;
}

export default function Team() {
  const { data: members, isLoading } = useListMembers();
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [viewingMember, setViewingMember] = useState<Member | null>(null);

  return (
    <div className="w-full space-y-8">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
            <span className="w-1 h-1 rounded-full bg-primary" />
            Personnel Roster
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Active crew</h1>
        </div>
        <div className="flex items-center gap-3">
          {members && (
            <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
              {members.length} {members.length === 1 ? "member" : "members"}
            </span>
          )}
          <Button onClick={() => setAddOpen(true)} data-testid="button-add-member">
            <UserPlus className="w-4 h-4 mr-2" />
            Add member
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
        </div>
      ) : members && members.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {members.map((member, idx) => (
            <MemberCard
              key={member.id}
              member={member}
              idx={idx}
              onView={() => setViewingMember(member)}
              onEdit={() => setEditingMember(member)}
            />
          ))}
        </div>
      ) : (
        <div className="surface-card ring-hairline border border-border/70 rounded-2xl p-12 text-center text-sm text-muted-foreground font-mono space-y-4">
          <div>No crew members yet.</div>
          <Button onClick={() => setAddOpen(true)} variant="outline">
            <UserPlus className="w-4 h-4 mr-2" />
            Add your first member
          </Button>
        </div>
      )}

      <MemberFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        mode="create"
      />

      <MemberFormDialog
        open={!!editingMember}
        onOpenChange={(o) => !o && setEditingMember(null)}
        mode="edit"
        member={editingMember ?? undefined}
      />

      <MemberDetailDialog
        member={viewingMember}
        onOpenChange={(o) => !o && setViewingMember(null)}
        onEdit={() => {
          if (viewingMember) {
            setEditingMember(viewingMember);
            setViewingMember(null);
          }
        }}
      />
    </div>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────

function MemberCard({ member, idx, onView, onEdit }: {
  member: Member; idx: number; onView: () => void; onEdit: () => void;
}) {
  const initials = (member.name || "?")
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]?.toUpperCase()).join("");

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.03 }}
      className="group surface-card ring-hairline border border-border/70 rounded-2xl p-5 flex flex-col gap-3 transition-all hover:border-border hover:-translate-y-0.5 hover:shadow-lg cursor-pointer relative"
      onClick={onView}
      data-testid={`member-card-${member.id}`}
    >
      <div className="flex items-start gap-4">
        {member.avatarUrl ? (
          <img src={member.avatarUrl} alt="" className="w-12 h-12 rounded-full ring-1 ring-border shrink-0" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/30 to-primary/5 ring-1 ring-primary/30 text-primary flex items-center justify-center text-sm font-mono font-semibold shrink-0">
            {initials || "?"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold tracking-tight truncate">{member.name}</div>
          {member.title && (
            <div className="text-[12px] text-foreground/70 truncate">{member.title}</div>
          )}
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5 font-mono">
            <span className="capitalize">{member.role}</span>
            {member.department && (
              <>
                <span className="w-0.5 h-0.5 rounded-full bg-border" />
                <span>{member.department}</span>
              </>
            )}
          </div>
        </div>
        <Button
          variant="ghost" size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          title="Edit"
          data-testid={`button-edit-member-${member.id}`}
        >
          <Pencil className="w-3.5 h-3.5" />
        </Button>
      </div>
      {(member.email || member.phone || member.mobilePhone || member.company || member.location) && (
        <div className="border-t border-border/40 pt-3 grid grid-cols-1 gap-1.5 text-[11.5px] text-muted-foreground font-mono">
          {member.email && <ContactLine icon={<Mail className="w-3 h-3" />} value={member.email} />}
          {member.phone && <ContactLine icon={<Phone className="w-3 h-3" />} value={member.phone} />}
          {member.mobilePhone && <ContactLine icon={<Smartphone className="w-3 h-3" />} value={member.mobilePhone} />}
          {member.company && <ContactLine icon={<Building2 className="w-3 h-3" />} value={member.company} />}
          {member.location && <ContactLine icon={<MapPin className="w-3 h-3" />} value={member.location} />}
        </div>
      )}
    </motion.div>
  );
}

function ContactLine({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-2 truncate">
      <span className="text-muted-foreground/60 shrink-0">{icon}</span>
      <span className="truncate">{value}</span>
    </div>
  );
}

// ─── Detail view (read-only quick look) ─────────────────────────────────────

function MemberDetailDialog({ member, onOpenChange, onEdit }: {
  member: Member | null;
  onOpenChange: (o: boolean) => void;
  onEdit: () => void;
}) {
  if (!member) return null;
  const initials = (member.name || "?").split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0]?.toUpperCase()).join("");
  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-4">
            {member.avatarUrl ? (
              <img src={member.avatarUrl} alt="" className="w-14 h-14 rounded-full ring-1 ring-border shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary/30 to-primary/5 ring-1 ring-primary/30 text-primary flex items-center justify-center text-base font-mono font-semibold shrink-0">
                {initials || "?"}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <DialogTitle className="truncate">{member.name}</DialogTitle>
              <DialogDescription className="font-mono text-xs">
                <span className="capitalize">{member.role}</span>
                {member.title && <> · {member.title}</>}
                {member.department && <> · {member.department}</>}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <DetailRow icon={<Mail className="w-3.5 h-3.5" />} label="Email" value={member.email} kind="mail" />
          <DetailRow icon={<Phone className="w-3.5 h-3.5" />} label="Phone" value={member.phone} kind="tel" />
          <DetailRow icon={<Smartphone className="w-3.5 h-3.5" />} label="Mobile" value={member.mobilePhone} kind="tel" />
          <DetailRow icon={<Briefcase className="w-3.5 h-3.5" />} label="Title" value={member.title} />
          <DetailRow icon={<Building2 className="w-3.5 h-3.5" />} label="Company" value={member.company} />
          <DetailRow icon={<MapPin className="w-3.5 h-3.5" />} label="Location" value={member.location} />
          {member.notes && (
            <div className="space-y-1.5 pt-2 border-t border-border/40">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] font-mono text-muted-foreground">
                <StickyNote className="w-3.5 h-3.5" />
                Notes
              </div>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{member.notes}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={onEdit}><Pencil className="w-4 h-4 mr-2" />Edit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ icon, label, value, kind }: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
  kind?: "mail" | "tel";
}) {
  if (!value) return null;
  const inner = kind === "mail"
    ? <a href={`mailto:${value}`} className="text-primary hover:underline">{value}</a>
    : kind === "tel"
      ? <a href={`tel:${value}`} className="text-primary hover:underline">{value}</a>
      : <span>{value}</span>;
  return (
    <div className="flex items-start gap-3 text-sm">
      <div className="w-20 shrink-0 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.15em] font-mono text-muted-foreground pt-0.5">
        {icon}
        {label}
      </div>
      <div className="flex-1 min-w-0 break-words">{inner}</div>
    </div>
  );
}

// ─── Add / Edit dialog ──────────────────────────────────────────────────────

function MemberFormDialog({ open, onOpenChange, mode, member }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "create" | "edit";
  member?: Member;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const create = useCreateMember();
  const update = useUpdateMember();
  const del = useDeleteMember();

  // Reset form whenever the dialog opens (or the member being edited changes).
  useEffect(() => {
    if (open) setForm(member ? fromMember(member) : EMPTY);
  }, [open, member?.id]);

  const isEdit = mode === "edit";
  const pending = create.isPending || update.isPending || del.isPending;

  function field<K extends keyof FormState>(k: K) {
    return {
      value: form[k] as string,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm(f => ({ ...f, [k]: e.target.value })),
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      if (isEdit && member) {
        await update.mutateAsync({ id: member.id, data: toUpdatePayload(form) });
        toast({ title: "Member updated" });
      } else {
        await create.mutateAsync({ data: toCreatePayload(form) });
        toast({ title: "Member added" });
      }
      await qc.invalidateQueries({ queryKey: getListMembersQueryKey() });
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: isEdit ? "Couldn't update member" : "Couldn't add member",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function handleDelete() {
    if (!member) return;
    try {
      await del.mutateAsync({ id: member.id });
      await qc.invalidateQueries({ queryKey: getListMembersQueryKey() });
      toast({ title: `Removed ${member.name}` });
      setConfirmDelete(false);
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Couldn't delete member", description: err?.message ?? "Unknown error", variant: "destructive" });
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit member" : "Add member"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update contact details and assignment info."
                : "Add a new person to your crew roster. Only name and role are required."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2" data-testid="form-member">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 md:col-span-2">
                <Label>Name <span className="text-red-400">*</span></Label>
                <Input required {...field("name")} placeholder="Jane Doe" data-testid="input-member-name" />
              </div>
              <div className="space-y-2">
                <Label>Role <span className="text-red-400">*</span></Label>
                <Select value={form.role} onValueChange={(v) => setForm(f => ({ ...f, role: v as Role }))}>
                  <SelectTrigger data-testid="select-member-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map(r => (
                      <SelectItem key={r} value={r}><span className="capitalize">{r}</span></SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Job title</Label>
                <Input {...field("title")} placeholder="Senior AV Engineer" />
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Input {...field("department")} placeholder="Studio Ops" />
              </div>
              <div className="space-y-2">
                <Label>Company</Label>
                <Input {...field("company")} placeholder="For contractors / integrators" />
              </div>
              <div className="space-y-2 md:col-span-2 pt-2 border-t border-border/40">
                <Label className="text-[11px] uppercase tracking-[0.15em] font-mono text-muted-foreground">
                  Contact
                </Label>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Email</Label>
                <Input type="email" {...field("email")} placeholder="jane@studio.com" />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input type="tel" {...field("phone")} placeholder="+1 555 010 1234" />
              </div>
              <div className="space-y-2">
                <Label>Mobile</Label>
                <Input type="tel" {...field("mobilePhone")} placeholder="+1 555 010 9876" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Location</Label>
                <Input {...field("location")} placeholder="Brooklyn, NY (ET)" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Avatar URL</Label>
                <Input type="url" {...field("avatarUrl")} placeholder="https://…" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Notes</Label>
                <Textarea
                  rows={3}
                  {...field("notes")}
                  placeholder="On-call hours, badge access, vendor PO number, anything you'd otherwise stick on a Post-it."
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row sm:justify-between">
              <div>
                {isEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-red-400 hover:text-red-300 hover:bg-red-400/10"
                    onClick={() => setConfirmDelete(true)}
                    disabled={pending}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2 justify-end">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!form.name.trim() || pending} data-testid="button-save-member">
                  {pending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {isEdit ? "Save changes" : "Add member"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {member?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes them from the roster and from every project they're assigned to. Tasks already
              assigned to this person will keep the assignee ID but won't show a name.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-500/90 text-white"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

