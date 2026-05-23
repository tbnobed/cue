import {
  useGetProject, useGetProjectProgress, useListMilestones,
  getGetProjectQueryKey, getGetProjectProgressQueryKey, getListMilestonesQueryKey,
} from "@workspace/api-client-react";
import { useParams } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";

const STATUS_TONE: Record<string, string> = {
  planning:    "text-blue-400 bg-blue-500/10 ring-blue-500/20",
  in_progress: "text-primary bg-primary/10 ring-primary/20",
  on_hold:     "text-amber-400 bg-amber-500/10 ring-amber-500/20",
  completed:   "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
};

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id || "0", 10);

  const { data: project, isLoading: isLoadingStudio } = useGetProject(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) },
  });
  const { data: progress, isLoading: isLoadingProgress } = useGetProjectProgress(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectProgressQueryKey(projectId) },
  });
  const { data: milestones, isLoading: isLoadingMilestones } = useListMilestones(projectId, {
    query: { enabled: !!projectId, queryKey: getListMilestonesQueryKey(projectId) },
  });

  if (isLoadingStudio) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <Skeleton className="h-12 w-1/3 rounded-xl" />
        <Skeleton className="h-6 w-1/4 rounded-md" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="md:col-span-2 h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="surface-card ring-hairline border border-border/70 rounded-2xl p-12 text-center text-sm text-muted-foreground font-mono">
          Project not found.
        </div>
      </div>
    );
  }

  const tone = STATUS_TONE[project.status] ?? "text-muted-foreground bg-muted/40 ring-border/60";

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-mono uppercase tracking-[0.12em] px-2 py-1 rounded-md ring-1 ring-inset ${tone}`}>
            {project.status.replace("_", " ")}
          </span>
          {project.phase && (
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              · {project.phase}
            </span>
          )}
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">{project.name}</h1>
        {project.description && (
          <p className="text-muted-foreground max-w-2xl leading-relaxed">{project.description}</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Panel className="md:col-span-2" title="Deployment Progress">
          {isLoadingProgress ? <Skeleton className="h-4 w-full" /> : (
            <div className="space-y-6">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Overall completion</span>
                  <span className="font-mono tabular-nums text-primary font-semibold">{Math.round(progress?.percentComplete || 0)}%</span>
                </div>
                <Progress value={progress?.percentComplete || 0} className="h-1.5 bg-muted/40" />
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-4 pt-5 border-t border-border/50">
                {progress?.byCategory.map(cat => (
                  <div key={cat.category} className="space-y-1.5">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="capitalize text-foreground/80">{cat.category}</span>
                      <span className="text-muted-foreground tabular-nums">{cat.completed}/{cat.total}</span>
                    </div>
                    <Progress
                      value={cat.total > 0 ? (cat.completed / cat.total) * 100 : 0}
                      className="h-1 bg-muted/30"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Key Milestones">
          {isLoadingMilestones ? <Skeleton className="h-32 w-full" /> : (
            <div className="space-y-1 relative">
              <div className="absolute left-[5px] top-2 bottom-2 w-px bg-border/70" />
              {milestones?.map(m => (
                <div key={m.id} className="flex items-start gap-3 py-1.5 relative">
                  <div className="relative z-10 w-[11px] h-[11px] mt-1 rounded-full bg-primary/20 ring-2 ring-background flex items-center justify-center shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium leading-snug">{m.name}</div>
                    <div className="text-[10.5px] text-muted-foreground font-mono tabular-nums">
                      {m.dueDate ? format(new Date(m.dueDate), "MMM dd, yyyy") : "TBD"}
                      <span className="mx-1.5 text-border">·</span>
                      <span className="capitalize">{m.status}</span>
                    </div>
                  </div>
                </div>
              ))}
              {(!milestones || milestones.length === 0) && (
                <div className="text-sm text-muted-foreground font-mono text-center py-4">No milestones yet.</div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Panel({ className = "", title, children }: { className?: string; title: string; children: React.ReactNode }) {
  return (
    <div className={`surface-card ring-hairline border border-border/70 rounded-2xl ${className}`}>
      <div className="px-5 pt-4 pb-3 border-b border-border/50">
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
