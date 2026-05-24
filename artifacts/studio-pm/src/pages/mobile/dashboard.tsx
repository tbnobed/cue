import {
  useGetDashboardSummary, useGetDashboardActivity,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import {
  Video, Activity, CheckCircle2, Clock,
  ChevronRight, Plus, Check,
} from "lucide-react";

export default function MobileDashboard() {
  const { data: summary } = useGetDashboardSummary();
  const { data: activity } = useGetDashboardActivity();

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  const upcoming = (summary?.upcomingDeadlines ?? []).slice(0, 4);
  const recent = (activity ?? []).slice(0, 6);

  return (
    <>
      <div className="mhead">
        <div className="k">Command Center</div>
        <h2>{greeting}.</h2>
        <p>Here's where things stand today.</p>
      </div>

      <div className="mstats">
        <Stat tone="violet" label="Active" value={summary?.activeProjects} sub={`${summary?.totalProjects ?? 0} total`} icon={<Video />} />
        <Stat tone="cyan" label="Tasks" value={summary?.totalTasks} sub="in flight" icon={<Activity />} />
        <Stat tone="emerald" label="Done" value={summary?.completedTasks} sub="completed" icon={<CheckCircle2 />} />
        <Stat tone="rose" label="Overdue" value={summary?.overdueTasks} sub={(summary?.overdueTasks ?? 0) > 0 ? "needs action" : "all clear"} icon={<Clock />} />
      </div>

      <div className="sect-h">
        <b>Up Next</b>
        <Link href="/tasks" className="more">All <ChevronRight /></Link>
      </div>
      {upcoming.length === 0 ? (
        <div className="m-glass" style={{ padding: "20px", textAlign: "center", fontSize: 12, color: "var(--m-text-3)" }}>
          Nothing scheduled.
        </div>
      ) : (
        upcoming.map((d) => {
          const due = new Date(d.dueDate);
          const daysOut = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
          const eta = daysOut < 0 ? `${Math.abs(daysOut)}d late` : daysOut === 0 ? "today" : `${daysOut}d`;
          return (
            <Link
              key={`${d.type}-${d.id}`}
              href={d.projectId ? `/projects/${d.projectId}` : "/projects"}
              className="mdl m-glass"
              data-testid={`mobile-deadline-${d.id}`}
            >
              <div className="dt"><b>{format(due, "dd")}</b><span>{format(due, "MMM")}</span></div>
              <div className="info"><b>{d.name}</b><span>{d.projectName}</span></div>
              <div className="eta">{eta}</div>
            </Link>
          );
        })
      )}

      <div className="sect-h">
        <b>Activity</b>
        <span className="live"><span className="dot" />Live</span>
      </div>
      <div className="mlog m-glass">
        {recent.length === 0 ? (
          <div style={{ padding: "16px 0", textAlign: "center", fontSize: 12, color: "var(--m-text-3)" }}>
            No activity yet.
          </div>
        ) : (
          recent.map((e) => {
            const cls = e.type === "task_completed" || e.type === "milestone_completed"
              ? "g-done"
              : e.type === "task_created" || e.type === "project_created"
                ? "g-add"
                : "g-upd";
            const icon = cls === "g-done" ? <Check /> : <Plus />;
            return (
              <div key={e.id} className="mact">
                <div className={`g ${cls}`}>{icon}</div>
                <div className="c">
                  <div className="t">{e.message}</div>
                  <div className="m">
                    {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
                    {e.projectName ? ` · ${e.projectName}` : ""}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

function Stat({
  tone, label, value, sub, icon,
}: { tone: "violet" | "cyan" | "emerald" | "rose"; label: string; value: number | undefined; sub: string; icon: React.ReactNode }) {
  return (
    <div className={`mstat ${tone}`} data-testid={`mobile-stat-${label.toLowerCase()}`}>
      <div className="r">
        <span className="lab">{label}</span>
        <div className="ic">{icon}</div>
      </div>
      <div className="n">{value ?? "—"}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}
