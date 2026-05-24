import { useParams } from "wouter";
import { useGetPublicShare, getGetPublicShareQueryKey } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { AlertTriangle, Calendar, FileText, FolderKanban, ListChecks, Lock } from "lucide-react";

/**
 * Public, unauthenticated read-only view of a shared resource. Loaded at
 * `/s/:token`. Renders different layouts based on what was shared (project /
 * task / document) and stays deliberately bare — no nav, no editing, no
 * sign-in prompts — so external viewers don't see Cue's internals.
 */
export default function PublicShare() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useGetPublicShare(token ?? "", {
    query: { enabled: !!token, retry: false, queryKey: getGetPublicShareQueryKey(token ?? "") },
  });

  return (
    <div className="dark min-h-screen w-full bg-background text-foreground">
      <header className="border-b border-border/60 px-6 py-3 flex items-center justify-between">
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

      <main className="max-w-4xl mx-auto px-6 py-10">
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

        {data?.project && <ProjectView project={data.project} />}
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

const STATUS_TONE: Record<string, string> = {
  planning:    "text-blue-400 bg-blue-500/10 ring-blue-500/20",
  in_progress: "text-primary bg-primary/10 ring-primary/20",
  on_hold:     "text-amber-400 bg-amber-500/10 ring-amber-500/20",
  completed:   "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
  todo:        "text-muted-foreground bg-muted/20 ring-border",
  blocked:     "text-red-400 bg-red-500/10 ring-red-500/20",
  review:      "text-amber-400 bg-amber-500/10 ring-amber-500/20",
  done:        "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
};

function Pill({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={`text-[10px] uppercase tracking-[0.14em] font-mono px-2 py-0.5 rounded-md ring-1 ring-inset ${tone ?? "bg-muted/30 ring-border"}`}>
      {children}
    </span>
  );
}

function ProjectView({ project }: { project: any }) {
  return (
    <motion.article initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex items-start gap-3">
        <FolderKanban className="w-6 h-6 text-primary mt-1" />
        <div className="flex-1 min-w-0">
          <h1 className="font-bricolage text-3xl font-semibold tracking-tight">{project.name}</h1>
          {project.location && <p className="text-sm text-muted-foreground mt-1">{project.location}</p>}
        </div>
        <Pill tone={STATUS_TONE[project.status]}>{project.status?.replace("_", " ")}</Pill>
      </div>

      {project.description && (
        <p className="text-base text-muted-foreground leading-relaxed whitespace-pre-wrap">{project.description}</p>
      )}

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 surface-card ring-hairline rounded-xl p-4">
        <Field label="Phase" value={project.phase} />
        <Field label="Start" value={project.startDate} />
        <Field label="Target" value={project.targetDate} />
        <Field label="Completed" value={project.completedDate} />
      </dl>
    </motion.article>
  );
}

function TaskView({ task, projectName }: { task: any; projectName?: string }) {
  return (
    <motion.article initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex items-start gap-3">
        <ListChecks className="w-6 h-6 text-primary mt-1" />
        <div className="flex-1 min-w-0">
          {projectName && <p className="text-xs text-muted-foreground mb-1 font-mono uppercase tracking-wider">{projectName}</p>}
          <h1 className="font-bricolage text-2xl font-semibold tracking-tight">{task.title}</h1>
        </div>
        <Pill tone={STATUS_TONE[task.status]}>{task.status?.replace("_", " ")}</Pill>
      </div>

      {task.description && (
        <p className="text-base text-muted-foreground leading-relaxed whitespace-pre-wrap">{task.description}</p>
      )}

      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 surface-card ring-hairline rounded-xl p-4">
        <Field label="Priority" value={task.priority} />
        <Field label="Category" value={task.category?.replace("_", " ")} />
        <Field
          label="Due"
          value={task.dueDate ? format(new Date(task.dueDate), "PP") : undefined}
          icon={<Calendar className="w-3 h-3" />}
        />
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
        <Pill>{document.category?.replace("_", " ")}</Pill>
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
        <a
          href={fileUrl} download
          className="surface-card ring-hairline rounded-xl p-4 flex items-center gap-3 hover:border-primary/40 transition"
        >
          <FileText className="w-8 h-8 text-primary" />
          <div className="flex-1">
            <div className="text-sm font-medium">Download file</div>
            <div className="text-xs text-muted-foreground">{fileMimeType ?? "Binary file"}</div>
          </div>
        </a>
      )}
      {!fileUrl && document.url && (
        <a href={document.url} target="_blank" rel="noopener noreferrer"
           className="text-primary text-sm hover:underline break-all">
          {document.url}
        </a>
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
