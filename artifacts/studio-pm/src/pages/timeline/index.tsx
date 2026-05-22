import { useListStudios, useListMilestones } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Timeline() {
  const { data: studios, isLoading } = useListStudios();

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Master Timeline</h1>
          <p className="text-muted-foreground text-sm uppercase tracking-wider font-mono">Milestone Matrix</p>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="space-y-6">
          {studios?.map(studio => (
            <Card key={studio.id} className="border-border bg-card">
              <CardContent className="p-6">
                <h3 className="font-bold text-lg mb-4">{studio.name}</h3>
                <StudioMilestones studioId={studio.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StudioMilestones({ studioId }: { studioId: number }) {
  const { data: milestones, isLoading } = useListMilestones(studioId, { query: { enabled: !!studioId } });

  if (isLoading) return <Skeleton className="h-12 w-full" />;

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {milestones?.map(m => (
        <div key={m.id} className="shrink-0 w-64 border border-border p-3 rounded-md bg-background relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
          <div className="font-medium text-sm pl-2">{m.name}</div>
          <div className="text-xs text-muted-foreground font-mono pl-2">
            {m.dueDate ? new Date(m.dueDate).toLocaleDateString() : 'TBD'}
          </div>
        </div>
      ))}
      {(!milestones || milestones.length === 0) && (
         <div className="text-sm text-muted-foreground">No milestones</div>
      )}
    </div>
  );
}
