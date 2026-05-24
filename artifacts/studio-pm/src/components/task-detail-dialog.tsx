import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, Calendar, CheckCircle2, Circle, Clock, Eye, Loader2,
  ListChecks, Pencil, Tag, User, Flag, Layers, FileText,
} from "lucide-react";
import { format } from "date-fns";

const STATUS_TONE: Record<string, string> = {
  todo:        "text-muted-foreground bg-muted/40 ring-border/60",
  in_progress: "text-blue-400 bg-blue-500/10 ring-blue-500/20",
  blocked:     "text-red-400 bg-red-500/10 ring-red-500/20",
  review:      "text-amber-400 bg-amber-500/10 ring-amber-500/20",
  done:        "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  todo: <Circle className="w-3 h-3" />,
  in_progress: <Loader2 className="w-3 h-3 animate-spin" />,
  blocked: <AlertTriangle className="w-3 h-3" />,
  review: <Eye className="w-3 h-3" />,
  done: <CheckCircle2 className="w-3 h-3" />,
};

const PRIORITY_TONE: Record<string, string> = {
  low:      "text-muted-foreground",
  medium:   "text-blue-400",
  high:     "text-amber-400",
  critical: "text-red-400",
};

export interface TaskDetailDialogProps {
  task: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, an "Edit" button is shown. Authed-only. */
  onEdit?: (task: any) => void;
  /** Optional share button slot. Pass a configured `<ShareDialog />`. */
  shareSlot?: React.ReactNode;
}

/**
 * Read-only task detail dialog. Reused on the Tasks page, the Project
 * detail page, and the public share view so a task looks the same wherever
 * it's opened. Authed callers pass `onEdit` to expose the edit button.
 */
export function TaskDetailDialog({ task, open, onOpenChange, onEdit, shareSlot }: TaskDetailDialogProps) {
  if (!task) return null;
  const status = String(task.status ?? "todo");
  const priority = String(task.priority ?? "medium");
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && status !== "done";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <div className="flex items-start gap-3">
            <ListChecks className="w-5 h-5 text-primary mt-1 shrink-0" />
            <div className="flex-1 min-w-0">
              {task.projectName && (
                <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground mb-1">
                  {task.projectName}
                </div>
              )}
              <DialogTitle className="text-xl font-semibold tracking-tight break-words">
                {task.title}
              </DialogTitle>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Status + priority pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md ring-1 ring-inset ${STATUS_TONE[status] ?? STATUS_TONE.todo}`}>
              {STATUS_ICONS[status]}
              <span className="capitalize">{status.replace("_", " ")}</span>
            </span>
            <span className={`text-[10px] font-mono uppercase tracking-[0.12em] px-2 py-1 rounded-md bg-muted/40 ring-1 ring-inset ring-border/60 ${PRIORITY_TONE[priority] ?? ""}`}>
              <Flag className="w-2.5 h-2.5 inline mr-1 -mt-0.5" />
              {priority}
            </span>
            {task.dueDate && (
              <span className={`text-[11px] font-mono tabular-nums px-2 py-1 rounded-md ring-1 ring-inset ring-border/60 bg-muted/30 flex items-center gap-1 ${isOverdue ? "text-red-400" : "text-foreground/80"}`}>
                <Clock className="w-3 h-3" />
                {format(new Date(task.dueDate), "MMM d, yyyy")}
                {isOverdue && <span className="uppercase tracking-wider text-[9px] ml-1">overdue</span>}
              </span>
            )}
          </div>

          {/* Description */}
          {task.description ? (
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5">
                <FileText className="w-3 h-3" /> Description
              </div>
              <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">
                {task.description}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">No description provided.</p>
          )}

          {/* Metadata grid */}
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 surface-card ring-hairline rounded-xl p-4">
            <Field icon={<Tag className="w-3 h-3" />} label="Category" value={task.category?.replace("_", " ")} />
            <Field icon={<Layers className="w-3 h-3" />} label="Milestone" value={task.milestoneName} />
            <Field icon={<User className="w-3 h-3" />} label="Assignee" value={task.assigneeName} />
            <Field icon={<Calendar className="w-3 h-3" />} label="Due" value={task.dueDate ? format(new Date(task.dueDate), "PP") : undefined} />
            <Field icon={<Clock className="w-3 h-3" />} label="Created" value={task.createdAt ? format(new Date(task.createdAt), "PP") : undefined} />
            <Field icon={<Clock className="w-3 h-3" />} label="Updated" value={task.updatedAt ? format(new Date(task.updatedAt), "PP") : undefined} />
          </dl>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
          {shareSlot}
          {onEdit && (
            <Button
              size="sm" className="gap-2"
              onClick={() => { onOpenChange(false); onEdit(task); }}
              data-testid="button-edit-task-from-detail"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ icon, label, value }: { icon?: React.ReactNode; label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-mono flex items-center gap-1">
        {icon}{label}
      </dt>
      <dd className="text-sm font-medium mt-0.5 truncate">
        {value || <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

