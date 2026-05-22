import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background text-foreground dark">
        <AppSidebar />
        <div className="flex-1 flex flex-col w-full overflow-hidden relative">
          <header className="h-14 border-b border-border bg-card flex items-center px-4 shrink-0 justify-between">
            <SidebarTrigger />
            <div className="flex items-center gap-2">
              <div className="text-xs uppercase font-mono tracking-widest text-muted-foreground flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]"></span>
                System Nominal
              </div>
            </div>
          </header>
          <main className="flex-1 overflow-auto bg-background p-6">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
