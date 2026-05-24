import { useState } from "react";
import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter } from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Video, CheckSquare, Users, FolderOpen, LogOut, Shield, KeyRound, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import cueMark from "@assets/cue-icon_1779576125630.svg";

export function AppSidebar() {
  const [location] = useLocation();
  const auth = useAuth();
  const user = auth.status === "authenticated" ? auth.user : null;
  const [changePwOpen, setChangePwOpen] = useState(false);
  const initials = (user?.name || user?.email || "?")
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  const navItems = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Projects", href: "/projects", icon: Video },
    { name: "Tasks", href: "/tasks", icon: CheckSquare },
    { name: "Team", href: "/team", icon: Users },
    { name: "Documents", href: "/documents", icon: FolderOpen },
    // Admin-only entries appended below — gated on `user.isAdmin`.
    ...(user?.isAdmin ? [{ name: "Users", href: "/admin/users", icon: Shield }] : []),
  ];

  return (
    <Sidebar variant="sidebar" className="border-r border-white/[0.085] glass-rail !bg-transparent">
      <SidebarHeader className="px-4 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <img src={cueMark} alt="Cue" className="w-9 h-9 rounded-[10px] shrink-0 shadow-[0_8px_24px_-8px_rgba(109,92,255,0.7)]" />
          <div className="flex flex-col min-w-0 leading-tight">
            <div className="font-display text-[18px] font-bold tracking-tight truncate text-aurora">Cue</div>
            <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              On cue · v1
            </div>
          </div>
        </div>
      </SidebarHeader>
      <div className="px-4">
        <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground px-2 mb-1.5">
          Navigation
        </div>
      </div>
      <SidebarContent className="px-3">
        <SidebarMenu className="gap-0.5">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <SidebarMenuItem key={item.name}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive}
                  tooltip={item.name}
                  className={`h-9 rounded-lg transition-colors ${
                    isActive
                      ? "bg-primary/12 text-primary hover:bg-primary/15 data-[active=true]:bg-primary/12 data-[active=true]:text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60"
                  }`}
                >
                  <Link href={item.href} className="flex items-center gap-3 relative">
                    {isActive && (
                      <span className="absolute -left-3 top-1/2 -translate-y-1/2 h-5 w-[2px] rounded-full bg-primary" />
                    )}
                    <item.icon className="w-[18px] h-[18px] shrink-0" />
                    <span className="text-[13px] font-medium">{item.name}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>
      {user && (
        <SidebarFooter className="border-t border-border/60 p-3">
          <div className="flex items-center gap-2.5 min-w-0 p-1.5 rounded-lg hover:bg-sidebar-accent/40 transition-colors">
            {user.picture ? (
              <img src={user.picture} alt="" className="w-8 h-8 rounded-full shrink-0 ring-1 ring-border" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 text-primary ring-1 ring-primary/30 flex items-center justify-center text-[11px] font-mono font-semibold shrink-0">
                {initials || "?"}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium truncate flex items-center gap-1.5">
                <span className="truncate">{user.name || user.email || "Member"}</span>
                {user.isAdmin && (
                  <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-primary border border-primary/30 bg-primary/10 px-1.5 py-0.5 rounded-md shrink-0 leading-none">
                    Admin
                  </span>
                )}
              </div>
              {user.email && user.name && (
                <div className="text-[10.5px] text-muted-foreground truncate font-mono">{user.email}</div>
              )}
            </div>
            {/* OIDC users don't have a local password — hide the key icon. */}
            {user.authProvider === "local" && (
              <button
                type="button"
                title="Change password"
                data-testid="button-change-password"
                onClick={() => setChangePwOpen(true)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors shrink-0"
              >
                <KeyRound className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              title="Sign out"
              data-testid="button-sign-out"
              onClick={() => void auth.signOut()}
              className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </SidebarFooter>
      )}
      <ChangePasswordDialog open={changePwOpen} onOpenChange={setChangePwOpen} />
    </Sidebar>
  );
}

// ─── Change password (self-service) ────────────────────────────────────────
function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const auth = useAuth();
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() { setCurrent(""); setNext(""); setConfirm(""); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 8) {
      toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "destructive" });
      return;
    }
    if (next !== confirm) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await auth.changePassword({ currentPassword: current, newPassword: next });
      toast({ title: "Password updated" });
      reset();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Couldn't change password", description: err?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Verify your current password, then choose a new one. Your other sessions stay signed in.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2" data-testid="form-change-password">
          <div className="space-y-2">
            <Label>Current password</Label>
            <Input
              type="password" required autoFocus
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              data-testid="input-current-password"
            />
          </div>
          <div className="space-y-2">
            <Label>New password</Label>
            <Input
              type="password" required minLength={8}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="At least 8 characters"
              data-testid="input-new-password"
            />
          </div>
          <div className="space-y-2">
            <Label>Confirm new password</Label>
            <Input
              type="password" required minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              data-testid="input-confirm-password"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !current || next.length < 8 || next !== confirm} data-testid="button-submit-change-password">
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Update password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
