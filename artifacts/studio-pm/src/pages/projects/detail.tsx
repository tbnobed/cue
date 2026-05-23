import {
  useGetProject, useGetProjectProgress, useListMilestones,
  useListTasks, useCreateTask, useUpdateTask, useDeleteTask,
  useListMembers, useListDocuments, useDeleteDocument,
  useListFolders, useCreateFolder, useDeleteFolder,
  useUpdateProject, useDeleteProject,
  useCreateMilestone, useUpdateMilestone, useDeleteMilestone,
  getGetProjectQueryKey, getGetProjectProgressQueryKey, getListMilestonesQueryKey,
  getListTasksQueryKey, getListDocumentsQueryKey, getListFoldersQueryKey,
  getListProjectsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useState, useRef, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Upload, FolderPlus, Folder, FolderOpen, ChevronRight,
  Trash2, ExternalLink, PenLine, Loader2, Circle, Loader, Eye, CheckCircle2, AlertTriangle,
  FileText, FileSpreadsheet, FileImage, FileCode, FileArchive, Home, Settings,
} from "lucide-react";

const STATUS_TONE: Record<string, string> = {
  planning:    "text-blue-400 bg-blue-500/10 ring-blue-500/20",
  in_progress: "text-primary bg-primary/10 ring-primary/20",
  on_hold:     "text-amber-400 bg-amber-500/10 ring-amber-500/20",
  completed:   "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
};

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id || "0", 10);

  const { data: project, isLoading } = useGetProject(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) },
  });

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <Skeleton className="h-12 w-1/3 rounded-xl" />
        <Skeleton className="h-6 w-1/4 rounded-md" />
        <Skeleton className="h-10 w-72 rounded-xl" />
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
    <div className="max-w-7xl mx-auto space-y-7">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-3 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-mono uppercase tracking-[0.12em] px-2 py-1 rounded-md ring-1 ring-inset ${tone}`}>
              {project.status.replace("_", " ")}
            </span>
            {project.phase && (
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                · {project.phase}
              </span>
            )}
            {project.location && (
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                · {project.location}
              </span>
            )}
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">{project.name}</h1>
          {project.description && (
            <p className="text-muted-foreground max-w-2xl leading-relaxed">{project.description}</p>
          )}
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-mono text-muted-foreground tabular-nums pt-1">
            {project.startDate && <span>Start: <span className="text-foreground/80">{format(new Date(project.startDate), "MMM dd, yyyy")}</span></span>}
            {project.targetDate && <span>Target: <span className="text-foreground/80">{format(new Date(project.targetDate), "MMM dd, yyyy")}</span></span>}
            {project.completedDate && <span>Completed: <span className="text-foreground/80">{format(new Date(project.completedDate), "MMM dd, yyyy")}</span></span>}
            {project.budget != null && <span>Budget: <span className="text-foreground/80">${Number(project.budget).toLocaleString()}</span></span>}
          </div>
        </div>
        <EditProjectButton project={project} />
      </div>

      <Tabs defaultValue="overview" className="space-y-5">
        <TabsList className="bg-muted/40 ring-1 ring-inset ring-border/60">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="tasks" data-testid="tab-tasks">Tasks</TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-5 outline-none">
          <OverviewTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="tasks" className="outline-none">
          <TasksTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="documents" className="outline-none">
          <DocumentsTab projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── OVERVIEW ────────────────────────────────────────────────────────────────

function OverviewTab({ projectId }: { projectId: number }) {
  const { data: project } = useGetProject(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) },
  });
  const { data: progress, isLoading: isLoadingProgress } = useGetProjectProgress(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectProgressQueryKey(projectId) },
  });
  const { data: milestones, isLoading: isLoadingMilestones } = useListMilestones(projectId, {
    query: { enabled: !!projectId, queryKey: getListMilestonesQueryKey(projectId) },
  });

  return (
    <div className="space-y-5">
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
                  <Progress value={cat.total > 0 ? (cat.completed / cat.total) * 100 : 0} className="h-1 bg-muted/30" />
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>

      <MilestonesPanel
        projectId={projectId}
        milestones={milestones ?? []}
        isLoading={isLoadingMilestones}
      />
      </div>

      <GanttChart
        milestones={milestones ?? []}
        isLoading={isLoadingMilestones}
        projectStart={project?.startDate ?? null}
        projectTarget={project?.targetDate ?? null}
      />
    </div>
  );
}

// ─── GANTT CHART ─────────────────────────────────────────────────────────────

const GANTT_COLOR_BAR: Record<string, string> = {
  blue:    "bg-blue-500/70 ring-blue-400/60",
  violet:  "bg-violet-500/70 ring-violet-400/60",
  amber:   "bg-amber-500/70 ring-amber-400/60",
  teal:    "bg-teal-500/70 ring-teal-400/60",
  emerald: "bg-emerald-500/70 ring-emerald-400/60",
  red:     "bg-red-500/70 ring-red-400/60",
  pink:    "bg-pink-500/70 ring-pink-400/60",
};

function GanttChart({
  milestones, isLoading, projectStart, projectTarget,
}: {
  milestones: MilestoneItem[]; isLoading: boolean;
  projectStart: string | null; projectTarget: string | null;
}) {
  const dated = milestones.filter(m => m.dueDate);

  // Compute timeline range
  const range = (() => {
    const dates: number[] = [];
    if (projectStart) dates.push(new Date(projectStart).getTime());
    if (projectTarget) dates.push(new Date(projectTarget).getTime());
    for (const m of dated) dates.push(new Date(m.dueDate!).getTime());
    if (dates.length === 0) return null;
    let min = Math.min(...dates);
    let max = Math.max(...dates);
    if (min === max) {
      min -= 1000 * 60 * 60 * 24 * 7;
      max += 1000 * 60 * 60 * 24 * 7;
    }
    // Pad 5% each side
    const pad = (max - min) * 0.05;
    return { min: min - pad, max: max + pad };
  })();

  const pct = (iso: string | null | undefined) => {
    if (!iso || !range) return 0;
    const t = new Date(iso).getTime();
    return Math.max(0, Math.min(100, ((t - range.min) / (range.max - range.min)) * 100));
  };

  // Month tick marks
  const ticks: { pct: number; label: string }[] = [];
  if (range) {
    const start = new Date(range.min);
    const end = new Date(range.max);
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    if (cursor.getTime() < start.getTime()) cursor.setMonth(cursor.getMonth() + 1);
    const span = range.max - range.min;
    const stepMonths = span > 1000 * 60 * 60 * 24 * 365 * 1.5 ? 3 : span > 1000 * 60 * 60 * 24 * 180 ? 2 : 1;
    while (cursor.getTime() <= end.getTime()) {
      const p = ((cursor.getTime() - range.min) / span) * 100;
      ticks.push({ pct: p, label: format(cursor, "MMM yyyy") });
      cursor.setMonth(cursor.getMonth() + stepMonths);
    }
  }

  const todayPct = range && Date.now() >= range.min && Date.now() <= range.max ? pct(new Date().toISOString()) : null;

  return (
    <div className="surface-card ring-hairline border border-border/70 rounded-2xl">
      <div className="px-5 pt-4 pb-3 border-b border-border/50 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold tracking-tight">Project Gantt</h2>
        <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          {dated.length} milestone{dated.length === 1 ? "" : "s"}
        </div>
      </div>
      <div className="p-5">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : dated.length === 0 || !range ? (
          <div className="text-center py-8 text-sm text-muted-foreground font-mono">
            Add milestones with due dates to see the Gantt chart.
          </div>
        ) : (
          <div className="flex">
            {/* Row labels */}
            <div className="w-44 shrink-0 pr-3 space-y-2">
              <div className="h-6" />
              {dated.map(m => (
                <div key={m.id} className="h-7 flex items-center text-xs truncate text-foreground/80" title={m.name}>
                  {m.name}
                </div>
              ))}
            </div>

            {/* Chart area */}
            <div className="flex-1 min-w-0 relative">
              {/* Top axis */}
              <div className="h-6 relative border-b border-border/50">
                {ticks.map((t, i) => (
                  <div key={i} className="absolute top-0 bottom-0 flex items-end pb-1" style={{ left: `${t.pct}%` }}>
                    <div className="text-[9.5px] font-mono text-muted-foreground -translate-x-1/2 whitespace-nowrap">
                      {t.label}
                    </div>
                  </div>
                ))}
              </div>

              {/* Grid + rows */}
              <div className="relative pt-2 space-y-2">
                {/* Vertical grid lines */}
                <div className="absolute inset-0 pointer-events-none">
                  {ticks.map((t, i) => (
                    <div key={i} className="absolute top-0 bottom-0 w-px bg-border/30" style={{ left: `${t.pct}%` }} />
                  ))}
                </div>

                {/* Project range band */}
                {projectStart && projectTarget && (() => {
                  const a = pct(projectStart);
                  const b = pct(projectTarget);
                  return (
                    <div
                      className="absolute top-0 bottom-0 bg-primary/[0.04] border-x border-dashed border-primary/30"
                      style={{ left: `${Math.min(a, b)}%`, width: `${Math.max(0.5, Math.abs(b - a))}%` }}
                      title={`Project range: ${format(new Date(projectStart), "MMM d")} → ${format(new Date(projectTarget), "MMM d")}`}
                    />
                  );
                })()}

                {/* Today line */}
                {todayPct != null && (
                  <div
                    className="absolute top-0 bottom-0 w-px bg-primary/70 z-10"
                    style={{ left: `${todayPct}%` }}
                  >
                    <div className="absolute -top-1 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-primary glow-primary" />
                  </div>
                )}

                {/* Bars */}
                {dated.map((m, idx) => {
                  const endPct = pct(m.dueDate);
                  const startPct = idx === 0 ? pct(projectStart ?? dated[0].dueDate) : pct(dated[idx - 1].dueDate);
                  const left = Math.min(startPct, endPct);
                  const width = Math.max(1.5, Math.abs(endPct - startPct));
                  const colorClass = GANTT_COLOR_BAR[m.color ?? "blue"] ?? GANTT_COLOR_BAR.blue;
                  const completed = m.status === "completed";
                  const missed = m.status === "missed";
                  return (
                    <div key={m.id} className="h-7 relative">
                      <div
                        className={`absolute top-1/2 -translate-y-1/2 h-3 rounded-sm ring-1 ring-inset ${colorClass} ${
                          completed ? "opacity-100" : missed ? "opacity-60 ring-red-500/70 bg-red-500/40" : "opacity-70"
                        }`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        title={`${m.name} · due ${format(new Date(m.dueDate!), "MMM d, yyyy")}`}
                      />
                      {/* End-of-bar diamond marker */}
                      <div
                        className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45 ${
                          completed ? "bg-emerald-400" : missed ? "bg-red-400" : "bg-foreground/70"
                        } ring-1 ring-background z-[1]`}
                        style={{ left: `${endPct}%` }}
                      />
                      {/* Date label after diamond */}
                      <div
                        className="absolute top-1/2 -translate-y-1/2 text-[9.5px] font-mono tabular-nums text-muted-foreground whitespace-nowrap pointer-events-none"
                        style={{ left: `calc(${endPct}% + 8px)` }}
                      >
                        {format(new Date(m.dueDate!), "MMM d")}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 pt-4 mt-3 border-t border-border/40 text-[10px] font-mono text-muted-foreground">
                {todayPct != null && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-1 h-3 bg-primary/70" /> Today
                  </div>
                )}
                {projectStart && projectTarget && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 bg-primary/[0.04] border border-dashed border-primary/30" /> Project range
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rotate-45 bg-emerald-400" /> Completed
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rotate-45 bg-red-400" /> Missed
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MILESTONES ──────────────────────────────────────────────────────────────

const MILESTONE_STATUSES = ["pending", "in_progress", "completed", "missed"] as const;
const MILESTONE_TONE: Record<string, string> = {
  pending:     "text-muted-foreground bg-muted/40 ring-border/60",
  in_progress: "text-blue-400 bg-blue-500/10 ring-blue-500/20",
  completed:   "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
  missed:      "text-red-400 bg-red-500/10 ring-red-500/20",
};
const MILESTONE_DOT: Record<string, string> = {
  pending:     "bg-muted-foreground/40",
  in_progress: "bg-blue-400",
  completed:   "bg-emerald-400",
  missed:      "bg-red-400",
};
const MILESTONE_COLORS = [
  { value: "blue",   class: "bg-blue-500" },
  { value: "violet", class: "bg-violet-500" },
  { value: "amber",  class: "bg-amber-500" },
  { value: "teal",   class: "bg-teal-500" },
  { value: "emerald",class: "bg-emerald-500" },
  { value: "red",    class: "bg-red-500" },
  { value: "pink",   class: "bg-pink-500" },
];

type MilestoneItem = {
  id: number; name: string; description?: string | null; dueDate?: string | null;
  status: string; color?: string | null;
};

type MilestoneFormState = {
  name: string; description: string; dueDate: string; status: string; color: string;
};

const EMPTY_MILESTONE: MilestoneFormState = {
  name: "", description: "", dueDate: "", status: "pending", color: "blue",
};

function MilestonesPanel({
  projectId, milestones, isLoading,
}: { projectId: number; milestones: MilestoneItem[]; isLoading: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<MilestoneFormState>(EMPTY_MILESTONE);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const createMutation = useCreateMilestone();
  const updateMutation = useUpdateMilestone();
  const deleteMutation = useDeleteMilestone();

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListMilestonesQueryKey(projectId) });
    qc.invalidateQueries({ queryKey: getGetProjectProgressQueryKey(projectId) });
  }

  function openNew() {
    setEditingId(null);
    setForm(EMPTY_MILESTONE);
    setDialogOpen(true);
  }

  function openEdit(m: MilestoneItem) {
    setEditingId(m.id);
    setForm({
      name: m.name,
      description: m.description ?? "",
      dueDate: m.dueDate ?? "",
      status: m.status,
      color: m.color ?? "blue",
    });
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    const data = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      dueDate: form.dueDate || undefined,
      status: form.status as any,
      color: form.color || undefined,
    };
    try {
      if (editingId != null) {
        await updateMutation.mutateAsync({ id: editingId, data });
        toast({ title: "Milestone updated" });
      } else {
        await createMutation.mutateAsync({ projectId, data });
        toast({ title: "Milestone created" });
      }
      invalidate();
      setDialogOpen(false);
    } catch (err) {
      toast({ title: "Save failed", description: String(err), variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteMutation.mutateAsync({ id });
      toast({ title: "Milestone deleted" });
      invalidate();
    } catch (err) {
      toast({ title: "Delete failed", description: String(err), variant: "destructive" });
    } finally {
      setConfirmDeleteId(null);
    }
  }

  const busy = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="surface-card ring-hairline border border-border/70 rounded-2xl">
      <div className="px-5 pt-4 pb-3 border-b border-border/50 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold tracking-tight">Key Milestones</h2>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-primary"
          onClick={openNew} data-testid="button-new-milestone">
          <Plus className="w-3.5 h-3.5" /> Add
        </Button>
      </div>
      <div className="p-5">
        {isLoading ? <Skeleton className="h-32 w-full" /> : milestones.length === 0 ? (
          <div className="text-center py-6 space-y-3">
            <div className="text-sm text-muted-foreground font-mono">No milestones yet.</div>
            <Button size="sm" variant="outline" onClick={openNew} className="gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Add first milestone
            </Button>
          </div>
        ) : (
          <div className="space-y-1 relative">
            <div className="absolute left-[5px] top-2 bottom-2 w-px bg-border/70" />
            {milestones.map(m => {
              const tone = MILESTONE_TONE[m.status] ?? MILESTONE_TONE.pending;
              const dot = MILESTONE_DOT[m.status] ?? MILESTONE_DOT.pending;
              const isOverdue = m.dueDate && new Date(m.dueDate) < new Date() && m.status !== "completed";
              return (
                <div key={m.id} className="group flex items-start gap-3 py-1.5 relative">
                  <div className="relative z-10 w-[11px] h-[11px] mt-1 rounded-full bg-background ring-2 ring-background flex items-center justify-center shrink-0">
                    <div className={`w-2 h-2 rounded-full ${dot}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium leading-snug">{m.name}</span>
                      <span className={`text-[9px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 rounded ring-1 ring-inset ${tone}`}>
                        {m.status.replace("_", " ")}
                      </span>
                    </div>
                    <div className="text-[10.5px] text-muted-foreground font-mono tabular-nums">
                      <span className={isOverdue ? "text-red-400" : ""}>
                        {m.dueDate ? format(new Date(m.dueDate), "MMM dd, yyyy") : "TBD"}
                      </span>
                      {m.description && (
                        <>
                          <span className="mx-1.5 text-border">·</span>
                          <span className="text-muted-foreground/80 normal-case font-sans truncate">{m.description}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary"
                      onClick={() => openEdit(m)} title="Edit">
                      <PenLine className="w-3 h-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
                      onClick={() => setConfirmDeleteId(m.id)} title="Delete">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{editingId != null ? "Edit milestone" : "New milestone"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-1.5">
                <Label htmlFor="ms-name" className="text-xs">Name *</Label>
                <Input id="ms-name" required value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Equipment install complete"
                  data-testid="input-milestone-name" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ms-desc" className="text-xs">Description</Label>
                <Textarea id="ms-desc" rows={2} className="resize-none" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="ms-due" className="text-xs">Due date</Label>
                  <Input id="ms-due" type="date" value={form.dueDate}
                    onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ms-status" className="text-xs">Status</Label>
                  <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                    <SelectTrigger id="ms-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MILESTONE_STATUSES.map(s => (
                        <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Color</Label>
                <div className="flex gap-2 flex-wrap">
                  {MILESTONE_COLORS.map(c => (
                    <button
                      key={c.value} type="button"
                      onClick={() => setForm(f => ({ ...f, color: c.value }))}
                      className={`w-7 h-7 rounded-full ${c.class} ring-2 ring-offset-2 ring-offset-background transition-all ${
                        form.color === c.value ? "ring-foreground scale-110" : "ring-transparent"
                      }`}
                      title={c.value}
                    />
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || !form.name.trim()} className="gap-2">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingId != null ? "Save changes" : "Create milestone"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDeleteId != null} onOpenChange={o => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this milestone?</AlertDialogTitle>
            <AlertDialogDescription>
              Tasks linked to this milestone will lose their milestone reference but will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDeleteId != null && handleDelete(confirmDeleteId)}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── TASKS ───────────────────────────────────────────────────────────────────

const TASK_STATUS = ["todo", "in_progress", "blocked", "review", "done"] as const;
const TASK_PRIORITY = ["low", "medium", "high", "critical"] as const;
const TASK_CATEGORY = ["construction", "electrical", "av", "it", "network", "acoustics", "furnishing", "signage", "general"] as const;
type TStatus = typeof TASK_STATUS[number];

const TASK_TONE: Record<TStatus, string> = {
  todo:        "text-muted-foreground bg-muted/40 ring-border/60",
  in_progress: "text-blue-400 bg-blue-500/10 ring-blue-500/20",
  blocked:     "text-red-400 bg-red-500/10 ring-red-500/20",
  review:      "text-amber-400 bg-amber-500/10 ring-amber-500/20",
  done:        "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
};
const TASK_ICONS: Record<TStatus, React.ReactNode> = {
  todo: <Circle className="w-3 h-3" />,
  in_progress: <Loader className="w-3 h-3 animate-spin" />,
  blocked: <AlertTriangle className="w-3 h-3" />,
  review: <Eye className="w-3 h-3" />,
  done: <CheckCircle2 className="w-3 h-3" />,
};
const PRIORITY_TONE: Record<string, string> = {
  low: "text-muted-foreground", medium: "text-blue-400", high: "text-amber-400", critical: "text-red-400",
};

function TasksTab({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const params = { projectId };
  const { data: tasks, isLoading } = useListTasks(params);
  const { data: members } = useListMembers();
  const { data: milestones } = useListMilestones(projectId, {
    query: { enabled: !!projectId, queryKey: getListMilestonesQueryKey(projectId) },
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "", description: "", milestoneId: "", assigneeId: "",
    status: "todo", priority: "medium", category: "general", dueDate: "",
  });

  const createMutation = useCreateTask();
  const updateMutation = useUpdateTask();
  const deleteMutation = useDeleteTask();

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
    qc.invalidateQueries({ queryKey: getListTasksQueryKey(params) });
    qc.invalidateQueries({ queryKey: getGetProjectProgressQueryKey(projectId) });
  }

  function resetForm() {
    setForm({ title: "", description: "", milestoneId: "", assigneeId: "", status: "todo", priority: "medium", category: "general", dueDate: "" });
  }

  async function handleCreate() {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    try {
      await createMutation.mutateAsync({
        data: {
          projectId,
          title: form.title.trim(),
          description: form.description || undefined,
          milestoneId: form.milestoneId ? parseInt(form.milestoneId) : undefined,
          assigneeId: form.assigneeId ? parseInt(form.assigneeId) : undefined,
          status: form.status as any,
          priority: form.priority as any,
          category: form.category as any,
          dueDate: form.dueDate || undefined,
        },
      });
      toast({ title: "Task created" });
      setOpen(false);
      resetForm();
      invalidate();
    } catch {
      toast({ title: "Failed to create task", variant: "destructive" });
    }
  }

  async function changeStatus(taskId: number, status: string) {
    try {
      await updateMutation.mutateAsync({ id: taskId, data: { status: status as any } });
      invalidate();
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    }
  }

  async function handleDelete(taskId: number) {
    await deleteMutation.mutateAsync({ id: taskId });
    invalidate();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="text-[11px] font-mono text-muted-foreground tabular-nums">
          {tasks?.length ?? 0} {(tasks?.length ?? 0) === 1 ? "task" : "tasks"} in this project
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2 h-9" data-testid="button-new-task-in-project">
          <Plus className="w-4 h-4" />
          New Task
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
      ) : !tasks || tasks.length === 0 ? (
        <div className="surface-card ring-hairline border border-dashed border-border/70 rounded-2xl p-12 text-center space-y-3">
          <div className="text-sm text-muted-foreground font-mono">No tasks yet for this project.</div>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
            <Plus className="w-3.5 h-3.5" /> Add first task
          </Button>
        </div>
      ) : (
        <div className="surface-card ring-hairline border border-border/70 rounded-2xl overflow-hidden divide-y divide-border/40">
          <AnimatePresence initial={false}>
            {tasks.map((task, i) => {
              const tone = TASK_TONE[task.status as TStatus] ?? TASK_TONE.todo;
              const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "done";
              return (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -8 }}
                  transition={{ delay: Math.min(i * 0.02, 0.15) }}
                  className="group flex items-center gap-4 px-4 py-3 hover:bg-background/40 transition-colors"
                >
                  <Select value={task.status} onValueChange={v => changeStatus(task.id, v)}>
                    <SelectTrigger className={`w-[132px] h-7 text-[11px] font-medium bg-transparent rounded-md ring-1 ring-inset border-0 ${tone}`}>
                      <div className="flex items-center gap-1.5">
                        {TASK_ICONS[task.status as TStatus]}
                        <span className="capitalize">{task.status.replace("_", " ")}</span>
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {TASK_STATUS.map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{task.title}</div>
                    <div className="text-[11px] text-muted-foreground font-mono flex gap-1.5 flex-wrap mt-0.5">
                      <span className="capitalize">{task.category}</span>
                      {task.milestoneName && <><span className="text-border">·</span><span>{task.milestoneName}</span></>}
                      {task.assigneeName && <><span className="text-border">·</span><span>{task.assigneeName}</span></>}
                      {task.dueDate && (
                        <>
                          <span className="text-border">·</span>
                          <span className={`tabular-nums ${isOverdue ? "text-red-400" : ""}`}>{format(new Date(task.dueDate), "MMM dd")}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className={`text-[10px] font-mono uppercase tracking-[0.12em] ${PRIORITY_TONE[task.priority] ?? ""}`}>
                    {task.priority}
                  </span>
                  <Button variant="ghost" size="icon"
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

      <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>New task</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Title *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Task title" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="resize-none h-20" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Milestone</Label>
                <Select value={form.milestoneId || "__none__"} onValueChange={v => setForm(f => ({ ...f, milestoneId: v === "__none__" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {milestones?.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Assign to</Label>
                <Select value={form.assigneeId || "__none__"} onValueChange={v => setForm(f => ({ ...f, assigneeId: v === "__none__" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Unassigned</SelectItem>
                    {members?.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_STATUS.map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_PRIORITY.map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Category</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_CATEGORY.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Due date</Label>
              <Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setOpen(false); resetForm(); }}>Cancel</Button>
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

// ─── DOCUMENTS ───────────────────────────────────────────────────────────────

const DOC_CATEGORIES = ["spec", "plan", "permit", "vendor", "as_built", "safety", "general"] as const;
const CATEGORY_TONE: Record<string, string> = {
  spec:     "text-blue-400 bg-blue-500/10 ring-blue-500/20",
  plan:     "text-violet-400 bg-violet-500/10 ring-violet-500/20",
  permit:   "text-amber-400 bg-amber-500/10 ring-amber-500/20",
  vendor:   "text-teal-400 bg-teal-500/10 ring-teal-500/20",
  as_built: "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
  safety:   "text-red-400 bg-red-500/10 ring-red-500/20",
  general:  "text-muted-foreground bg-muted/40 ring-border/60",
};

type FolderNode = { id: number; parentId: number | null; name: string; children: FolderNode[] };

function buildTree(folders: { id: number; parentId?: number | null; name: string }[]): FolderNode[] {
  const map = new Map<number, FolderNode>();
  for (const f of folders) map.set(f.id, { id: f.id, parentId: f.parentId ?? null, name: f.name, children: [] });
  const roots: FolderNode[] = [];
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) map.get(node.parentId)!.children.push(node);
    else roots.push(node);
  }
  const sortRec = (arr: FolderNode[]) => { arr.sort((a, b) => a.name.localeCompare(b.name)); arr.forEach(n => sortRec(n.children)); };
  sortRec(roots);
  return roots;
}

function DocumentsTab({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [uploadCategory, setUploadCategory] = useState("general");
  const [uploading, setUploading] = useState(false);

  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const { data: folders, isLoading: foldersLoading } = useListFolders({ projectId });
  const docFolderQuery = currentFolderId === null ? 0 : currentFolderId;
  const { data: docs, isLoading: docsLoading } = useListDocuments({ projectId, folderId: docFolderQuery });
  const { data: appConfig } = useQuery<{ collaboraEnabled: boolean }>({
    queryKey: ["app-config"],
    queryFn: async () => {
      const r = await fetch("/api/config");
      if (!r.ok) return { collaboraEnabled: false };
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const createFolderMutation = useCreateFolder();
  const deleteFolderMutation = useDeleteFolder();
  const deleteDocMutation = useDeleteDocument();

  const tree = useMemo(() => buildTree(folders ?? []), [folders]);

  // Breadcrumb path
  const folderById = useMemo(() => {
    const m = new Map<number, { id: number; parentId: number | null; name: string }>();
    for (const f of (folders ?? [])) m.set(f.id, { id: f.id, parentId: f.parentId ?? null, name: f.name });
    return m;
  }, [folders]);
  const breadcrumbs = useMemo(() => {
    const out: { id: number | null; name: string }[] = [{ id: null, name: "All Documents" }];
    if (currentFolderId == null) return out;
    const chain: { id: number; name: string }[] = [];
    let cur: number | null = currentFolderId;
    while (cur != null) {
      const f = folderById.get(cur);
      if (!f) break;
      chain.unshift({ id: f.id, name: f.name });
      cur = f.parentId;
    }
    return out.concat(chain);
  }, [currentFolderId, folderById]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
    qc.invalidateQueries({ queryKey: getListDocumentsQueryKey({ projectId, folderId: docFolderQuery }) });
    qc.invalidateQueries({ queryKey: getListFoldersQueryKey() });
    qc.invalidateQueries({ queryKey: getListFoldersQueryKey({ projectId }) });
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    let ok = 0;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", file.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " "));
      fd.append("category", uploadCategory);
      fd.append("projectId", String(projectId));
      if (currentFolderId != null) fd.append("folderId", String(currentFolderId));
      try {
        const res = await fetch("/api/documents/upload", { method: "POST", body: fd });
        if (res.ok) ok++;
        else toast({ title: `Failed to upload ${file.name}`, variant: "destructive" });
      } catch {
        toast({ title: `Failed to upload ${file.name}`, variant: "destructive" });
      }
    }
    setUploading(false);
    if (ok > 0) { toast({ title: `${ok} file${ok > 1 ? "s" : ""} uploaded` }); invalidate(); }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    try {
      await createFolderMutation.mutateAsync({
        data: { projectId, parentId: currentFolderId ?? undefined, name: newFolderName.trim() },
      });
      toast({ title: "Folder created" });
      setNewFolderName("");
      setFolderDialogOpen(false);
      invalidate();
    } catch {
      toast({ title: "Failed to create folder", variant: "destructive" });
    }
  }

  async function handleDeleteFolder(id: number) {
    try {
      await deleteFolderMutation.mutateAsync({ id });
      toast({ title: "Folder deleted" });
      if (currentFolderId === id) setCurrentFolderId(folderById.get(id)?.parentId ?? null);
      invalidate();
    } catch (err: any) {
      toast({ title: "Cannot delete folder", description: "Folder must be empty.", variant: "destructive" });
    }
  }

  async function handleDeleteDoc(id: number) {
    await deleteDocMutation.mutateAsync({ id });
    invalidate();
  }

  // Subfolders of current folder
  const currentSubfolders = (folders ?? [])
    .filter(f => (f.parentId ?? null) === currentFolderId)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
      {/* Folder tree sidebar */}
      <div className="surface-card ring-hairline border border-border/70 rounded-2xl p-3 self-start lg:sticky lg:top-4">
        <div className="flex items-center justify-between px-2 py-1.5 mb-1">
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Folders</span>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-primary"
            onClick={() => setFolderDialogOpen(true)} title="New folder">
            <FolderPlus className="w-3.5 h-3.5" />
          </Button>
        </div>
        <button
          onClick={() => setCurrentFolderId(null)}
          className={`w-full text-left px-2 py-1.5 rounded-md flex items-center gap-2 text-sm transition-colors ${
            currentFolderId === null ? "bg-primary/10 text-primary" : "hover:bg-background/60 text-foreground/80"
          }`}
        >
          <Home className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">All Documents</span>
        </button>
        {foldersLoading ? (
          <Skeleton className="h-16 w-full rounded-md mt-2" />
        ) : tree.length === 0 ? (
          <div className="text-[11px] font-mono text-muted-foreground/70 px-2 py-3 text-center">
            No folders yet
          </div>
        ) : (
          <div className="mt-1 space-y-0.5">
            {tree.map(node => (
              <FolderTreeItem
                key={node.id}
                node={node}
                depth={0}
                currentId={currentFolderId}
                onSelect={setCurrentFolderId}
                onDelete={handleDeleteFolder}
              />
            ))}
          </div>
        )}
      </div>

      {/* Documents pane */}
      <div className="space-y-4 min-w-0">
        {/* Breadcrumbs + actions */}
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex items-center gap-1 flex-wrap text-sm">
            {breadcrumbs.map((b, i) => (
              <span key={`${b.id ?? "root"}-${i}`} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <button
                  onClick={() => setCurrentFolderId(b.id)}
                  className={`hover:text-primary transition-colors ${i === breadcrumbs.length - 1 ? "text-foreground font-medium" : "text-muted-foreground"}`}
                >
                  {b.name}
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Select value={uploadCategory} onValueChange={setUploadCategory}>
              <SelectTrigger className="h-9 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_CATEGORIES.map(c => <SelectItem key={c} value={c} className="capitalize">{c.replace("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={() => setFolderDialogOpen(true)}>
              <FolderPlus className="w-4 h-4" /> New Folder
            </Button>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="gap-2 h-9">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </div>
        </div>

        {/* Subfolders grid */}
        {currentSubfolders.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {currentSubfolders.map(f => (
              <button
                key={f.id}
                onDoubleClick={() => setCurrentFolderId(f.id)}
                onClick={() => setCurrentFolderId(f.id)}
                className="group surface-card ring-hairline border border-border/70 rounded-xl px-3 py-2.5 flex items-center gap-2 text-left hover:border-border hover:-translate-y-0.5 hover:shadow-md transition-all"
              >
                <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-sm font-medium truncate flex-1">{f.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Docs list */}
        {docsLoading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
        ) : !docs || docs.length === 0 ? (
          currentSubfolders.length === 0 ? (
            <div className="surface-card ring-hairline border border-dashed border-border/70 rounded-2xl p-12 text-center space-y-3">
              <div className="text-sm text-muted-foreground font-mono">
                {currentFolderId == null ? "No documents in this project yet." : "This folder is empty."}
              </div>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" size="sm" onClick={() => setFolderDialogOpen(true)} className="gap-1.5">
                  <FolderPlus className="w-3.5 h-3.5" /> New folder
                </Button>
                <Button size="sm" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
                  <Upload className="w-3.5 h-3.5" /> Upload
                </Button>
              </div>
            </div>
          ) : null
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            <AnimatePresence initial={false}>
              {docs.map((doc, i) => (
                <DocTile
                  key={doc.id}
                  doc={doc}
                  idx={i}
                  collaboraEnabled={!!appConfig?.collaboraEnabled}
                  onDelete={() => handleDeleteDoc(doc.id)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* New folder dialog */}
      <Dialog open={folderDialogOpen} onOpenChange={o => { setFolderDialogOpen(o); if (!o) setNewFolderName(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New folder</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="text-[11px] font-mono text-muted-foreground">
              Inside: <span className="text-foreground">{breadcrumbs[breadcrumbs.length - 1]?.name}</span>
            </div>
            <Input
              autoFocus
              placeholder="Folder name"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreateFolder(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFolderDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateFolder} disabled={!newFolderName.trim() || createFolderMutation.isPending} className="gap-2">
              {createFolderMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
              Create folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FolderTreeItem({
  node, depth, currentId, onSelect, onDelete,
}: {
  node: FolderNode;
  depth: number;
  currentId: number | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isActive = currentId === node.id;
  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded-md text-sm transition-colors ${
          isActive ? "bg-primary/10 text-primary" : "hover:bg-background/60 text-foreground/80"
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {node.children.length > 0 ? (
          <button onClick={() => setExpanded(e => !e)} className="p-1 text-muted-foreground hover:text-foreground">
            <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
          </button>
        ) : <span className="w-5" />}
        <button onClick={() => onSelect(node.id)} className="flex-1 flex items-center gap-1.5 py-1 text-left min-w-0">
          {isActive ? <FolderOpen className="w-3.5 h-3.5 text-primary shrink-0" /> : <Folder className="w-3.5 h-3.5 text-amber-400/80 shrink-0" />}
          <span className="truncate">{node.name}</span>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
          className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-red-400 transition-opacity"
          title="Delete folder"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      {expanded && node.children.length > 0 && (
        <div>
          {node.children.map(c => (
            <FolderTreeItem key={c.id} node={c} depth={depth + 1} currentId={currentId} onSelect={onSelect} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DOC ROW ─────────────────────────────────────────────────────────────────

const EXT_META: Record<string, { icon: React.ReactNode; tone: string }> = {
  CSV:  { icon: <FileSpreadsheet className="w-4 h-4" />, tone: "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20" },
  XLSX: { icon: <FileSpreadsheet className="w-4 h-4" />, tone: "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20" },
  PDF:  { icon: <FileText className="w-4 h-4" />,        tone: "text-red-400 bg-red-500/10 ring-red-500/20" },
  DOC:  { icon: <FileText className="w-4 h-4" />,        tone: "text-blue-400 bg-blue-500/10 ring-blue-500/20" },
  DOCX: { icon: <FileText className="w-4 h-4" />,        tone: "text-blue-400 bg-blue-500/10 ring-blue-500/20" },
  PNG:  { icon: <FileImage className="w-4 h-4" />,       tone: "text-pink-400 bg-pink-500/10 ring-pink-500/20" },
  JPG:  { icon: <FileImage className="w-4 h-4" />,       tone: "text-pink-400 bg-pink-500/10 ring-pink-500/20" },
  DWG:  { icon: <FileCode className="w-4 h-4" />,        tone: "text-orange-400 bg-orange-500/10 ring-orange-500/20" },
  ZIP:  { icon: <FileArchive className="w-4 h-4" />,     tone: "text-yellow-400 bg-yellow-500/10 ring-yellow-500/20" },
};
const COLLABORA_EXTS = new Set(["csv","tsv","txt","md","markdown","rtf","doc","docx","odt","xls","xlsx","ods","ppt","pptx","odp"]);

function DocTile({
  doc, idx, collaboraEnabled, onDelete,
}: {
  doc: { id: number; title: string; url?: string | null; category: string; uploadedBy?: string | null; version?: string | null; updatedAt?: string };
  idx: number;
  collaboraEnabled: boolean;
  onDelete: () => void;
}) {
  const [, navigate] = useLocation();
  const tone = CATEGORY_TONE[doc.category] ?? CATEGORY_TONE.general;
  const ext = (doc.url ?? "").split(".").pop()?.toUpperCase() ?? "";
  const meta = EXT_META[ext] ?? { icon: <FileText className="w-7 h-7" />, tone: "text-muted-foreground bg-muted/40 ring-border/60" };
  const useCollabora = collaboraEnabled && COLLABORA_EXTS.has(ext.toLowerCase());

  function handleOpen() {
    if (useCollabora) {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const url = `${base}/collabora-launcher.html?docId=${doc.id}&base=${encodeURIComponent(base)}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      navigate(`/documents/${doc.id}/edit`);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      transition={{ delay: Math.min(idx * 0.02, 0.15) }}
      className="group relative surface-card ring-hairline border border-border/70 rounded-xl p-3 flex flex-col items-center text-center gap-2 hover:border-border hover:-translate-y-0.5 hover:shadow-md transition-all cursor-pointer"
      onDoubleClick={handleOpen}
      onClick={handleOpen}
      title={doc.title}
      data-testid={`doc-tile-${doc.id}`}
    >
      <Button
        variant="ghost" size="icon"
        className="absolute top-1 right-1 h-6 w-6 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
      <div className={`mt-2 w-14 h-14 rounded-xl flex flex-col items-center justify-center ring-1 ring-inset ${meta.tone} gap-0.5`}>
        <div className="[&>svg]:w-6 [&>svg]:h-6">{meta.icon}</div>
        {ext && <span className="text-[8px] font-bold font-mono leading-none">{ext}</span>}
      </div>
      <div className="w-full min-w-0 space-y-1">
        <div className="text-[12.5px] font-medium leading-snug line-clamp-2 break-words" title={doc.title}>
          {doc.title}
        </div>
        <div className="flex items-center justify-center gap-1 flex-wrap">
          <span className={`text-[9px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-md ring-1 ring-inset ${tone}`}>
            {doc.category.replace("_", " ")}
          </span>
          {doc.version && (
            <span className="text-[9px] font-mono text-muted-foreground border border-border/70 rounded px-1 py-0.5">
              {doc.version}
            </span>
          )}
        </div>
        {doc.updatedAt && (
          <div className="text-[10px] font-mono text-muted-foreground tabular-nums">
            {format(new Date(doc.updatedAt), "MMM dd, yyyy")}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── PRIMITIVES ──────────────────────────────────────────────────────────────

// ─── EDIT PROJECT ────────────────────────────────────────────────────────────

const PROJECT_STATUSES = ["planning", "in_progress", "on_hold", "completed"] as const;

type ProjectFormState = {
  name: string;
  description: string;
  location: string;
  status: string;
  phase: string;
  startDate: string;
  targetDate: string;
  completedDate: string;
  budget: string;
};

function EditProjectButton({ project }: {
  project: {
    id: number; name: string; description?: string | null; location?: string | null;
    status: string; phase?: string | null; startDate?: string | null;
    targetDate?: string | null; completedDate?: string | null; budget?: number | null;
  };
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState<ProjectFormState>({
    name: project.name,
    description: project.description ?? "",
    location: project.location ?? "",
    status: project.status,
    phase: project.phase ?? "",
    startDate: project.startDate ?? "",
    targetDate: project.targetDate ?? "",
    completedDate: project.completedDate ?? "",
    budget: project.budget != null ? String(project.budget) : "",
  });

  function openDialog() {
    setForm({
      name: project.name,
      description: project.description ?? "",
      location: project.location ?? "",
      status: project.status,
      phase: project.phase ?? "",
      startDate: project.startDate ?? "",
      targetDate: project.targetDate ?? "",
      completedDate: project.completedDate ?? "",
      budget: project.budget != null ? String(project.budget) : "",
    });
    setOpen(true);
  }

  const updateMutation = useUpdateProject();
  const deleteMutation = useDeleteProject();

  function invalidate() {
    qc.invalidateQueries({ queryKey: getGetProjectQueryKey(project.id) });
    qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    const budgetNum = form.budget.trim() ? Number(form.budget) : undefined;
    if (form.budget.trim() && !Number.isFinite(budgetNum)) {
      toast({ title: "Budget must be a number", variant: "destructive" });
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: project.id,
        data: {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          location: form.location.trim() || undefined,
          status: form.status as any,
          phase: form.phase.trim() || undefined,
          startDate: form.startDate || undefined,
          targetDate: form.targetDate || undefined,
          completedDate: form.completedDate || undefined,
          budget: Number.isFinite(budgetNum) ? budgetNum : undefined,
        },
      });
      toast({ title: "Project updated" });
      invalidate();
      setOpen(false);
    } catch (err) {
      toast({ title: "Update failed", description: String(err), variant: "destructive" });
    }
  }

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync({ id: project.id });
      toast({ title: "Project deleted" });
      qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      navigate("/projects");
    } catch (err) {
      toast({ title: "Delete failed", description: String(err), variant: "destructive" });
    }
  }

  return (
    <>
      <Button
        variant="outline" size="sm"
        className="gap-2 h-9 shrink-0"
        onClick={openDialog}
        data-testid="button-edit-project"
      >
        <Settings className="w-3.5 h-3.5" />
        Edit project
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle>Edit project</DialogTitle>
              <DialogDescription>Update project details, timeline, and budget.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-1.5">
                <Label htmlFor="ep-name" className="text-xs">Name *</Label>
                <Input id="ep-name" required value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  data-testid="input-edit-project-name" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ep-desc" className="text-xs">Description / goals</Label>
                <Textarea id="ep-desc" rows={4} value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What does this project aim to accomplish?" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="ep-location" className="text-xs">Location</Label>
                  <Input id="ep-location" value={form.location}
                    onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ep-phase" className="text-xs">Phase</Label>
                  <Input id="ep-phase" value={form.phase}
                    onChange={e => setForm(f => ({ ...f, phase: e.target.value }))}
                    placeholder="e.g. Design, Build, Commissioning" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="ep-status" className="text-xs">Status</Label>
                  <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                    <SelectTrigger id="ep-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PROJECT_STATUSES.map(s => (
                        <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ep-budget" className="text-xs">Budget ($)</Label>
                  <Input id="ep-budget" type="number" inputMode="decimal" value={form.budget}
                    onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="ep-start" className="text-xs">Start date</Label>
                  <Input id="ep-start" type="date" value={form.startDate}
                    onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ep-target" className="text-xs">Target date</Label>
                  <Input id="ep-target" type="date" value={form.targetDate}
                    onChange={e => setForm(f => ({ ...f, targetDate: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ep-done" className="text-xs">Completed</Label>
                  <Input id="ep-done" type="date" value={form.completedDate}
                    onChange={e => setForm(f => ({ ...f, completedDate: e.target.value }))} />
                </div>
              </div>
            </div>
            <DialogFooter className="flex sm:justify-between gap-2">
              <Button
                type="button" variant="ghost"
                className="text-red-400 hover:text-red-300 hover:bg-red-400/10 gap-2"
                onClick={() => setConfirmDelete(true)}
                data-testid="button-delete-project"
              >
                <Trash2 className="w-4 h-4" />
                Delete project
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={updateMutation.isPending || !form.name.trim()} className="gap-2">
                  {updateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save changes
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes <span className="font-medium text-foreground">{project.name}</span> and all of its milestones, tasks, documents, and folders. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
