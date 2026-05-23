import { useState } from "react";
import { useListProjects, useCreateProject, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUSES = ["planning", "in_progress", "on_hold", "completed"] as const;
type Status = (typeof STATUSES)[number];

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

function NewProjectDialog() {
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
        <Button className="gap-2" data-testid="button-new-project">
          <Plus className="w-4 h-4" />
          New Project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Create Project</DialogTitle>
            <DialogDescription>Add a new project to your command center.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="np-name">Name *</Label>
              <Input id="np-name" required value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                data-testid="input-project-name" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="np-desc">Description</Label>
              <Textarea id="np-desc" rows={3} value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="np-location">Location</Label>
                <Input id="np-location" value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="np-phase">Phase</Label>
                <Input id="np-phase" value={form.phase}
                  onChange={(e) => setForm((f) => ({ ...f, phase: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="np-status">Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as Status }))}>
                  <SelectTrigger id="np-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="np-budget">Budget</Label>
                <Input id="np-budget" type="number" inputMode="decimal" value={form.budget}
                  onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="np-start">Start Date</Label>
                <Input id="np-start" type="date" value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="np-target">Target Date</Label>
                <Input id="np-target" type="date" value={form.targetDate}
                  onChange={(e) => setForm((f) => ({ ...f, targetDate: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !form.name.trim()} data-testid="button-submit-project">
              {create.isPending ? "Creating…" : "Create Project"}
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
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Projects</h1>
          <p className="text-muted-foreground text-sm uppercase tracking-wider font-mono">Active Deployments</p>
        </div>
        <NewProjectDialog />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      ) : projects && projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center space-y-4">
            <p className="text-muted-foreground">No projects yet. Create your first project to get started.</p>
            <NewProjectDialog />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects?.map((project, idx) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Link href={`/projects/${project.id}`} className="block h-full hover-elevate">
                <Card className="h-full border-border bg-card hover:border-primary transition-colors cursor-pointer group flex flex-col">
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start mb-2">
                      <Badge variant="outline" className="font-mono uppercase text-[10px]">
                        {project.status.replace('_', ' ')}
                      </Badge>
                      {project.phase && <span className="text-xs text-muted-foreground font-mono">{project.phase}</span>}
                    </div>
                    <CardTitle className="text-xl group-hover:text-primary transition-colors">{project.name}</CardTitle>
                    <CardDescription className="line-clamp-2 text-sm">{project.description || "No description provided."}</CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto pt-4">
                    <div className="flex justify-between text-xs text-muted-foreground font-mono border-t border-border pt-4">
                      <span>{project.location || "TBD"}</span>
                      {project.targetDate && <span>Target: {new Date(project.targetDate).toLocaleDateString()}</span>}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
