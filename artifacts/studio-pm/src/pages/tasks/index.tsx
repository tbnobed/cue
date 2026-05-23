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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, X, AlertTriangle, Clock, CheckCircle2, Circle, Loader2, Eye, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_OPTIONS = ["todo", "in_progress", "blocked", "review", "done"] as const;
const PRIORITY_OPTIONS = ["low", "medium", "high", "critical"] as const;
const CATEGORY_OPTIONS = ["construction", "electrical", "av", "it", "network", "acoustics", "furnishing", "signage", "general"] as const;

type Status = typeof STATUS_OPTIONS[number];
type Priority = typeof PRIORITY_OPTIONS[number];

const STATUS_COLORS: Record<Status, string> = {
  todo: "text-muted-foreground border-muted-foreground/40",
  in_progress: "text-blue-400 border-blue-400/50",
  blocked: "text-red-400 border-red-400/50",
  review: "text-amber-400 border-amber-400/50",
  done: "text-green-400 border-green-400/50",
};

const STATUS_ICONS: Record<Status, React.ReactNode> = {
  todo: <Circle className="w-3 h-3" />,
  in_progress: <Loader2 className="w-3 h-3 animate-spin" />,
  blocked: <AlertTriangle className="w-3 h-3" />,
  review: <Eye className="w-3 h-3" />,
  done: <CheckCircle2 className="w-3 h-3" />,
};

const PRIORITY_COLORS: Record<Priority, string> = {
  low: "text-muted-foreground",
  medium: "text-blue-400",
  high: "text-amber-400",
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
  const [detailTask, setDetailTask] = useState<number | null>(null);
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
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Task Registry</h1>
          <p className="text-muted-foreground text-sm uppercase tracking-wider font-mono">Cross-Project Operations</p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-primary text-primary-foreground hover:bg-primary/90 font-mono uppercase tracking-wide gap-2"
        >
          <Plus className="w-4 h-4" />
          New Task
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={filterStatus || "all"} onValueChange={v => setFilterStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="w-36 h-8 text-xs font-mono bg-card border-border">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterCategory || "all"} onValueChange={v => setFilterCategory(v === "all" ? "" : v)}>
          <SelectTrigger className="w-36 h-8 text-xs font-mono bg-card border-border">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterStudio || "all"} onValueChange={v => setFilterStudio(v === "all" ? "" : v)}>
          <SelectTrigger className="w-44 h-8 text-xs font-mono bg-card border-border">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>

        {filterCount > 0 && (
          <Button variant="ghost" size="sm" className="h-8 text-xs font-mono text-muted-foreground gap-1"
            onClick={() => { setFilterStatus(""); setFilterCategory(""); setFilterStudio(""); }}>
            <X className="w-3 h-3" /> Clear ({filterCount})
          </Button>
        )}

        <span className="ml-auto text-xs font-mono text-muted-foreground">
          {tasks?.length ?? 0} tasks
        </span>
      </div>

      {/* Task List */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : tasks?.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground font-mono text-sm uppercase tracking-wider">
          No tasks found
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {tasks?.map((task, idx) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ delay: idx * 0.03 }}
              >
                <Card className="border-border bg-card hover:bg-card/80 transition-colors">
                  <CardContent className="p-4 flex items-center gap-4">
                    {/* Status selector */}
                    <Select value={task.status} onValueChange={v => handleStatusChange(task.id, v)}>
                      <SelectTrigger className={`w-[130px] h-7 text-xs font-mono border ${STATUS_COLORS[task.status as Status] ?? ""} bg-transparent`}>
                        <div className="flex items-center gap-1.5">
                          {STATUS_ICONS[task.status as Status]}
                          <span className="uppercase">{task.status.replace("_", " ")}</span>
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map(s => (
                          <SelectItem key={s} value={s}>
                            <span className="capitalize">{s.replace("_", " ")}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{task.title}</div>
                      <div className="text-xs text-muted-foreground font-mono flex gap-2 flex-wrap mt-0.5">
                        <span className="text-primary/80">{task.projectName}</span>
                        {task.category && <span>· {task.category}</span>}
                        {task.milestoneName && <span>· {task.milestoneName}</span>}
                        {task.assigneeName && <span>· {task.assigneeName}</span>}
                        {task.dueDate && (
                          <span className={`flex items-center gap-1 ${new Date(task.dueDate) < new Date() && task.status !== "done" ? "text-red-400" : ""}`}>
                            <Clock className="w-2.5 h-2.5" />
                            {task.dueDate}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Priority */}
                    <span className={`text-xs font-mono uppercase ${PRIORITY_COLORS[task.priority as Priority]}`}>
                      {task.priority}
                    </span>

                    {/* Category badge */}
                    <Badge variant="outline" className="font-mono text-[10px] uppercase hidden sm:flex">
                      {task.category}
                    </Badge>

                    {/* Delete */}
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
                      onClick={() => handleDelete(task.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Create Task Modal */}
      <Dialog open={createOpen} onOpenChange={o => { setCreateOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="bg-card border-border max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-wide text-primary">New Task</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label className="text-xs font-mono uppercase text-muted-foreground">Title *</Label>
              <Input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Task title"
                className="bg-background border-border"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-mono uppercase text-muted-foreground">Description</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="What needs to be done..."
                className="bg-background border-border resize-none h-20"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs font-mono uppercase text-muted-foreground">Project *</Label>
                <Select value={form.projectId} onValueChange={v => {
                  setForm(f => ({ ...f, projectId: v, milestoneId: "" }));
                  setMilestoneStudio(parseInt(v));
                }}>
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-mono uppercase text-muted-foreground">Milestone</Label>
                <Select
                  value={form.milestoneId || NONE_VALUE}
                  onValueChange={v => setForm(f => ({ ...f, milestoneId: v === NONE_VALUE ? "" : v }))}
                  disabled={!form.projectId}
                >
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue placeholder="Select milestone" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>None</SelectItem>
                    {milestones?.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-mono uppercase text-muted-foreground">Assign to</Label>
              <Select value={form.assigneeId || NONE_VALUE} onValueChange={v => setForm(f => ({ ...f, assigneeId: v === NONE_VALUE ? "" : v }))}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>Unassigned</SelectItem>
                  {members?.map(m => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.name} <span className="text-muted-foreground ml-1 text-xs uppercase">· {m.role}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label className="text-xs font-mono uppercase text-muted-foreground">Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-mono uppercase text-muted-foreground">Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-mono uppercase text-muted-foreground">Category</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-mono uppercase text-muted-foreground">Due Date</Label>
              <Input
                type="date"
                value={form.dueDate}
                onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                className="bg-background border-border"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm(); }} className="font-mono">
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="bg-primary text-primary-foreground font-mono gap-2"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
