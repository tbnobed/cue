import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProjects, useCreateProject, getListProjectsQueryKey,
  type Project,
} from "@workspace/api-client-react";
import { MapPin, ArrowUpRight, Plus, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { MobileFab } from "@/components/layout/mobile-shell";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const STATUS_META: Record<Project["status"], { tone: "violet" | "blue" | "emerald" | "amber"; label: string }> = {
  in_progress: { tone: "violet",  label: "In Progress" },
  planning:    { tone: "blue",    label: "Planning" },
  completed:   { tone: "emerald", label: "Completed" },
  on_hold:     { tone: "amber",   label: "On Hold" },
};

export default function MobileProjects() {
  const { data: projects, isLoading } = useListProjects();
  const [createOpen, setCreateOpen] = useState(false);

  const active = (projects ?? []).filter((p) => p.status === "in_progress").length;

  return (
    <>
      <div className="mhead">
        <div className="k">Projects</div>
        <h2>Active deployments</h2>
        <p>
          {isLoading ? "Loading…"
            : `${projects?.length ?? 0} total · ${active} in motion`}
        </p>
      </div>

      {isLoading ? (
        <div className="m-glass" style={{ padding: 32, textAlign: "center" }}>
          <Loader2 className="w-5 h-5 animate-spin inline" />
        </div>
      ) : (projects ?? []).length === 0 ? (
        <div className="mempty m-glass">
          <div className="orb" />
          <b>No projects yet</b>
          <span>Tap the + to spin up your first studio build.</span>
        </div>
      ) : (
        (projects ?? []).map((p) => {
          const meta = STATUS_META[p.status] ?? STATUS_META.planning;
          // Cheap progress estimate by status (real progress hook is per-project).
          const pct = p.status === "completed" ? 100
            : p.status === "in_progress" ? 60
            : p.status === "on_hold" ? 30 : 10;
          return (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className={`mproj ${meta.tone}`}
              data-testid={`mobile-project-${p.id}`}
            >
              <div className="top">
                <span className="mtag"><span className="dot" />{meta.label}</span>
                <div className="arrow"><ArrowUpRight /></div>
              </div>
              <h3>{p.name}</h3>
              {p.description && <p>{p.description}</p>}
              <div className="mprog">
                <div className="l">Build progress <b>{pct}%</b></div>
                <div className="bar"><i style={{ width: `${pct}%` }} /></div>
              </div>
              <div className="ft">
                <span><MapPin />{p.location || "—"}</span>
                <span>{p.targetDate ? format(new Date(p.targetDate), "MMM d") : "no date"}</span>
              </div>
            </Link>
          );
        })
      )}

      <MobileFab label="New project" onClick={() => setCreateOpen(true)}>
        <Plus />
      </MobileFab>
      <NewProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLoc] = useState("");
  const [status, setStatus] = useState<Project["status"]>("planning");

  const create = useCreateProject({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        toast({ title: "Project created" });
        setName(""); setDescription(""); setLoc(""); setStatus("planning");
        onOpenChange(false);
      },
      onError: (err) => toast({ title: "Couldn't create", description: String(err), variant: "destructive" }),
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
        <form
          className="space-y-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            create.mutate({ data: {
              name: name.trim(),
              description: description.trim() || undefined,
              location: location.trim() || undefined,
              status,
            } });
          }}
        >
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus data-testid="input-mobile-project-name" />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>Location</Label>
            <Input value={location} onChange={(e) => setLoc(e.target.value)} placeholder="Bldg 1 · Fl 2" />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as Project["status"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="planning">Planning</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="on_hold">On hold</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || create.isPending} data-testid="button-mobile-create-project">
              {create.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
