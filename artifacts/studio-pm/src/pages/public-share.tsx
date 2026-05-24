import { useMemo, useState } from "react";
import { useParams } from "wouter";
import { useGetPublicShare, getGetPublicShareQueryKey } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import {
  AlertTriangle, Calendar, FileText, FolderKanban, ListChecks, Lock,
  Circle, Loader, Eye, CheckCircle2, FileSpreadsheet, FileImage, FileCode, FileArchive,
  Folder, FolderOpen, Home, ChevronRight,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

/**
 * Public, unauthenticated read-only view of a shared resource. Loaded at
 * `/s/:token`. For project shares we mirror the authenticated project
 * dashboard (overview + milestones + gantt + tasks + documents) so external
 * viewers see the same thing the team sees — minus the controls and the
 * sensitive bits (budget, internal IDs).
 */
export default function PublicShare() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useGetPublicShare(token ?? "", {
    query: { enabled: !!token, retry: false, queryKey: getGetPublicShareQueryKey(token ?? "") },
  });

  return (
    <div className="dark min-h-screen w-full bg-background text-foreground">
      <header className="border-b border-border/60 px-6 py-3 flex items-center justify-between sticky top-0 z-10 backdrop-blur bg-background/80">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-primary/15 ring-1 ring-primary/30 flex items-center justify-center">
            <span className="text-primary font-bold text-sm leading-none">C</span>
          </div>
          <span className="font-bricolage text-base font-semibold tracking-tight">Cue</span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground ml-2 flex items-center gap-1">
            <Lock className="w-3 h-3" /> Shared view
          </span>
        </div>
        {data?.createdAt && (
          <span className="text-[11px] text-muted-foreground font-mono">
            shared {format(new Date(data.createdAt), "PP")}
          </span>
        )}
      </header>

      <main className={`w-full px-6 py-8 ${data?.project ? "" : "max-w-4xl mx-auto"}`}>
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 rounded-full border-2 border-border border-t-primary animate-spin" />
          </div>
        )}

        {isError && (
          <div className="surface-card ring-hairline rounded-2xl p-10 text-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
            <h1 className="text-xl font-semibold">Link unavailable</h1>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              This share link is invalid, has been revoked, or has expired. Ask the person who shared it for a new one.
            </p>
          </div>
        )}

        {data?.project && (
          <ProjectView
            token={token ?? ""}
            project={data.project}
            milestones={data.milestones ?? []}
            tasks={data.tasks ?? []}
            documents={data.documents ?? []}
            folders={data.folders ?? []}
          />
        )}
        {data?.task && <TaskView task={data.task} projectName={data.projectName} />}
        {data?.document && (
          <DocumentView
            document={data.document}
            projectName={data.projectName}
            fileUrl={data.fileUrl}
            fileMimeType={data.fileMimeType}
          />
        )}
      </main>
    </div>
  );
}

// ─── shared tone maps (mirror project detail) ────────────────────────────────

const STATUS_TONE: Record<string, string> = {
  planning:    "text-blue-400 bg-blue-500/10 ring-blue-500/20",
  in_progress: "text-primary bg-primary/10 ring-primary/20",
  on_hold:     "text-amber-400 bg-amber-500/10 ring-amber-500/20",
  completed:   "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
};
const TASK_TONE: Record<string, string> = {
  todo:        "text-muted-foreground bg-muted/30 ring-border/60",
  in_progress: "text-blue-400 bg-blue-500/10 ring-blue-500/20",
  blocked:     "text-red-400 bg-red-500/10 ring-red-500/20",
  review:      "text-amber-400 bg-amber-500/10 ring-amber-500/20",
  done:        "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
};
const TASK_ICONS: Record<string, React.ReactNode> = {
  todo:        <Circle className="w-3 h-3" />,
  in_progress: <Loader className="w-3 h-3" />,
  blocked:     <AlertTriangle className="w-3 h-3" />,
  review:      <Eye className="w-3 h-3" />,
  done:        <CheckCircle2 className="w-3 h-3" />,
};
const PRIORITY_TONE: Record<string, string> = {
  low: "text-muted-foreground", medium: "text-blue-400", high: "text-amber-400", critical: "text-red-400",
};
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
const GANTT_COLOR_BAR: Record<string, string> = {
  blue:    "bg-blue-500/70 ring-blue-400/60",
  violet:  "bg-violet-500/70 ring-violet-400/60",
  amber:   "bg-amber-500/70 ring-amber-400/60",
  teal:    "bg-teal-500/70 ring-teal-400/60",
  emerald: "bg-emerald-500/70 ring-emerald-400/60",
  red:     "bg-red-500/70 ring-red-400/60",
  pink:    "bg-pink-500/70 ring-pink-400/60",
};
const CATEGORY_TONE: Record<string, string> = {
  spec:     "text-blue-400 bg-blue-500/10 ring-blue-500/20",
  plan:     "text-violet-400 bg-violet-500/10 ring-violet-500/20",
  permit:   "text-amber-400 bg-amber-500/10 ring-amber-500/20",
  vendor:   "text-teal-400 bg-teal-500/10 ring-teal-500/20",
  as_built: "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
  safety:   "text-red-400 bg-red-500/10 ring-red-500/20",
  general:  "text-muted-foreground bg-muted/40 ring-border/60",
};

function Pill({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={`text-[10px] uppercase tracking-[0.12em] font-mono px-2 py-1 rounded-md ring-1 ring-inset ${tone ?? "bg-muted/30 ring-border"}`}>
      {children}
    </span>
  );
}

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`surface-card ring-hairline border border-border/70 rounded-2xl ${className ?? ""}`}>
      <div className="px-5 pt-4 pb-3 border-b border-border/50">
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ─── PROJECT VIEW (mirrors authed dashboard) ─────────────────────────────────

function ProjectView({ token, project, milestones, tasks, documents, folders }: {
  token: string;
  project: any;
  milestones: any[];
  tasks: any[];
  documents: any[];
  folders: any[];
}) {
  const tone = STATUS_TONE[project.status] ?? "text-muted-foreground bg-muted/40 ring-border/60";

  // Compute progress client-side (same blend as the server uses)
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === "done").length;
  const totalMilestones = milestones.length;
  const completedMilestones = milestones.filter(m => m.status === "completed").length;
  const taskPct = totalTasks ? (completedTasks / totalTasks) * 100 : 0;
  const milestonePct = totalMilestones ? (completedMilestones / totalMilestones) * 100 : 0;
  const totalItems = totalTasks + totalMilestones;
  const overallPct = totalItems ? ((completedTasks + completedMilestones) / totalItems) * 100 : 0;

  const byCategory = (() => {
    const m = new Map<string, { total: number; completed: number }>();
    for (const t of tasks) {
      const entry = m.get(t.category) ?? { total: 0, completed: 0 };
      entry.total++;
      if (t.status === "done") entry.completed++;
      m.set(t.category, entry);
    }
    return [...m.entries()].map(([category, v]) => ({ category, ...v }));
  })();

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-7">
      {/* Header — matches projects/detail.tsx */}
      <div className="space-y-3 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-mono uppercase tracking-[0.12em] px-2 py-1 rounded-md ring-1 ring-inset ${tone}`}>
            {project.status?.replace("_", " ")}
          </span>
          {project.phase && (
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">· {project.phase}</span>
          )}
          {project.location && (
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">· {project.location}</span>
          )}
        </div>
        <h1 className="text-4xl font-semibold tracking-tight flex items-center gap-3">
          <FolderKanban className="w-7 h-7 text-primary" />
          {project.name}
        </h1>
        {project.description && (
          <p className="text-muted-foreground max-w-2xl leading-relaxed whitespace-pre-wrap">{project.description}</p>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-mono text-muted-foreground tabular-nums pt-1">
          {project.startDate && <span>Start: <span className="text-foreground/80">{format(new Date(project.startDate), "MMM dd, yyyy")}</span></span>}
          {project.targetDate && <span>Target: <span className="text-foreground/80">{format(new Date(project.targetDate), "MMM dd, yyyy")}</span></span>}
          {project.completedDate && <span>Completed: <span className="text-foreground/80">{format(new Date(project.completedDate), "MMM dd, yyyy")}</span></span>}
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-5">
        <TabsList className="bg-muted/40 ring-1 ring-inset ring-border/60">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-5 outline-none">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Panel className="md:col-span-2" title="Deployment Progress">
          <div className="space-y-6">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Overall completion</span>
                <span className="font-mono tabular-nums text-primary font-semibold">{Math.round(overallPct)}%</span>
              </div>
              <Progress value={overallPct} className="h-1.5 bg-muted/40" />
            </div>
            <div className="grid grid-cols-2 gap-5 pt-5 border-t border-border/50">
              <ProgressBlock label="Milestones" done={completedMilestones} total={totalMilestones} pct={milestonePct} />
              <ProgressBlock label="Tasks" done={completedTasks} total={totalTasks} pct={taskPct} />
            </div>
            {byCategory.length > 0 && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-4 pt-5 border-t border-border/50">
                {byCategory.map(cat => (
                  <div key={cat.category} className="space-y-1.5">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="capitalize text-foreground/80">{cat.category}</span>
                      <span className="text-muted-foreground tabular-nums">{cat.completed}/{cat.total}</span>
                    </div>
                    <Progress value={cat.total > 0 ? (cat.completed / cat.total) * 100 : 0} className="h-1 bg-muted/30" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Milestones">
          {milestones.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground font-mono">No milestones.</div>
          ) : (
            <ul className="space-y-3">
              {milestones.map(m => (
                <li key={m.id} className="flex items-start gap-2.5">
                  <span className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${MILESTONE_DOT[m.status] ?? "bg-muted-foreground/40"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{m.name}</div>
                    <div className="text-[11px] font-mono text-muted-foreground tabular-nums mt-0.5 flex items-center gap-2">
                      {m.dueDate && <span>{format(new Date(m.dueDate), "MMM dd, yyyy")}</span>}
                      <Pill tone={MILESTONE_TONE[m.status]}>{m.status?.replace("_", " ")}</Pill>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          </Panel>
          </div>
          <GanttChart milestones={milestones} projectStart={project.startDate} projectTarget={project.targetDate} />
        </TabsContent>

        <TabsContent value="tasks" className="outline-none space-y-4">
          <div className="text-[11px] font-mono text-muted-foreground tabular-nums">
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"} in this project
          </div>
          {tasks.length === 0 ? (
          <div className="surface-card ring-hairline border border-dashed border-border/70 rounded-2xl p-10 text-center text-sm text-muted-foreground font-mono">
            No tasks yet.
          </div>
        ) : (
          <div className="surface-card ring-hairline border border-border/70 rounded-2xl overflow-hidden divide-y divide-border/40">
            {tasks.map(t => {
              const isOverdue = t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "done";
              return (
                <div key={t.id} className="flex items-center gap-4 px-4 py-3">
                  <span className={`inline-flex items-center gap-1.5 w-[132px] text-[11px] font-medium px-2 py-1 rounded-md ring-1 ring-inset ${TASK_TONE[t.status] ?? TASK_TONE.todo}`}>
                    {TASK_ICONS[t.status]}
                    <span className="capitalize">{t.status?.replace("_", " ")}</span>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{t.title}</div>
                    <div className="text-[11px] text-muted-foreground font-mono flex gap-1.5 flex-wrap mt-0.5">
                      <span className="capitalize">{t.category}</span>
                      {t.milestoneName && <><span className="text-border">·</span><span>{t.milestoneName}</span></>}
                      {t.assigneeName && <><span className="text-border">·</span><span>{t.assigneeName}</span></>}
                      {t.dueDate && (
                        <>
                          <span className="text-border">·</span>
                          <span className={`tabular-nums ${isOverdue ? "text-red-400" : ""}`}>{format(new Date(t.dueDate), "MMM dd")}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className={`text-[10px] font-mono uppercase tracking-[0.12em] ${PRIORITY_TONE[t.priority] ?? ""}`}>
                    {t.priority}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        </TabsContent>

        <TabsContent value="documents" className="outline-none">
          <PublicDocumentsTab token={token} documents={documents} folders={folders} />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}

// ─── DOCUMENTS TAB (folder tree + tiles, read-only) ──────────────────────────

type Folder = { id: number; parentId?: number | null; name: string };
type FolderNode = Folder & { children: FolderNode[] };

function buildTree(folders: Folder[]): FolderNode[] {
  const byId = new Map<number, FolderNode>();
  for (const f of folders) byId.set(f.id, { ...f, children: [] });
  const roots: FolderNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId != null && byId.has(node.parentId)) byId.get(node.parentId)!.children.push(node);
    else roots.push(node);
  }
  const sort = (ns: FolderNode[]) => { ns.sort((a, b) => a.name.localeCompare(b.name)); ns.forEach(n => sort(n.children)); };
  sort(roots);
  return roots;
}

function PublicDocumentsTab({ token, documents, folders }: { token: string; documents: any[]; folders: Folder[] }) {
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const tree = useMemo(() => buildTree(folders), [folders]);

  const folderById = useMemo(() => {
    const m = new Map<number, Folder>();
    for (const f of folders) m.set(f.id, f);
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
      cur = f.parentId ?? null;
    }
    return out.concat(chain);
  }, [currentFolderId, folderById]);

  const currentSubfolders = folders
    .filter(f => (f.parentId ?? null) === currentFolderId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const docsInFolder = documents.filter(d => (d.folderId ?? null) === currentFolderId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
      <div className="surface-card ring-hairline border border-border/70 rounded-2xl p-3 self-start lg:sticky lg:top-4">
        <div className="px-2 py-1.5 mb-1">
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Folders</span>
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
        {tree.length === 0 ? (
          <div className="text-[11px] font-mono text-muted-foreground/70 px-2 py-3 text-center">No folders</div>
        ) : (
          <div className="mt-1 space-y-0.5">
            {tree.map(node => (
              <PublicFolderTreeItem key={node.id} node={node} depth={0} currentId={currentFolderId} onSelect={setCurrentFolderId} />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-4 min-w-0">
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

        {currentSubfolders.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {currentSubfolders.map(f => (
              <button
                key={f.id}
                onClick={() => setCurrentFolderId(f.id)}
                onDoubleClick={() => setCurrentFolderId(f.id)}
                className="group surface-card ring-hairline border border-border/70 rounded-xl px-3 py-2.5 flex items-center gap-2 text-left hover:border-border hover:-translate-y-0.5 hover:shadow-md transition-all"
              >
                <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-sm font-medium truncate flex-1">{f.name}</span>
              </button>
            ))}
          </div>
        )}

        {docsInFolder.length === 0 ? (
          currentSubfolders.length === 0 ? (
            <div className="surface-card ring-hairline border border-dashed border-border/70 rounded-2xl p-10 text-center text-sm text-muted-foreground font-mono">
              {currentFolderId == null ? "No documents in this project." : "This folder is empty."}
            </div>
          ) : null
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {docsInFolder.map(d => <PublicDocTile key={d.id} token={token} doc={d} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function PublicFolderTreeItem({
  node, depth, currentId, onSelect,
}: { node: FolderNode; depth: number; currentId: number | null; onSelect: (id: number) => void }) {
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
      </div>
      {expanded && node.children.length > 0 && (
        <div>
          {node.children.map(c => (
            <PublicFolderTreeItem key={c.id} node={c} depth={depth + 1} currentId={currentId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

const EXT_META: Record<string, { icon: React.ReactNode; tone: string }> = {
  CSV:  { icon: <FileSpreadsheet className="w-4 h-4" />, tone: "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20" },
  XLSX: { icon: <FileSpreadsheet className="w-4 h-4" />, tone: "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20" },
  PDF:  { icon: <FileText className="w-4 h-4" />,        tone: "text-red-400 bg-red-500/10 ring-red-500/20" },
  DOC:  { icon: <FileText className="w-4 h-4" />,        tone: "text-blue-400 bg-blue-500/10 ring-blue-500/20" },
  DOCX: { icon: <FileText className="w-4 h-4" />,        tone: "text-blue-400 bg-blue-500/10 ring-blue-500/20" },
  PNG:  { icon: <FileImage className="w-4 h-4" />,       tone: "text-pink-400 bg-pink-500/10 ring-pink-500/20" },
  JPG:  { icon: <FileImage className="w-4 h-4" />,       tone: "text-pink-400 bg-pink-500/10 ring-pink-500/20" },
  JPEG: { icon: <FileImage className="w-4 h-4" />,       tone: "text-pink-400 bg-pink-500/10 ring-pink-500/20" },
  SVG:  { icon: <FileImage className="w-4 h-4" />,       tone: "text-purple-400 bg-purple-500/10 ring-purple-500/20" },
  DWG:  { icon: <FileCode className="w-4 h-4" />,        tone: "text-orange-400 bg-orange-500/10 ring-orange-500/20" },
  ZIP:  { icon: <FileArchive className="w-4 h-4" />,     tone: "text-yellow-400 bg-yellow-500/10 ring-yellow-500/20" },
};

function PublicDocTile({ token, doc }: { token: string; doc: any }) {
  const tone = CATEGORY_TONE[doc.category] ?? CATEGORY_TONE.general;
  const ext = (doc.url ?? "").split(".").pop()?.toUpperCase() ?? "";
  const meta = EXT_META[ext] ?? { icon: <FileText className="w-4 h-4" />, tone: "text-muted-foreground bg-muted/40 ring-border/60" };

  // For uploaded files, route through the public-share streaming endpoint so
  // we don't need auth. For external URLs, just open them directly.
  const isUpload = typeof doc.url === "string" && doc.url.startsWith("/api/uploads/");
  const href = isUpload
    ? `/api/public/shares/${token}/documents/${doc.id}/file`
    : (doc.url ?? "#");

  function handleOpen() {
    if (href === "#") return;
    window.open(href, "_blank", "noopener,noreferrer");
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onDoubleClick={handleOpen}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleOpen(); } }}
      title={doc.title}
      className="group relative surface-card ring-hairline border border-border/70 rounded-xl p-3 flex flex-col items-center text-center gap-2 hover:border-border hover:-translate-y-0.5 hover:shadow-md transition-all cursor-pointer"
    >
      <div className={`mt-2 w-14 h-14 rounded-xl flex flex-col items-center justify-center ring-1 ring-inset ${meta.tone} gap-0.5`}>
        <div className="[&>svg]:w-6 [&>svg]:h-6">{meta.icon}</div>
        {ext && <span className="text-[8px] font-bold font-mono leading-none">{ext}</span>}
      </div>
      <div className="w-full min-w-0 space-y-1">
        <div className="text-[12.5px] font-medium leading-snug line-clamp-2 break-words">{doc.title}</div>
        <div className="flex items-center justify-center gap-1 flex-wrap">
          <span className={`text-[9px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-md ring-1 ring-inset ${tone}`}>
            {doc.category?.replace("_", " ")}
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
    </div>
  );
}

function ProgressBlock({ label, done, total, pct }: { label: string; done: number; total: number; pct: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs font-mono">
        <span className="uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
        <span className="text-foreground/80 tabular-nums">
          {done}/{total}
          <span className="text-muted-foreground"> · {Math.round(pct)}%</span>
        </span>
      </div>
      <Progress value={pct} className="h-1 bg-muted/30" />
    </div>
  );
}

// ─── GANTT (port of authed dashboard, read-only) ─────────────────────────────

function GanttChart({ milestones, projectStart, projectTarget }: {
  milestones: any[]; projectStart?: string | null; projectTarget?: string | null;
}) {
  const dated = milestones.filter(m => m.dueDate);
  const range = (() => {
    const dates: number[] = [];
    if (projectStart) dates.push(new Date(projectStart).getTime());
    if (projectTarget) dates.push(new Date(projectTarget).getTime());
    for (const m of dated) dates.push(new Date(m.dueDate).getTime());
    if (dates.length === 0) return null;
    let min = Math.min(...dates);
    let max = Math.max(...dates);
    if (min === max) { min -= 7 * 86400_000; max += 7 * 86400_000; }
    const pad = (max - min) * 0.05;
    return { min: min - pad, max: max + pad };
  })();
  const pct = (iso?: string | null) => {
    if (!iso || !range) return 0;
    return Math.max(0, Math.min(100, ((new Date(iso).getTime() - range.min) / (range.max - range.min)) * 100));
  };
  const ticks: { pct: number; label: string }[] = [];
  if (range) {
    const start = new Date(range.min);
    const end = new Date(range.max);
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    if (cursor.getTime() < start.getTime()) cursor.setMonth(cursor.getMonth() + 1);
    const span = range.max - range.min;
    const step = span > 86400_000 * 365 * 1.5 ? 3 : span > 86400_000 * 180 ? 2 : 1;
    while (cursor.getTime() <= end.getTime()) {
      ticks.push({ pct: ((cursor.getTime() - range.min) / span) * 100, label: format(cursor, "MMM yyyy") });
      cursor.setMonth(cursor.getMonth() + step);
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
        {dated.length === 0 || !range ? (
          <div className="text-center py-8 text-sm text-muted-foreground font-mono">No dated milestones.</div>
        ) : (
          <div className="flex">
            <div className="w-44 shrink-0 pr-3 space-y-2">
              <div className="h-6" />
              {dated.map(m => (
                <div key={m.id} className="h-7 flex items-center text-xs truncate text-foreground/80" title={m.name}>{m.name}</div>
              ))}
            </div>
            <div className="flex-1 min-w-0 relative">
              <div className="h-6 relative border-b border-border/50">
                {ticks.map((t, i) => (
                  <div key={i} className="absolute top-0 bottom-0 flex items-end pb-1" style={{ left: `${t.pct}%` }}>
                    <div className="text-[9.5px] font-mono text-muted-foreground -translate-x-1/2 whitespace-nowrap">{t.label}</div>
                  </div>
                ))}
              </div>
              <div className="relative pt-2 space-y-2">
                <div className="absolute inset-0 pointer-events-none">
                  {ticks.map((t, i) => (
                    <div key={i} className="absolute top-0 bottom-0 w-px bg-border/30" style={{ left: `${t.pct}%` }} />
                  ))}
                </div>
                {projectStart && projectTarget && (() => {
                  const a = pct(projectStart); const b = pct(projectTarget);
                  return <div className="absolute top-0 bottom-0 bg-primary/[0.04] border-x border-dashed border-primary/30"
                    style={{ left: `${Math.min(a, b)}%`, width: `${Math.max(0.5, Math.abs(b - a))}%` }} />;
                })()}
                {todayPct != null && (
                  <div className="absolute top-0 bottom-0 w-px bg-primary/70 z-10" style={{ left: `${todayPct}%` }}>
                    <div className="absolute -top-1 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-primary" />
                  </div>
                )}
                {dated.map((m, idx) => {
                  const endPct = pct(m.dueDate);
                  const startPct = idx === 0 ? pct(projectStart ?? dated[0].dueDate) : pct(dated[idx - 1].dueDate);
                  const left = Math.min(startPct, endPct);
                  const width = Math.max(1.5, Math.abs(endPct - startPct));
                  const color = GANTT_COLOR_BAR[m.color ?? "blue"] ?? GANTT_COLOR_BAR.blue;
                  const completed = m.status === "completed";
                  const missed = m.status === "missed";
                  return (
                    <div key={m.id} className="h-7 relative">
                      <div className={`absolute top-1/2 -translate-y-1/2 h-3 rounded-sm ring-1 ring-inset ${color} ${
                        completed ? "opacity-100" : missed ? "opacity-60 ring-red-500/70 bg-red-500/40" : "opacity-70"
                      }`} style={{ left: `${left}%`, width: `${width}%` }} />
                      <div className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45 ${
                        completed ? "bg-emerald-400" : missed ? "bg-red-400" : "bg-foreground/70"
                      } ring-1 ring-background z-[1]`} style={{ left: `${endPct}%` }} />
                      <div className="absolute top-1/2 -translate-y-1/2 text-[9.5px] font-mono tabular-nums text-muted-foreground whitespace-nowrap pointer-events-none"
                        style={{ left: `calc(${endPct}% + 8px)` }}>
                        {format(new Date(m.dueDate), "MMM d")}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TASK / DOCUMENT single-resource views (unchanged behavior) ──────────────

function TaskView({ task, projectName }: { task: any; projectName?: string }) {
  return (
    <motion.article initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex items-start gap-3">
        <ListChecks className="w-6 h-6 text-primary mt-1" />
        <div className="flex-1 min-w-0">
          {projectName && <p className="text-xs text-muted-foreground mb-1 font-mono uppercase tracking-wider">{projectName}</p>}
          <h1 className="font-bricolage text-2xl font-semibold tracking-tight">{task.title}</h1>
        </div>
        <Pill tone={TASK_TONE[task.status]}>{task.status?.replace("_", " ")}</Pill>
      </div>
      {task.description && (
        <p className="text-base text-muted-foreground leading-relaxed whitespace-pre-wrap">{task.description}</p>
      )}
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 surface-card ring-hairline rounded-xl p-4">
        <Field label="Priority" value={task.priority} />
        <Field label="Category" value={task.category?.replace("_", " ")} />
        <Field label="Due" value={task.dueDate ? format(new Date(task.dueDate), "PP") : undefined}
          icon={<Calendar className="w-3 h-3" />} />
      </dl>
    </motion.article>
  );
}

function DocumentView({ document, projectName, fileUrl, fileMimeType }:
  { document: any; projectName?: string; fileUrl?: string; fileMimeType?: string }) {
  const isImage = fileMimeType?.startsWith("image/");
  const isPdf = fileMimeType === "application/pdf";
  return (
    <motion.article initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex items-start gap-3">
        <FileText className="w-6 h-6 text-primary mt-1" />
        <div className="flex-1 min-w-0">
          {projectName && <p className="text-xs text-muted-foreground mb-1 font-mono uppercase tracking-wider">{projectName}</p>}
          <h1 className="font-bricolage text-2xl font-semibold tracking-tight">{document.title}</h1>
        </div>
        <Pill tone={CATEGORY_TONE[document.category]}>{document.category?.replace("_", " ")}</Pill>
      </div>
      {document.description && (
        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{document.description}</p>
      )}
      {fileUrl && isPdf && (
        <iframe src={fileUrl} className="w-full h-[80vh] rounded-xl ring-1 ring-border bg-black/30" title={document.title} />
      )}
      {fileUrl && isImage && (
        <div className="surface-card ring-hairline rounded-xl p-4 flex items-center justify-center">
          <img src={fileUrl} alt={document.title} className="max-w-full max-h-[80vh] rounded" />
        </div>
      )}
      {fileUrl && !isPdf && !isImage && (
        <a href={fileUrl} download
          className="surface-card ring-hairline rounded-xl p-4 flex items-center gap-3 hover:border-primary/40 transition">
          <FileText className="w-8 h-8 text-primary" />
          <div className="flex-1">
            <div className="text-sm font-medium">Download file</div>
            <div className="text-xs text-muted-foreground">{fileMimeType ?? "Binary file"}</div>
          </div>
        </a>
      )}
      {!fileUrl && document.url && (
        <a href={document.url} target="_blank" rel="noopener noreferrer"
           className="text-primary text-sm hover:underline break-all">{document.url}</a>
      )}
      {document.notes && (
        <div className="surface-card ring-hairline rounded-xl p-4 text-sm text-muted-foreground whitespace-pre-wrap">
          {document.notes}
        </div>
      )}
    </motion.article>
  );
}

function Field({ label, value, icon }: { label: string; value?: string | null; icon?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-mono">{label}</dt>
      <dd className="text-sm font-medium mt-0.5 flex items-center gap-1.5">
        {icon}
        {value || <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

function DocIcon({ mime, className }: { mime?: string; className?: string }) {
  if (!mime) return <FileText className={className} />;
  if (mime.startsWith("image/")) return <FileImage className={className} />;
  if (mime.includes("spreadsheet") || mime.includes("csv") || mime.includes("excel")) return <FileSpreadsheet className={className} />;
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("compressed")) return <FileArchive className={className} />;
  if (mime.includes("json") || mime.includes("xml") || mime.includes("javascript") || mime.includes("yaml")) return <FileCode className={className} />;
  return <FileText className={className} />;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
