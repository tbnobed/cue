import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/app-shell";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import Dashboard from "@/pages/dashboard";
import StudiosList from "@/pages/studios";
import StudioDetail from "@/pages/studios/detail";
import Tasks from "@/pages/tasks";
import Timeline from "@/pages/timeline";
import Team from "@/pages/team";
import Documents from "@/pages/documents";
import DocumentEditor from "@/pages/documents/editor";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function AuthedShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (auth.status === "unauthenticated" && location !== "/login") {
      // Preserve the page the user was trying to reach so we can return them
      // there after sign-in.
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
  if (auth.status === "unauthenticated") return null; // about to redirect
  return <AppShell>{children}</AppShell>;
}

function Routes() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route>
        <AuthedShell>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/studios" component={StudiosList} />
            <Route path="/studios/:id" component={StudioDetail} />
            <Route path="/tasks" component={Tasks} />
            <Route path="/timeline" component={Timeline} />
            <Route path="/team" component={Team} />
            <Route path="/documents" component={Documents} />
            <Route path="/documents/:id/edit" component={DocumentEditor} />
            <Route component={NotFound} />
          </Switch>
        </AuthedShell>
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
            <div className="dark h-full w-full">
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
