import { useGetDashboardSummary, useGetDashboardActivity } from "@workspace/api-client-react";
import { Activity, CheckCircle, Clock, Video, ArrowUpRight, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { format, formatDistanceToNow } from "date-fns";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: activity, isLoading: isLoadingActivity } = useGetDashboardActivity();

  if (isLoadingSummary) {
    return (
      <div className="w-full space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-2xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-96 w-full rounded-2xl" />
          <Skeleton className="h-96 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 w-full">
      {/* Page header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
            <span className="w-1 h-1 rounded-full bg-primary" />
            Command Center
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Real-time operations overview
          </h1>
        </div>
        <div className="text-[11px] font-mono text-muted-foreground tabular-nums">
          {format(new Date(), "EEE, MMM d · HH:mm 'UTC'X")}
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Active Projects" value={summary?.activeProjects} icon={Video} tone="primary" />
        <StatCard title="Total Tasks" value={summary?.totalTasks} icon={Activity} tone="info" />
        <StatCard title="Completed" value={summary?.completedTasks} icon={CheckCircle} tone="success" />
        <StatCard title="Overdue" value={summary?.overdueTasks} icon={Clock} tone="destructive" />
      </div>

      {/* Two-column detail */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Upcoming deadlines */}
        <Panel className="lg:col-span-3" title="Upcoming Deadlines" badge={`${summary?.upcomingDeadlines?.length ?? 0}`}>
          {summary?.upcomingDeadlines && summary.upcomingDeadlines.length > 0 ? (
            <div className="space-y-1.5">
              {summary.upcomingDeadlines.map((deadline, idx) => (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.04, duration: 0.25 }}
                  key={`${deadline.type}-${deadline.id}`}
                  className="group flex items-center justify-between gap-4 px-3 py-2.5 rounded-lg hover:bg-card/60 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate text-foreground">{deadline.name}</div>
                    <div className="text-xs text-muted-foreground truncate font-mono">{deadline.projectName}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-[11px] font-mono text-muted-foreground tabular-nums">
                      {format(new Date(deadline.dueDate), "MMM dd")}
                    </div>
                    <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <EmptyState>No upcoming deadlines.</EmptyState>
          )}
        </Panel>

        {/* Recent activity */}
        <Panel className="lg:col-span-2" title="Recent Activity" badge="LIVE" badgeTone="success">
          {isLoadingActivity ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : activity && activity.length > 0 ? (
            <div className="space-y-3.5 relative">
              {/* Timeline rail */}
              <div className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-border/70" />
              {activity.map((entry, idx) => (
                <motion.div
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.03, duration: 0.2 }}
                  key={entry.id}
                  className="flex items-start gap-3 pl-0 relative"
                >
                  <div className="relative z-10 w-[11px] h-[11px] mt-1 rounded-full bg-primary/20 ring-2 ring-background flex items-center justify-center shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-foreground leading-snug">{entry.message}</div>
                    <div className="text-[10.5px] text-muted-foreground font-mono mt-0.5 tabular-nums">
                      {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                      <span className="mx-1.5 text-border">·</span>
                      {entry.projectName}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <EmptyState>No activity yet.</EmptyState>
          )}
        </Panel>
      </div>
    </div>
  );
}

type Tone = "primary" | "info" | "success" | "destructive";
const TONE_STYLES: Record<Tone, { text: string; bg: string; glow: string }> = {
  primary:     { text: "text-primary",       bg: "bg-primary/10",       glow: "from-primary/15" },
  info:        { text: "text-blue-400",      bg: "bg-blue-500/10",      glow: "from-blue-500/15" },
  success:     { text: "text-emerald-400",   bg: "bg-emerald-500/10",   glow: "from-emerald-500/15" },
  destructive: { text: "text-red-400",       bg: "bg-red-500/10",       glow: "from-red-500/15" },
};

function StatCard({
  title, value, icon: Icon, tone,
}: { title: string; value: number | undefined; icon: LucideIcon; tone: Tone }) {
  const s = TONE_STYLES[tone];
  return (
    <div className="group relative overflow-hidden surface-card ring-hairline border border-border/70 rounded-2xl p-5 transition-all hover:border-border hover:-translate-y-0.5 hover:shadow-lg">
      <div className={`absolute -top-12 -right-12 w-32 h-32 rounded-full bg-gradient-to-br ${s.glow} to-transparent blur-2xl opacity-70`} />
      <div className="relative flex items-start justify-between">
        <div className="space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
          <div className="text-3xl font-semibold tabular-nums tracking-tight">{value ?? "—"}</div>
        </div>
        <div className={`p-2.5 rounded-xl ${s.bg} ${s.text} ring-1 ring-inset ring-current/10`}>
          <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
        </div>
      </div>
    </div>
  );
}

function Panel({
  className = "", title, badge, badgeTone, children,
}: {
  className?: string;
  title: string;
  badge?: string;
  badgeTone?: "success";
  children: React.ReactNode;
}) {
  return (
    <div className={`surface-card ring-hairline border border-border/70 rounded-2xl ${className}`}>
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border/50">
        <h2 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h2>
        {badge && (
          <span className={`text-[9.5px] font-mono uppercase tracking-[0.18em] px-1.5 py-0.5 rounded-md ${
            badgeTone === "success"
              ? "text-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-500/20"
              : "text-muted-foreground bg-muted/40 ring-1 ring-border/60"
          }`}>
            {badgeTone === "success" && (
              <span className="inline-block w-1 h-1 rounded-full bg-emerald-400 mr-1 align-middle animate-pulse" />
            )}
            {badge}
          </span>
        )}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-sm text-muted-foreground text-center py-10 font-mono">{children}</div>
  );
}
