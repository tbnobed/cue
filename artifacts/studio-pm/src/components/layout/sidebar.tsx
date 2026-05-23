import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter } from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Video, CheckSquare, CalendarDays, Users, FolderOpen, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

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
    { name: "Timeline", href: "/timeline", icon: CalendarDays },
    { name: "Team", href: "/team", icon: Users },
    { name: "Documents", href: "/documents", icon: FolderOpen },
  ];

  return (
    <Sidebar variant="sidebar" className="border-r border-border bg-card">
      <SidebarHeader className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2 text-primary font-bold text-lg tracking-tight uppercase">
          <div className="w-4 h-4 bg-primary rounded-sm animate-pulse" />
          Studio CMD
        </div>
      </SidebarHeader>
      <SidebarContent className="p-2">
        <SidebarMenu>
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <SidebarMenuItem key={item.name}>
                <SidebarMenuButton asChild isActive={isActive} tooltip={item.name}>
                  <Link href={item.href} className="flex items-center gap-3">
                    <item.icon className="w-5 h-5" />
                    <span>{item.name}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>
      {user && (
        <SidebarFooter className="border-t border-border p-3">
          <div className="flex items-center gap-2 min-w-0">
            {user.picture ? (
              <img src={user.picture} alt="" className="w-8 h-8 rounded-full shrink-0 border border-border" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary/15 text-primary border border-primary/40 flex items-center justify-center text-[11px] font-mono font-bold shrink-0">
                {initials || "?"}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate flex items-center gap-1.5">
                <span className="truncate">{user.name || user.email || "Member"}</span>
                {user.isAdmin && (
                  <span className="text-[9px] font-mono uppercase tracking-wider text-primary border border-primary/40 bg-primary/10 px-1 py-0.5 rounded shrink-0">
                    Admin
                  </span>
                )}
              </div>
              {user.email && user.name && (
                <div className="text-[10px] text-muted-foreground truncate font-mono">{user.email}</div>
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
