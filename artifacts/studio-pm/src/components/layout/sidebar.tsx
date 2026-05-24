import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter } from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Video, CheckSquare, Users, FolderOpen, LogOut, Shield } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import cueMark from "@assets/cue-icon_1779576125630.svg";

export function AppSidebar() {
  const [location] = useLocation();
  const auth = useAuth();
  const user = auth.status === "authenticated" ? auth.user : null;
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
    </Sidebar>
  );
}
