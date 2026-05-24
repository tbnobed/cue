import { useState } from "react";
import { useListProjects, useCreateProject, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { Plus, MapPin, CalendarDays, ArrowUpRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const STATUSES = ["planning", "in_progress", "on_hold", "completed"] as const;
type Status = (typeof STATUSES)[number];

const STATUS_TONE: Record<Status, string> = {
  planning:    "text-blue-400 bg-blue-500/10 ring-blue-500/20",
  in_progress: "text-primary bg-primary/10 ring-primary/20",
  on_hold:     "text-amber-400 bg-amber-500/10 ring-amber-500/20",
  completed:   "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
};

type FormState = {
  name: string;
  description: string;
  location: string;
  status: Status;
  phase: string;
  startDate: string;
  targetDate: string;
  budget: string;
};

const EMPTY: FormState = {
  name: "", description: "", location: "", status: "planning",
  phase: "", startDate: "", targetDate: "", budget: "",
};

function NewProjectDialog({ trigger }: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const qc = useQueryClient();
  const { toast } = useToast();

  const create = useCreateProject({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        toast({ title: "Project created" });
        setForm(EMPTY);
        setOpen(false);
      },
      onError: (err) => {
        toast({ title: "Could not create project", description: String(err), variant: "destructive" });
      },
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    const budgetNum = form.budget.trim() ? Number(form.budget) : undefined;
    create.mutate({
      data: {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        location: form.location.trim() || undefined,
        status: form.status,
        phase: form.phase.trim() || undefined,
        startDate: form.startDate || undefined,
        targetDate: form.targetDate || undefined,
        budget: Number.isFinite(budgetNum) ? budgetNum : undefined,
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="gap-2 h-9" data-testid="button-new-project">
            <Plus className="w-4 h-4" />
            New Project
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
            <DialogDescription>Add a new project to your command center.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label htmlFor="np-name" className="text-xs">Name *</Label>
              <Input id="np-name" required value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                data-testid="input-project-name" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="np-desc" className="text-xs">Description</Label>
              <Textarea id="np-desc" rows={3} value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="np-location" className="text-xs">Location</Label>
                <Input id="np-location" value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="np-phase" className="text-xs">Phase</Label>
                <Input id="np-phase" value={form.phase}
                  onChange={(e) => setForm((f) => ({ ...f, phase: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="np-status" className="text-xs">Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as Status }))}>
                  <SelectTrigger id="np-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="np-budget" className="text-xs">Budget</Label>
                <Input id="np-budget" type="number" inputMode="decimal" value={form.budget}
                  onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="np-start" className="text-xs">Start date</Label>
                <Input id="np-start" type="date" value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="np-target" className="text-xs">Target date</Label>
                <Input id="np-target" type="date" value={form.targetDate}
                  onChange={(e) => setForm((f) => ({ ...f, targetDate: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !form.name.trim()} data-testid="button-submit-project">
              {create.isPending ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ProjectsList() {
  const { data: projects, isLoading } = useListProjects();

  return (
    <div className="w-full space-y-8">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
            <span className="w-1 h-1 rounded-full bg-primary" />
            Projects
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Active deployments</h1>
        </div>
        <NewProjectDialog />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-52 w-full rounded-2xl" />)}
        </div>
      ) : projects && projects.length === 0 ? (
        <div className="surface-card ring-hairline border border-dashed border-border rounded-2xl p-14 text-center space-y-4">
          <div className="text-sm text-muted-foreground font-mono">
            No projects yet. Create your first project to get started.
          </div>
          <NewProjectDialog />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects?.map((project, idx) => {
            const tone = STATUS_TONE[project.status as Status] ?? "text-muted-foreground bg-muted/40 ring-border/60";
            return (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04, duration: 0.25 }}
              >
                <Link
                  href={`/projects/${project.id}`}
                  className="group block h-full surface-card ring-hairline border border-border/70 rounded-2xl p-5 transition-all hover:border-border hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div className="flex items-start justify-between gap-2 mb-4">
                    <span className={`text-[10px] font-mono uppercase tracking-[0.12em] px-2 py-1 rounded-md ring-1 ring-inset ${tone}`}>
                      {project.status.replace("_", " ")}
                    </span>
                    <ArrowUpRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                  </div>
                  <h3 className="text-lg font-semibold tracking-tight group-hover:text-primary transition-colors line-clamp-1">
                    {project.name}
                  </h3>
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1 leading-snug min-h-[2.5rem]">
                    {project.description || "No description provided."}
                  </p>
                  <div className="flex items-center gap-3 mt-5 pt-4 border-t border-border/50 text-[11px] font-mono text-muted-foreground tabular-nums">
                    <span className="flex items-center gap-1 truncate">
                      <MapPin className="w-3 h-3 shrink-0" />
                      {project.location || "TBD"}
                    </span>
                    {project.targetDate && (
                      <span className="flex items-center gap-1 ml-auto shrink-0">
                        <CalendarDays className="w-3 h-3" />
                        {format(new Date(project.targetDate), "MMM dd")}
                      </span>
                    )}
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
