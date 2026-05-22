import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/app-shell";
import Dashboard from "@/pages/dashboard";
import StudiosList from "@/pages/studios";
import StudioDetail from "@/pages/studios/detail";
import Tasks from "@/pages/tasks";
import Timeline from "@/pages/timeline";
import Team from "@/pages/team";
import Documents from "@/pages/documents";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/studios" component={StudiosList} />
        <Route path="/studios/:id" component={StudioDetail} />
        <Route path="/tasks" component={Tasks} />
        <Route path="/timeline" component={Timeline} />
        <Route path="/team" component={Team} />
        <Route path="/documents" component={Documents} />
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <div className="dark h-full w-full">
            <Router />
          </div>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
