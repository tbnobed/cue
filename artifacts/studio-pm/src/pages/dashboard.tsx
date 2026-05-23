import { useGetDashboardSummary, useGetDashboardActivity } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, CheckCircle, Clock, Video } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: activity, isLoading: isLoadingActivity } = useGetDashboardActivity();

  if (isLoadingSummary) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-1 text-foreground">Command Center</h1>
        <p className="text-muted-foreground text-sm uppercase tracking-wider font-mono">Real-time Operations Overview</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Active Projects" value={summary?.activeProjects} icon={Video} color="text-primary" />
        <StatCard title="Total Tasks" value={summary?.totalTasks} icon={Activity} color="text-blue-500" />
        <StatCard title="Completed" value={summary?.completedTasks} icon={CheckCircle} color="text-green-500" />
        <StatCard title="Overdue" value={summary?.overdueTasks} icon={Clock} color="text-destructive" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg font-medium font-mono uppercase tracking-wide">Upcoming Deadlines</CardTitle>
          </CardHeader>
          <CardContent>
            {summary?.upcomingDeadlines && summary.upcomingDeadlines.length > 0 ? (
              <div className="space-y-4">
                {summary.upcomingDeadlines.map((deadline, idx) => (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    key={`${deadline.type}-${deadline.id}`} 
                    className="flex justify-between items-center p-3 rounded-md bg-background border border-border"
                  >
                    <div>
                      <div className="font-medium text-sm">{deadline.name}</div>
                      <div className="text-xs text-muted-foreground">{deadline.projectName}</div>
                    </div>
                    <div className="text-xs font-mono text-primary bg-primary/10 px-2 py-1 rounded">
                      {format(new Date(deadline.dueDate), "MMM dd")}
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-8">No upcoming deadlines.</div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg font-medium font-mono uppercase tracking-wide">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
             {isLoadingActivity ? (
               <div className="space-y-3">
                 {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
               </div>
             ) : (
               <div className="space-y-4">
                 {activity?.map((entry, idx) => (
                   <motion.div 
                     initial={{ opacity: 0, x: -10 }}
                     animate={{ opacity: 1, x: 0 }}
                     transition={{ delay: idx * 0.05 }}
                     key={entry.id} 
                     className="flex items-start gap-3 text-sm"
                   >
                     <div className="w-2 h-2 mt-1.5 rounded-full bg-primary shrink-0" />
                     <div>
                       <span className="text-foreground">{entry.message}</span>
                       <div className="text-xs text-muted-foreground font-mono mt-0.5">
                         {format(new Date(entry.createdAt), "HH:mm:ss")} · {entry.projectName}
                       </div>
                     </div>
                   </motion.div>
                 ))}
               </div>
             )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color }: any) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider font-mono mb-1">{title}</p>
          <p className="text-3xl font-bold">{value ?? "-"}</p>
        </div>
        <div className={`p-3 rounded-full bg-background border border-border ${color}`}>
          <Icon className="w-6 h-6" />
        </div>
      </CardContent>
    </Card>
  );
}
