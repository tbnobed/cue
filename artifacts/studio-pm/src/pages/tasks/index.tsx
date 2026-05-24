import {
  useListTasks,
  useListProjects,
  useListMembers,
  useListMilestones,
  getListMilestonesQueryKey,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  getListTasksQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, X, AlertTriangle, Clock, CheckCircle2, Circle, Loader2, Eye, Trash2 } from "lucide-react";
import { ShareDialog } from "@/components/share-dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const STATUS_OPTIONS = ["todo", "in_progress", "blocked", "review", "done"] as const;
const PRIORITY_OPTIONS = ["low", "medium", "high", "critical"] as const;
const CATEGORY_OPTIONS = ["construction", "electrical", "av", "it", "network", "acoustics", "furnishing", "signage", "general"] as const;

type Status = typeof STATUS_OPTIONS[number];
type Priority = typeof PRIORITY_OPTIONS[number];

const STATUS_TONE: Record<Status, string> = {
  todo:        "text-muted-foreground bg-muted/40 ring-border/60",
  in_progress: "text-blue-400 bg-blue-500/10 ring-blue-500/20",
  blocked:     "text-red-400 bg-red-500/10 ring-red-500/20",
  review:      "text-amber-400 bg-amber-500/10 ring-amber-500/20",
  done:        "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
};

const STATUS_ICONS: Record<Status, React.ReactNode> = {
  todo: <Circle className="w-3 h-3" />,
  in_progress: <Loader2 className="w-3 h-3 animate-spin" />,
  blocked: <AlertTriangle className="w-3 h-3" />,
  review: <Eye className="w-3 h-3" />,
  done: <CheckCircle2 className="w-3 h-3" />,
};

const PRIORITY_TONE: Record<Priority, string> = {
  low:      "text-muted-foreground",
  medium:   "text-blue-400",
  high:     "text-amber-400",
  critical: "text-red-400",
};

const NONE_VALUE = "__none__";

export default function Tasks() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterStudio, setFilterStudio] = useState<string>("");

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    title: "", description: "", projectId: "", milestoneId: "", assigneeId: "",
    status: "todo", priority: "medium", category: "general", dueDate: "",
  });
  const [milestoneStudio, setMilestoneStudio] = useState<number | null>(null);

  const params: Record<string, string | number> = {};
  if (filterStatus) params.status = filterStatus;
  if (filterCategory) params.category = filterCategory;
  if (filterStudio) params.projectId = parseInt(filterStudio);

  const { data: tasks, isLoading } = useListTasks(params as any);
  const { data: projects } = useListProjects();
  const { data: members } = useListMembers();
  const { data: milestones } = useListMilestones(milestoneStudio ?? 0, {
    query: {
      enabled: !!milestoneStudio,
      queryKey: getListMilestonesQueryKey(milestoneStudio ?? 0),
    },
  });

  const createMutation = useCreateTask();
  const updateMutation = useUpdateTask();
  const deleteMutation = useDeleteTask();

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(params as any) });
    // Any task change can shift completion counts on the project's progress
    // card. We don't know which project the affected task belongs to (could
    // even have moved between projects), so invalidate every cached
    // `/projects/:id/progress` query in one shot via predicate.
    queryClient.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey[0];
        return typeof k === "string" && k.startsWith("/projects/") && k.endsWith("/progress");
      },
    });
  }

  function resetForm() {
    setForm({ title: "", description: "", projectId: "", milestoneId: "", assigneeId: "", status: "todo", priority: "medium", category: "general", dueDate: "" });
    setMilestoneStudio(null);
  }

  async function handleCreate() {
    if (!form.title.trim() || !form.projectId) {
      toast({ title: "Title and Project are required", variant: "destructive" });
      return;
    }
    try {
      await createMutation.mutateAsync({
        data: {
          title: form.title,
          description: form.description || undefined,
          projectId: parseInt(form.projectId),
          milestoneId: form.milestoneId ? parseInt(form.milestoneId) : undefined,
          assigneeId: form.assigneeId ? parseInt(form.assigneeId) : undefined,
          status: form.status as any,
          priority: form.priority as any,
          category: form.category as any,
          dueDate: form.dueDate || undefined,
        },
      });
      toast({ title: "Task created" });
      setCreateOpen(false);
      resetForm();
      invalidate();
    } catch {
      toast({ title: "Failed to create task", variant: "destructive" });
    }
  }

  async function handleStatusChange(taskId: number, status: string) {
    try {
      await updateMutation.mutateAsync({ id: taskId, data: { status: status as any } });
      invalidate();
    } catch {
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  }

  async function handleDelete(taskId: number) {
    try {
      await deleteMutation.mutateAsync({ id: taskId });
      toast({ title: "Task deleted" });
      invalidate();
    } catch {
      toast({ title: "Failed to delete task", variant: "destructive" });
    }
  }

  const filterCount = [filterStatus, filterCategory, filterStudio].filter(Boolean).length;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
            <span className="w-1 h-1 rounded-full bg-primary" />
            Task Registry
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Cross-project operations</h1>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2 h-9" data-testid="button-new-task">
          <Plus className="w-4 h-4" />
          New Task
        </Button>
      </div>

      {/* Filters */}
      <div className="surface-card ring-hairline border border-border/70 rounded-xl p-3 flex flex-wrap gap-2 items-center">
        <Select value={filterStatus || "all"} onValueChange={v => setFilterStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="w-36 h-8 text-xs bg-background/60">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterCategory || "all"} onValueChange={v => setFilterCategory(v === "all" ? "" : v)}>
          <SelectTrigger className="w-36 h-8 text-xs bg-background/60">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterStudio || "all"} onValueChange={v => setFilterStudio(v === "all" ? "" : v)}>
          <SelectTrigger className="w-44 h-8 text-xs bg-background/60">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {projects?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>

        {filterCount > 0 && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground gap-1"
            onClick={() => { setFilterStatus(""); setFilterCategory(""); setFilterStudio(""); }}>
            <X className="w-3 h-3" /> Clear ({filterCount})
          </Button>
        )}

        <span className="ml-auto text-[11px] font-mono text-muted-foreground tabular-nums">
          {tasks?.length ?? 0} {(tasks?.length ?? 0) === 1 ? "task" : "tasks"}
        </span>
      </div>

      {/* Task List */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      ) : tasks?.length === 0 ? (
        <div className="surface-card ring-hairline border border-border/70 rounded-2xl p-12 text-center text-sm text-muted-foreground font-mono">
          No tasks match these filters.
        </div>
      ) : (
        <div className="surface-card ring-hairline border border-border/70 rounded-2xl overflow-hidden divide-y divide-border/40">
          <AnimatePresence initial={false}>
            {tasks?.map((task, idx) => {
              const tone = STATUS_TONE[task.status as Status] ?? STATUS_TONE.todo;
              const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "done";
              return (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ delay: Math.min(idx * 0.02, 0.2) }}
                  className="group flex items-center gap-4 px-4 py-3 hover:bg-background/40 transition-colors"
                >
                  {/* Status selector */}
                  <Select value={task.status} onValueChange={v => handleStatusChange(task.id, v)}>
                    <SelectTrigger className={`w-[132px] h-7 text-[11px] font-medium bg-transparent rounded-md ring-1 ring-inset border-0 ${tone}`}>
                      <div className="flex items-center gap-1.5">
                        {STATUS_ICONS[task.status as Status]}
                        <span className="capitalize">{task.status.replace("_", " ")}</span>
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map(s => (
                        <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate text-foreground">{task.title}</div>
                    <div className="text-[11px] text-muted-foreground font-mono flex gap-1.5 flex-wrap mt-0.5 items-center">
                      <span className="text-foreground/70">{task.projectName}</span>
                      {task.category && <><span className="text-border">·</span><span className="capitalize">{task.category}</span></>}
                      {task.milestoneName && <><span className="text-border">·</span><span>{task.milestoneName}</span></>}
                      {task.assigneeName && <><span className="text-border">·</span><span>{task.assigneeName}</span></>}
                      {task.dueDate && (
                        <>
                          <span className="text-border">·</span>
                          <span className={`flex items-center gap-1 tabular-nums ${isOverdue ? "text-red-400" : ""}`}>
                            <Clock className="w-2.5 h-2.5" />
                            {format(new Date(task.dueDate), "MMM dd")}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Priority */}
                  <span className={`text-[10px] font-mono uppercase tracking-[0.12em] ${PRIORITY_TONE[task.priority as Priority]}`}>
                    {task.priority}
                  </span>

                  {/* Share */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <ShareDialog resourceType="task" resourceId={task.id} resourceTitle={task.title} />
                  </div>

                  {/* Delete */}
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleDelete(task.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Create Task Modal */}
      <Dialog open={createOpen} onOpenChange={o => { setCreateOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Title *</Label>
              <Input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Task title"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="What needs to be done…"
                className="resize-none h-20"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Project *</Label>
                <Select value={form.projectId} onValueChange={v => {
                  setForm(f => ({ ...f, projectId: v, milestoneId: "" }));
                  setMilestoneStudio(parseInt(v));
                }}>
                  <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                  <SelectContent>
                    {projects?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Milestone</Label>
                <Select
                  value={form.milestoneId || NONE_VALUE}
                  onValueChange={v => setForm(f => ({ ...f, milestoneId: v === NONE_VALUE ? "" : v }))}
                  disabled={!form.projectId}
                >
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>None</SelectItem>
                    {milestones?.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Assign to</Label>
              <Select value={form.assigneeId || NONE_VALUE} onValueChange={v => setForm(f => ({ ...f, assigneeId: v === NONE_VALUE ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>Unassigned</SelectItem>
                  {members?.map(m => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.name} <span className="text-muted-foreground ml-1 text-xs capitalize">· {m.role}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Category</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Due date</Label>
              <Input
                type="date"
                value={form.dueDate}
                onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => { setCreateOpen(false); resetForm(); }}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} className="gap-2">
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
