import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background text-foreground dark">
        <AppSidebar />
        <div className="flex-1 flex flex-col w-full overflow-hidden relative">
          <header className="h-14 border-b border-border/60 bg-background/70 backdrop-blur-xl flex items-center px-5 shrink-0 justify-between sticky top-0 z-20">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
              <div className="hidden md:block h-4 w-px bg-border/80" />
              <div className="hidden md:flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                <span>Studio</span>
                <span className="text-border">/</span>
                <span className="text-foreground/80">Command</span>
              </div>
            </div>
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full border border-border/70 bg-card/50">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                System Nominal
              </span>
            </div>
          </header>
          <main className="flex-1 overflow-auto bg-transparent p-6 md:p-8">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
