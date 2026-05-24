import { useEffect, useState } from "react";
import { Redirect } from "wouter";
import {
  useListAdminUsers,
  useUpdateAdminUser,
  useDeleteAdminUser,
  getListAdminUsersQueryKey,
} from "@workspace/api-client-react";
import type { AdminUser } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { motion } from "framer-motion";
import {
  UserPlus, Shield, ShieldOff, Trash2, Loader2, KeyRound, Globe, Mail, Pencil, Clock, CheckCircle2,
} from "lucide-react";

export default function UsersAdmin() {
  const auth = useAuth();

  // Guard: redirect non-admins. Backend also enforces this, but the route
  // shouldn't even render — avoids a flash of "Forbidden" content.
  if (auth.status === "loading") {
    return <div className="p-8 text-sm text-muted-foreground font-mono">Loading…</div>;
  }
  if (auth.status !== "authenticated" || !auth.user.isAdmin) {
    return <Redirect to="/" />;
  }

  return <UsersAdminInner currentUserId={auth.user.id} />;
}

function UsersAdminInner({ currentUserId }: { currentUserId: number }) {
  const { data: users, isLoading } = useListAdminUsers();
  const [addOpen, setAddOpen] = useState(false);

  // Pending = invited via OIDC (member row matched) but not yet approved.
  // Surface them first so admins can act on the queue.
  const pending = users?.filter(u => !u.isActive) ?? [];
  const locals = users?.filter(u => u.isActive && u.authProvider === "local") ?? [];
  const oidcs = users?.filter(u => u.isActive && u.authProvider === "oidc") ?? [];

  return (
    <div className="w-full space-y-8">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
            <Shield className="w-3 h-3" />
            Admin · Auth accounts
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Sign-in accounts for Cue. Local accounts use email + password and may be promoted to admin.
            OIDC accounts (OBTV SSO / Google) sign in via an external IdP and land in <em className="text-foreground/80 not-italic">Pending approval</em> until you activate them.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} data-testid="button-add-user">
          <UserPlus className="w-4 h-4 mr-2" />
          Add local user
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
        </div>
      ) : (
        <div className="space-y-8">
          {pending.length > 0 && (
            <Section
              title="Pending approval"
              subtitle="New sign-ins waiting for admin activation. Toggle them on to grant access."
              icon={<Clock className="w-3 h-3 text-amber-400" />}
              count={pending.length}
              accent
            >
              <UserList users={pending} currentUserId={currentUserId} />
            </Section>
          )}

          <Section
            title="Local accounts"
            subtitle="Email + password. Only these accounts can be admins."
            icon={<KeyRound className="w-3 h-3" />}
            count={locals.length}
          >
            {locals.length === 0 ? (
              <EmptyRow text="No local accounts." />
            ) : (
              <UserList users={locals} currentUserId={currentUserId} />
            )}
          </Section>

          <Section
            title="OIDC accounts"
            subtitle="Signed in via OBTV SSO or Google. Cannot hold admin rights."
            icon={<Globe className="w-3 h-3" />}
            count={oidcs.length}
          >
            {oidcs.length === 0 ? (
              <EmptyRow text="No OIDC users are active yet." />
            ) : (
              <UserList users={oidcs} currentUserId={currentUserId} />
            )}
          </Section>
        </div>
      )}

      <AddUserDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

// ─── Layout helpers ─────────────────────────────────────────────────────────

function Section({
  title, subtitle, icon, count, children, accent = false,
}: { title: string; subtitle: string; icon: React.ReactNode; count: number; children: React.ReactNode; accent?: boolean }) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className={`flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] ${accent ? "text-amber-400" : "text-muted-foreground"}`}>
            {icon}
            {title}
          </div>
          <div className="text-xs text-muted-foreground/80 mt-0.5">{subtitle}</div>
        </div>
        <span className={`text-[11px] font-mono tabular-nums ${accent ? "text-amber-400" : "text-muted-foreground"}`}>
          {count} {count === 1 ? "account" : "accounts"}
        </span>
      </div>
      {children}
    </section>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="surface-card ring-hairline border border-border/70 rounded-2xl p-8 text-center text-sm text-muted-foreground font-mono">
      {text}
    </div>
  );
}

// ─── Rows ───────────────────────────────────────────────────────────────────

function UserList({ users, currentUserId }: { users: AdminUser[]; currentUserId: number }) {
  return (
    <div className="space-y-2">
      {users.map((u, idx) => (
        <UserRow key={u.id} user={u} currentUserId={currentUserId} idx={idx} />
      ))}
    </div>
  );
}

function UserRow({ user, currentUserId, idx }: { user: AdminUser; currentUserId: number; idx: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateAdminUser();
  const del = useDeleteAdminUser();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const isSelf = user.id === currentUserId;
  const initials = (user.name || user.email || "?")
    .split(/[\s@]/).filter(Boolean).slice(0, 2)
    .map(w => w[0]?.toUpperCase()).join("");

  // OIDC accounts can't ever be admin; toggle is disabled with explanation.
  const canToggleAdmin = user.authProvider === "local" && !isSelf;
  const adminToggleTitle = isSelf
    ? "You can't remove your own admin rights."
    : user.authProvider === "oidc"
      ? "OIDC users can never be admins."
      : user.isAdmin ? "Demote to standard user" : "Promote to admin";

  // Activation: you can't deactivate yourself (locks you out mid-session).
  const canToggleActive = !isSelf;
  const activeToggleTitle = isSelf
    ? "You can't deactivate your own account."
    : user.isActive ? "Suspend this account (immediate)" : "Activate this account";

  async function toggleAdmin(next: boolean) {
    try {
      await update.mutateAsync({ id: user.id, data: { isAdmin: next } });
      await qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
      toast({ title: next ? `${user.email ?? "User"} is now an admin` : `${user.email ?? "User"} demoted` });
    } catch (err: any) {
      toast({ title: "Couldn't update user", description: err?.message ?? "Unknown error", variant: "destructive" });
    }
  }

  async function toggleActive(next: boolean) {
    try {
      await update.mutateAsync({ id: user.id, data: { isActive: next } });
      await qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
      toast({ title: next ? `${user.email ?? "User"} activated` : `${user.email ?? "User"} suspended` });
    } catch (err: any) {
      toast({ title: "Couldn't update user", description: err?.message ?? "Unknown error", variant: "destructive" });
    }
  }

  async function handleDelete() {
    try {
      await del.mutateAsync({ id: user.id });
      await qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
      toast({ title: `Deleted ${user.email ?? "account"}` });
      setConfirmDelete(false);
    } catch (err: any) {
      toast({ title: "Couldn't delete user", description: err?.message ?? "Unknown error", variant: "destructive" });
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: idx * 0.02 }}
        className={`surface-card ring-hairline rounded-2xl p-4 flex items-center gap-4 border ${user.isActive ? "border-border/70" : "border-amber-400/30 bg-amber-400/[0.03]"}`}
        data-testid={`user-row-${user.id}`}
      >
        {user.picture ? (
          <img src={user.picture} alt="" className="w-10 h-10 rounded-full ring-1 ring-border shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/30 to-primary/5 ring-1 ring-primary/30 text-primary flex items-center justify-center text-xs font-mono font-semibold shrink-0">
            {initials || "?"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="text-sm font-semibold tracking-tight truncate">
              {user.name || user.email || `User #${user.id}`}
            </span>
            {isSelf && (
              <span className="text-[9.5px] font-mono uppercase tracking-[0.14em] text-muted-foreground border border-border bg-muted/30 px-1.5 py-0.5 rounded-md shrink-0 leading-none">
                You
              </span>
            )}
            {user.isAdmin && (
              <span className="text-[9.5px] font-mono uppercase tracking-[0.14em] text-primary border border-primary/30 bg-primary/10 px-1.5 py-0.5 rounded-md shrink-0 leading-none">
                Admin
              </span>
            )}
            {!user.isActive && (
              <span className="text-[9.5px] font-mono uppercase tracking-[0.14em] text-amber-400 border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 rounded-md shrink-0 leading-none">
                Pending
              </span>
            )}
          </div>
          {user.email && (
            <div className="text-[11.5px] text-muted-foreground font-mono truncate">{user.email}</div>
          )}
          <div className="text-[10.5px] text-muted-foreground/70 font-mono mt-0.5">
            Last seen {fmtDate(user.lastLoginAt)} · joined {fmtDate(user.createdAt)}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2" title={activeToggleTitle}>
            {user.isActive
              ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              : <Clock className="w-3.5 h-3.5 text-amber-400" />}
            <Switch
              checked={user.isActive}
              disabled={!canToggleActive || update.isPending}
              onCheckedChange={(v) => void toggleActive(v)}
              data-testid={`switch-active-${user.id}`}
            />
          </div>
          <div className="flex items-center gap-2" title={adminToggleTitle}>
            {user.isAdmin
              ? <Shield className="w-3.5 h-3.5 text-primary" />
              : <ShieldOff className="w-3.5 h-3.5 text-muted-foreground" />}
            <Switch
              checked={user.isAdmin}
              disabled={!canToggleAdmin || update.isPending}
              onCheckedChange={(v) => void toggleAdmin(v)}
              data-testid={`switch-admin-${user.id}`}
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60"
            onClick={() => setEditOpen(true)}
            title="Edit account"
            data-testid={`button-edit-user-${user.id}`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 disabled:opacity-30"
            onClick={() => setConfirmDelete(true)}
            disabled={isSelf || del.isPending}
            title={isSelf ? "You can't delete your own account." : "Delete account"}
            data-testid={`button-delete-user-${user.id}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </motion.div>

      <EditUserDialog user={user} open={editOpen} onOpenChange={setEditOpen} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {user.email ?? `user #${user.id}`}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the sign-in account.
              {user.authProvider === "oidc" && (
                <> The matching OIDC user can sign in again and a fresh account will be re-created (pending approval).</>
              )}
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

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = Date.now();
  const diffMs = now - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

// ─── Edit user dialog ───────────────────────────────────────────────────────
//
// Admin can rename, change email, and (local only) reset the password.
// Password is intentionally blank on open — empty submit means "don't touch it".

function EditUserDialog({
  user, open, onOpenChange,
}: { user: AdminUser; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateAdminUser();

  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [password, setPassword] = useState("");

  // Re-sync form when opening a different row, or when the row updates.
  // Empty `password` is the "leave unchanged" sentinel.
  useEffect(() => {
    if (open) {
      setName(user.name ?? "");
      setEmail(user.email ?? "");
      setPassword("");
    }
  }, [open, user.id, user.name, user.email]);

  const isOidc = user.authProvider === "oidc";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: { name?: string | null; email?: string | null; password?: string } = {};
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (trimmedName !== (user.name ?? "")) payload.name = trimmedName ? trimmedName : null;
    if (trimmedEmail !== (user.email ?? "")) payload.email = trimmedEmail ? trimmedEmail : null;
    if (password) {
      if (password.length < 8) {
        toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "destructive" });
        return;
      }
      payload.password = password;
    }
    if (Object.keys(payload).length === 0) {
      onOpenChange(false);
      return;
    }
    try {
      await update.mutateAsync({ id: user.id, data: payload });
      await qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
      toast({ title: `Updated ${trimmedEmail || trimmedName || `user #${user.id}`}` });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Couldn't update user", description: err?.message ?? "Unknown error", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {user.email || `user #${user.id}`}</DialogTitle>
          <DialogDescription>
            {isOidc
              ? "The identity provider manages this user's password. Name and email are overwritten from the IdP on next sign-in."
              : "Rename, change the sign-in email, or reset the password. Leave the password field blank to keep it unchanged."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2" data-testid={`form-edit-user-${user.id}`}>
          <div className="space-y-2">
            <Label>Display name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              data-testid="input-edit-name"
            />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <div className="relative">
              <Mail className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                type="email"
                className="pl-9"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@studio.com"
                data-testid="input-edit-email"
              />
            </div>
          </div>
          {!isOidc && (
            <div className="space-y-2">
              <Label>New password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank to keep current password"
                data-testid="input-edit-password"
              />
              <p className="text-[11px] text-muted-foreground font-mono">
                Admin reset — no current password required. Share new credentials out-of-band.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={update.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending} data-testid="button-submit-edit-user">
              {update.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add local user dialog ──────────────────────────────────────────────────

function AddUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setEmail(""); setName(""); setPassword(""); setMakeAdmin(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || password.length < 8) return;
    setSubmitting(true);
    try {
      // Reuse the existing admin-only signup endpoint via the auth hook so
      // we don't duplicate the bcrypt/timing-defense logic in a new path.
      await auth.signUp({
        email: email.trim(),
        password,
        name: name.trim() || undefined,
        isAdmin: makeAdmin,
      });
      await qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
      toast({ title: `Created ${email.trim()}` });
      reset();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Couldn't create user", description: err?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add local user</DialogTitle>
          <DialogDescription>
            Creates an email + password account, activated immediately. Share the credentials with the new user out-of-band —
            there's no email invite flow yet.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2" data-testid="form-add-user">
          <div className="space-y-2">
            <Label>Email <span className="text-red-400">*</span></Label>
            <div className="relative">
              <Mail className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                type="email" required autoFocus
                className="pl-9"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ops@studio.com"
                data-testid="input-user-email"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Display name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe (optional)"
              data-testid="input-user-name"
            />
          </div>
          <div className="space-y-2">
            <Label>Password <span className="text-red-400">*</span></Label>
            <Input
              type="password" required minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              data-testid="input-user-password"
            />
            <p className="text-[11px] text-muted-foreground font-mono">
              Stored as a bcrypt hash. Minimum 8 characters.
            </p>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg border border-border/60 bg-muted/20">
            <Switch
              checked={makeAdmin}
              onCheckedChange={setMakeAdmin}
              id="make-admin"
              data-testid="switch-make-admin"
            />
            <div className="flex-1">
              <Label htmlFor="make-admin" className="cursor-pointer text-sm">
                Grant admin rights
              </Label>
              <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                Admins can manage users and run privileged actions.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || !email.trim() || password.length < 8}
              data-testid="button-submit-user"
            >
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
