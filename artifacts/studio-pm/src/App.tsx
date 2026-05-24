import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/app-shell";
import { MobileShell } from "@/components/layout/mobile-shell";
import { useIsMobile } from "@/hooks/use-mobile";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import Dashboard from "@/pages/dashboard";
import ProjectsList from "@/pages/projects";
import ProjectDetail from "@/pages/projects/detail";
import Tasks from "@/pages/tasks";
import Team from "@/pages/team";
import UsersAdmin from "@/pages/admin/users";
import Documents from "@/pages/documents";
import DocumentEditor from "@/pages/documents/editor";
import Login from "@/pages/login";
import Privacy from "@/pages/privacy";
import PublicShare from "@/pages/public-share";
import NotFound from "@/pages/not-found";

// Mobile-only page variants. Below 768px we swap the AppShell for the
// MobileShell and route through these instead — desktop UI is untouched.
import MobileDashboard from "@/pages/mobile/dashboard";
import MobileProjects from "@/pages/mobile/projects";
import MobileProjectDetail from "@/pages/mobile/project-detail";
import MobileTasks from "@/pages/mobile/tasks";
import MobileTeam from "@/pages/mobile/team";
import MobileDocuments from "@/pages/mobile/documents";

const queryClient = new QueryClient();

/** Desktop route table — preserved as-is. */
function DesktopRoutes() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/projects" component={ProjectsList} />
      <Route path="/projects/:id" component={ProjectDetail} />
      <Route path="/tasks" component={Tasks} />
      <Route path="/team" component={Team} />
      <Route path="/admin/users" component={UsersAdmin} />
      <Route path="/documents" component={Documents} />
      <Route path="/documents/:id/edit" component={DocumentEditor} />
      <Route component={NotFound} />
    </Switch>
  );
}

/** Mobile route table — every entry below the AppBar/TabBar shell. */
function MobileRoutes() {
  return (
    <Switch>
      <Route path="/" component={MobileDashboard} />
      <Route path="/projects" component={MobileProjects} />
      <Route path="/projects/:id" component={MobileProjectDetail} />
      <Route path="/tasks" component={MobileTasks} />
      <Route path="/team" component={MobileTeam} />
      <Route path="/admin/users" component={UsersAdmin} />
      <Route path="/documents" component={MobileDocuments} />
      {/* The document editor is desktop-only (Collabora / TipTap) — fall back to
          the desktop component so deep links still work on a phone in landscape. */}
      <Route path="/documents/:id/edit" component={DocumentEditor} />
      <Route component={NotFound} />
    </Switch>
  );
}

// Routes that intentionally never adopt the mobile layout — the document
// editor (Collabora / TipTap) and the admin user list both need the full
// desktop chrome and viewport to be usable, so we fall back to AppShell
// even on a small screen.
const DESKTOP_ONLY_PATHS = [/^\/documents\/[^/]+\/edit$/, /^\/admin\//];

function ResponsiveAuthed() {
  const isMobile = useIsMobile();
  const auth = useAuth();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (auth.status === "unauthenticated" && location !== "/login") {
      sessionStorage.setItem("studiopm.returnTo", location);
      navigate(`/login`, { replace: true });
    }
  }, [auth.status, location, navigate]);

  if (auth.status === "loading") {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-2 border-border border-t-primary animate-spin" />
      </div>
    );
  }
  if (auth.status === "unauthenticated") return null;

  const forceDesktop = DESKTOP_ONLY_PATHS.some((re) => re.test(location));

  if (isMobile && !forceDesktop) {
    return (
      <MobileShell>
        <MobileRoutes />
      </MobileShell>
    );
  }
  return (
    <AppShell>
      <DesktopRoutes />
    </AppShell>
  );
}

function Routes() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      {/* Public privacy policy — needs to be reachable from the OAuth consent
          screen and from the login page footer, so it lives outside AuthedShell. */}
      <Route path="/privacy" component={Privacy} />
      {/* Public, unauthenticated share viewer — must live outside AuthedShell. */}
      <Route path="/s/:token" component={PublicShare} />
      <Route>
        <ResponsiveAuthed />
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <div className="h-full w-full">
              <Routes />
            </div>
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
