import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTasks, useListProjects, useCreateTask, useUpdateTask,
  getListTasksQueryKey, getGetDashboardSummaryQueryKey, getGetDashboardActivityQueryKey, getGetProjectProgressQueryKey,
  type Task, type TaskPriority,
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { Plus, Check, X, Loader2 } from "lucide-react";
import { MobileFab } from "@/components/layout/mobile-shell";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const PRI_CLASS: Record<TaskPriority, string> = {
  critical: "pri-cr",
  high:     "pri-hi",
  medium:   "pri-md",
  low:      "pri-lo",
};
const PRI_LABEL: Record<TaskPriority, string> = {
  critical: "Crit", high: "High", medium: "Med", low: "Low",
};

type Filter = "all" | "open" | "overdue" | "done";

export default function MobileTasks() {
  const [filter, setFilter] = useState<Filter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const { data: tasks, isLoading } = useListTasks();

  const visible = useMemo(() => {
    const all = tasks ?? [];
    const now = Date.now();
    switch (filter) {
      case "open":    return all.filter((t) => t.status !== "done");
      case "done":    return all.filter((t) => t.status === "done");
      case "overdue": return all.filter((t) => t.status !== "done" && t.dueDate && new Date(t.dueDate).getTime() < now);
      default:        return all;
    }
  }, [tasks, filter]);

  return (
    <>
      <div className="mhead">
        <div className="k">Task Registry</div>
        <h2>Cross-project ops</h2>
        <p>{isLoading ? "Loading…" : `${tasks?.length ?? 0} total`}</p>
      </div>

      <div className="mfilters">
        {(["all", "open", "overdue", "done"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            className={`chip ${filter === f ? "on" : ""}`}
            onClick={() => setFilter(f)}
            data-testid={`mobile-task-filter-${f}`}
          >
            {f === "all" ? "All" : f === "open" ? "Open" : f === "overdue" ? "Overdue" : "Done"}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="m-glass" style={{ padding: 32, textAlign: "center" }}>
          <Loader2 className="w-5 h-5 animate-spin inline" />
        </div>
      ) : visible.length === 0 ? (
        <div className="mempty m-glass">
          <div className="orb" />
          <b>Nothing scheduled here yet</b>
          <span>No tasks match these filters. Tap the + to create your first one.</span>
        </div>
      ) : (
        visible.map((t) => <TaskRow key={t.id} task={t} />)
      )}

      <MobileFab label="New task" onClick={() => setCreateOpen(true)}>
        <Plus />
      </MobileFab>
      <NewTaskDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function TaskRow({ task }: { task: Task }) {
  const qc = useQueryClient();
  const update = useUpdateTask({
    mutation: {
      onSuccess: () => {
        // Task status changes ripple into dashboard counts + activity feed.
        qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        qc.invalidateQueries({ queryKey: getGetDashboardActivityQueryKey() });
      },
    },
  });
  const done = task.status === "done";
  const sub = [
    task.projectName,
    task.dueDate && format(new Date(task.dueDate), "MMM d"),
  ].filter(Boolean).join(" · ");

  return (
    <div className="mtask m-glass" data-testid={`mobile-task-${task.id}`}>
      <button
        type="button"
        className={`cb ${done ? "done" : ""}`}
        aria-label={done ? "Mark not done" : "Mark done"}
        onClick={(e) => {
          e.stopPropagation();
          update.mutate({
            id: task.id,
            data: { status: done ? "todo" : "done" },
          });
        }}
        data-testid={`mobile-task-toggle-${task.id}`}
      >
        {done && <Check />}
      </button>
      <div className={`tx ${done ? "done" : ""}`}>
        <b>{task.title}</b>
        {sub && <span>{sub}</span>}
      </div>
      {!done && task.priority !== "low" && (
        <span className={`pri ${PRI_CLASS[task.priority]}`}>{PRI_LABEL[task.priority]}</span>
      )}
    </div>
  );
}

function NewTaskDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: projects } = useListProjects();
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [priority, setPriority] = useState<TaskPriority>("medium");

  const create = useCreateTask({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        qc.invalidateQueries({ queryKey: getGetDashboardActivityQueryKey() });
        toast({ title: "Task created" });
        setTitle(""); setProjectId(""); setPriority("medium");
        onOpenChange(false);
      },
      onError: (err) => toast({ title: "Couldn't create", description: String(err), variant: "destructive" }),
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New task</DialogTitle></DialogHeader>
        <form
          className="space-y-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim() || !projectId) return;
            create.mutate({
              data: {
                title: title.trim(),
                projectId: parseInt(projectId),
                priority,
                status: "todo",
                category: "general",
              },
            });
          }}
        >
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus data-testid="input-mobile-task-title" />
          </div>
          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder="Pick a project" /></SelectTrigger>
              <SelectContent>
                {(projects ?? []).map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              <X className="w-4 h-4 mr-1" />Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || !projectId || create.isPending} data-testid="button-mobile-create-task">
              {create.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
