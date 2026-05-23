import {
  useGetProject, useGetProjectProgress, useListMilestones,
  getGetProjectQueryKey, getGetProjectProgressQueryKey, getListMilestonesQueryKey,
} from "@workspace/api-client-react";
import { useParams } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

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
    return <div className="p-8 space-y-4"><Skeleton className="h-12 w-1/3" /><Skeleton className="h-6 w-1/4" /></div>;
  }

  if (!project) return <div className="p-8 text-center text-muted-foreground">Project not found.</div>;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="font-mono uppercase text-primary border-primary">{project.status.replace('_', ' ')}</Badge>
          <span className="text-muted-foreground font-mono text-sm">{project.phase}</span>
        </div>
        <h1 className="text-4xl font-bold tracking-tight">{project.name}</h1>
        <p className="text-muted-foreground max-w-2xl">{project.description}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 bg-card border-border">
          <CardHeader>
            <CardTitle className="font-mono uppercase tracking-wide text-sm">Deployment Progress</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingProgress ? <Skeleton className="h-4 w-full" /> : (
              <div className="space-y-6">
                <div>
                  <div className="flex justify-between text-sm mb-2 font-mono">
                    <span>Overall Completion</span>
                    <span className="text-primary">{Math.round(progress?.percentComplete || 0)}%</span>
                  </div>
                  <Progress value={progress?.percentComplete || 0} className="h-2 bg-muted" />
                </div>
                
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
                  {progress?.byCategory.map(cat => (
                    <div key={cat.category} className="space-y-1">
                      <div className="flex justify-between text-xs font-mono text-muted-foreground">
                        <span className="capitalize">{cat.category}</span>
                        <span>{cat.completed}/{cat.total}</span>
                      </div>
                      <Progress value={cat.total > 0 ? (cat.completed / cat.total) * 100 : 0} className="h-1 bg-muted" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="font-mono uppercase tracking-wide text-sm">Key Milestones</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingMilestones ? <Skeleton className="h-32 w-full" /> : (
              <div className="space-y-4">
                {milestones?.map(m => (
                  <div key={m.id} className="flex items-start gap-3 border-l-2 border-primary/30 pl-3 py-1">
                    <div>
                      <div className="font-medium text-sm">{m.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{m.dueDate ? new Date(m.dueDate).toLocaleDateString() : 'TBD'}</div>
                    </div>
                    <Badge variant="secondary" className="ml-auto text-[10px] uppercase">{m.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
