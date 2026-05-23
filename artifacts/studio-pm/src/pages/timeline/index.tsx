import { useListProjects, useListMilestones, getListMilestonesQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { CalendarDays } from "lucide-react";
import { format } from "date-fns";

export default function Timeline() {
  const { data: projects, isLoading } = useListProjects();

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <PageHeader eyebrow="Master Timeline" title="Milestone matrix across all projects" />

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-44 w-full rounded-2xl" />)}
        </div>
      ) : projects && projects.length > 0 ? (
        <div className="space-y-5">
          {projects.map((project, idx) => (
            <motion.section
              key={project.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05, duration: 0.25 }}
              className="surface-card ring-hairline border border-border/70 rounded-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center shrink-0">
                    <CalendarDays className="w-4 h-4 text-primary" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                      Project
                    </div>
                    <h3 className="text-base font-semibold truncate tracking-tight">{project.name}</h3>
                  </div>
                </div>
                <StatusPill status={project.status} />
              </div>
              <div className="p-5">
                <StudioMilestones projectId={project.id} />
              </div>
            </motion.section>
          ))}
        </div>
      ) : (
        <EmptyState message="No projects yet — create one to start tracking milestones." />
      )}
    </div>
  );
}

function StudioMilestones({ projectId }: { projectId: number }) {
  const { data: milestones, isLoading } = useListMilestones(projectId, {
    query: { enabled: !!projectId, queryKey: getListMilestonesQueryKey(projectId) },
  });

  if (isLoading) return <Skeleton className="h-20 w-full rounded-xl" />;

  if (!milestones || milestones.length === 0) {
    return (
      <div className="text-sm text-muted-foreground font-mono text-center py-6 border border-dashed border-border/60 rounded-xl">
        No milestones set
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
      {milestones.map((m, idx) => {
        const overdue = m.dueDate ? new Date(m.dueDate) < new Date() : false;
        return (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.03 }}
            className="group shrink-0 w-64 relative bg-background/60 hover:bg-background border border-border/70 hover:border-border rounded-xl p-4 transition-all"
          >
            <span className={`absolute top-3 bottom-3 left-0 w-[3px] rounded-r-full ${overdue ? "bg-red-500/80" : "bg-primary"}`} />
            <div className="pl-3 space-y-1">
              <div className="text-sm font-medium leading-snug">{m.name}</div>
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground tabular-nums">
                <CalendarDays className="w-3 h-3" />
                {m.dueDate ? format(new Date(m.dueDate), "MMM dd, yyyy") : "TBD"}
                {overdue && <span className="text-red-400 ml-1">· overdue</span>}
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between flex-wrap gap-3">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
          <span className="w-1 h-1 rounded-full bg-primary" />
          {eyebrow}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
      </div>
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    planning:    "text-blue-400 bg-blue-500/10 ring-blue-500/20",
    in_progress: "text-primary bg-primary/10 ring-primary/20",
    on_hold:     "text-amber-400 bg-amber-500/10 ring-amber-500/20",
    completed:   "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
  };
  const cls = map[status] ?? "text-muted-foreground bg-muted/40 ring-border/60";
  return (
    <span className={`text-[10px] font-mono uppercase tracking-[0.12em] px-2 py-1 rounded-md ring-1 ring-inset ${cls}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="surface-card ring-hairline border border-border/70 rounded-2xl p-12 text-center text-sm text-muted-foreground font-mono">
      {message}
    </div>
  );
}
