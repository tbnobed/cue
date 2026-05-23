import { Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Video, CheckSquare, CalendarDays, Users, FolderOpen } from "lucide-react";

export function AppSidebar() {
  const [location] = useLocation();

  const navItems = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Studios", href: "/studios", icon: Video },
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
    </Sidebar>
  );
}
