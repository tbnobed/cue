import { useState } from "react";
import { useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProject, useGetProjectProgress, useListMilestones, useListTasks,
  useListProjectMembers, useUpdateTask, useListDocuments,
  getGetProjectQueryKey, getGetProjectProgressQueryKey,
  getListMilestonesQueryKey, getListProjectMembersQueryKey, getListDocumentsQueryKey,
  getListTasksQueryKey, getGetDashboardSummaryQueryKey, getGetDashboardActivityQueryKey,
  type Task, type TaskPriority, type Document,
} from "@workspace/api-client-react";
import { Check, Loader2, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { useMobileTitle } from "@/components/layout/mobile-shell";
import { useOpenDocument } from "@/lib/open-document";

type Tab = "tasks" | "milestones" | "crew" | "docs";

const STATUS_LABEL: Record<string, string> = {
  in_progress: "In Progress",
  planning:    "Planning",
  completed:   "Completed",
  on_hold:     "On Hold",
};

const PRI_CLASS: Record<TaskPriority, string> = {
  critical: "pri-cr", high: "pri-hi", medium: "pri-md", low: "pri-lo",
};
const PRI_LABEL: Record<TaskPriority, string> = {
  critical: "Crit", high: "High", medium: "Med", low: "Low",
};

export default function MobileProjectDetail() {
  const [, params] = useRoute("/projects/:id");
  const id = parseInt(params?.id ?? "0");

  const { data: project } = useGetProject(id, {
    query: { enabled: id > 0, queryKey: getGetProjectQueryKey(id) },
  });
  const { data: progress } = useGetProjectProgress(id, {
    query: { enabled: id > 0, queryKey: getGetProjectProgressQueryKey(id) },
  });
  const { data: milestones } = useListMilestones(id, {
    query: { enabled: id > 0, queryKey: getListMilestonesQueryKey(id) },
  });
  const { data: tasks } = useListTasks({ projectId: id });
  const { data: crew } = useListProjectMembers(id, {
    query: { enabled: id > 0, queryKey: getListProjectMembersQueryKey(id) },
  });
  const docsParams = { projectId: id, includeTasks: true };
  const { data: docs } = useListDocuments(docsParams, {
    query: { enabled: id > 0, queryKey: getListDocumentsQueryKey(docsParams) },
  });

  const [tab, setTab] = useState<Tab>("tasks");

  useMobileTitle({
    title: "Project",
    subtitle: project?.name ?? "Loading…",
    backHref: "/projects",
  });

  if (!project) {
    return (
      <div className="m-glass" style={{ padding: 32, textAlign: "center" }}>
        <Loader2 className="w-5 h-5 animate-spin inline" />
      </div>
    );
  }

  const pct = progress?.percentComplete ?? 0;

  return (
    <>
      <div className="detail-hero">
        <span className="mtag"><span className="dot" />{STATUS_LABEL[project.status] ?? project.status}</span>
        <h2>{project.name}</h2>
        {project.description && <p>{project.description}</p>}
        <div className="dh-meta">
          <div>Progress<b>{Math.round(pct)}%</b></div>
          <div>Location<b style={{ fontSize: 13 }}>{project.location || "—"}</b></div>
          <div>Go-Live<b style={{ fontSize: 13 }}>{project.targetDate ? format(new Date(project.targetDate), "MMM d") : "—"}</b></div>
        </div>
      </div>

      <div className="seg" role="tablist">
        {(["tasks", "milestones", "crew", "docs"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? "on" : ""}
            onClick={() => setTab(t)}
            role="tab"
            aria-selected={tab === t}
            data-testid={`mobile-detail-tab-${t}`}
          >
            {t === "tasks" ? "Tasks" : t === "milestones" ? "Milestones" : t === "crew" ? "Crew" : "Docs"}
          </button>
        ))}
      </div>

      {tab === "tasks" && (
        <TasksList tasks={tasks ?? []} projectId={id} />
      )}
      {tab === "milestones" && (
        <MilestonesList items={milestones ?? []} />
      )}
      {tab === "crew" && (
        <CrewList items={crew ?? []} />
      )}
      {tab === "docs" && (
        <DocsList items={docs ?? []} />
      )}
    </>
  );
}

function TasksList({ tasks, projectId }: { tasks: Task[]; projectId: number }) {
  const qc = useQueryClient();
  const update = useUpdateTask({
    mutation: {
      onSuccess: () => {
        // Mirror desktop: ripple task changes into dashboard + per-project progress.
        qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        qc.invalidateQueries({ queryKey: getGetDashboardActivityQueryKey() });
        qc.invalidateQueries({ queryKey: getGetProjectProgressQueryKey(projectId) });
      },
    },
  });
  if (tasks.length === 0) {
    return <Empty title="No tasks yet" sub="Add one from the Tasks tab." />;
  }
  return (
    <>
      {tasks.map((t) => {
        const done = t.status === "done";
        return (
          <div key={t.id} className="mtask m-glass" data-testid={`mobile-detail-task-${t.id}`}>
            <button
              type="button"
              className={`cb ${done ? "done" : ""}`}
              aria-label={done ? "Mark not done" : "Mark done"}
              onClick={() => update.mutate({ id: t.id, data: { status: done ? "todo" : "done" } })}
            >
              {done && <Check />}
            </button>
            <div className={`tx ${done ? "done" : ""}`}>
              <b>{t.title}</b>
              <span>{t.category}{t.dueDate ? ` · ${format(new Date(t.dueDate), "MMM d")}` : ""}</span>
            </div>
            {!done && t.priority !== "low" && (
              <span className={`pri ${PRI_CLASS[t.priority]}`}>{PRI_LABEL[t.priority]}</span>
            )}
          </div>
        );
      })}
    </>
  );
}

function MilestonesList({ items }: { items: Array<{ id: number; name: string; dueDate?: string | null; status: string }> }) {
  if (items.length === 0) return <Empty title="No milestones" sub="Plan project gates from the desktop." />;
  return (
    <div className="tline" style={{ marginTop: 6 }}>
      {items.map((m) => {
        const overdue = m.dueDate && new Date(m.dueDate).getTime() < Date.now() && m.status !== "completed";
        const cls = m.status === "completed" ? "e" : overdue ? "r" : "v";
        return (
          <div key={m.id} className={`tms ${cls}`}>
            <div className="nd" />
            <div className="tms-c">
              <b>{m.name}</b>
              <div className="d">
                {m.dueDate ? format(new Date(m.dueDate), "MMM d, yyyy") : "no date"}
                {overdue && <span className="over">overdue</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CrewList({ items }: { items: Array<{ id: number; name: string; role: string; title?: string | null }> }) {
  if (items.length === 0) return <Empty title="No crew assigned" sub="Assign members from the desktop." />;
  return (
    <div className="mteam">
      {items.map((c) => {
        const inits = c.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
        return (
          <div key={c.id} className="row m-glass">
            <div className="av">{inits || "?"}</div>
            <div className="nm">
              <b>{c.name}</b>
              <span>
                <span className="r">{c.role}</span>
                {c.title && <> · {c.title}</>}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}


const DOC_LABEL: Record<string, string> = {
  spec: "SPC", plan: "PLN", permit: "PMT", vendor: "VEN",
  as_built: "ASB", safety: "SFT", general: "DOC",
};
const DOC_TONE: Record<string, "" | "violet" | "blue" | "amber"> = {
  spec: "", plan: "blue", permit: "amber", vendor: "violet",
  as_built: "", safety: "amber", general: "blue",
};

function DocsList({ items }: { items: Document[] }) {
  const open = useOpenDocument();
  if (items.length === 0) {
    return <Empty title="No documents yet" sub="Upload specs, plans, and permits from the desktop." />;
  }
  return (
    <>
      {items.map((d) => (
        <button
          key={d.id}
          type="button"
          onClick={() => open(d)}
          className="mdoc m-glass"
          data-testid={`mobile-detail-doc-${d.id}`}
          style={{ width: "100%", textAlign: "left" }}
        >
          <div className={`di ${DOC_TONE[d.category] ?? ""}`}>{DOC_LABEL[d.category] ?? "DOC"}</div>
          <div className="dn">
            <b>{d.title}</b>
            <div className="m"><span className="ty">{d.category}</span>{d.version ? `v${d.version}` : "—"}</div>
          </div>
          <div className="go"><ChevronRight /></div>
        </button>
      ))}
    </>
  );
}

function Empty({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mempty m-glass">
      <div className="orb" />
      <b>{title}</b>
      <span>{sub}</span>
    </div>
  );
}
