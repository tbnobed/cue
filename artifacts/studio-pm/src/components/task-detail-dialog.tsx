import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle, Calendar, CheckCircle2, Circle, Clock, Eye, Loader2,
  ListChecks, Pencil, Tag, User, Flag, Layers, FileText, MessageSquarePlus,
  Upload, FolderPlus, Trash2, FolderOpen, ArrowLeft,
} from "lucide-react";
import { format } from "date-fns";
import { useRef, useState } from "react";
import {
  useListDocuments,
  useListFolders,
  useCreateFolder,
  useDeleteDocument,
  useDeleteFolder,
  useListTaskNotes,
  useCreateTaskNote,
  getListDocumentsQueryKey,
  getListFoldersQueryKey,
  getListTaskNotesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

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
  /** When provided, an "Edit" button is shown and Documents/Notes tabs are enabled. Authed-only. */
  onEdit?: (task: any) => void;
  /** Optional share button slot. Pass a configured `<ShareDialog />`. */
  shareSlot?: React.ReactNode;
}

export function TaskDetailDialog({ task, open, onOpenChange, onEdit, shareSlot }: TaskDetailDialogProps) {
  const [tab, setTab] = useState("details");
  const authed = !!onEdit;
  if (!task) return null;
  const status = String(task.status ?? "todo");
  const priority = String(task.priority ?? "medium");
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && status !== "done";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setTab("details"); onOpenChange(o); }}>
      <DialogContent
        className="max-w-3xl"
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

        {authed ? (
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="documents" data-testid="tab-task-documents">Documents</TabsTrigger>
              <TabsTrigger value="notes" data-testid="tab-task-notes">Notes</TabsTrigger>
            </TabsList>
            <TabsContent value="details" className="mt-4">
              <DetailsBody task={task} status={status} priority={priority} isOverdue={isOverdue} />
            </TabsContent>
            <TabsContent value="documents" className="mt-4">
              <TaskDocumentsPanel taskId={task.id} />
            </TabsContent>
            <TabsContent value="notes" className="mt-4">
              <TaskNotesPanel taskId={task.id} />
            </TabsContent>
          </Tabs>
        ) : (
          <DetailsBody task={task} status={status} priority={priority} isOverdue={isOverdue} />
        )}

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

function DetailsBody({ task, status, priority, isOverdue }: { task: any; status: string; priority: string; isOverdue: boolean }) {
  return (
    <div className="space-y-5 py-2">
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

      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 surface-card ring-hairline rounded-xl p-4">
        <Field icon={<Tag className="w-3 h-3" />} label="Category" value={task.category?.replace("_", " ")} />
        <Field icon={<Layers className="w-3 h-3" />} label="Milestone" value={task.milestoneName} />
        <Field icon={<User className="w-3 h-3" />} label="Assignee" value={task.assigneeName} />
        <Field icon={<Calendar className="w-3 h-3" />} label="Due" value={task.dueDate ? format(new Date(task.dueDate), "PP") : undefined} />
        <Field icon={<Clock className="w-3 h-3" />} label="Created" value={task.createdAt ? format(new Date(task.createdAt), "PP") : undefined} />
        <Field icon={<Clock className="w-3 h-3" />} label="Updated" value={task.updatedAt ? format(new Date(task.updatedAt), "PP") : undefined} />
      </dl>
    </div>
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

// ── Documents panel ────────────────────────────────────────────────────────
function TaskDocumentsPanel({ taskId }: { taskId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);

  const docsParams = { taskId, ...(folderId != null ? { folderId } : { folderId: 0 }) } as any;
  const { data: docs, isLoading: docsLoading } = useListDocuments(docsParams);
  const { data: folders, isLoading: foldersLoading } = useListFolders({ taskId } as any);

  const createFolder = useCreateFolder();
  const deleteDoc = useDeleteDocument();
  const deleteFolder = useDeleteFolder();

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
    qc.invalidateQueries({ queryKey: getListFoldersQueryKey() });
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    let ok = 0;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", file.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " "));
      fd.append("category", "general");
      fd.append("taskId", String(taskId));
      if (folderId != null) fd.append("folderId", String(folderId));
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
    const name = newFolderName.trim();
    if (!name) return;
    try {
      await createFolder.mutateAsync({ data: { name, taskId, parentId: folderId ?? undefined } as any });
      setNewFolderName(""); setShowNewFolder(false);
      invalidate();
    } catch {
      toast({ title: "Failed to create folder", variant: "destructive" });
    }
  }

  async function handleDeleteDoc(id: number) {
    try { await deleteDoc.mutateAsync({ id }); invalidate(); }
    catch { toast({ title: "Failed to delete document", variant: "destructive" }); }
  }

  async function handleDeleteFolder(id: number) {
    try { await deleteFolder.mutateAsync({ id }); invalidate(); }
    catch { toast({ title: "Folder not empty or delete failed", variant: "destructive" }); }
  }

  const currentFolder = folders?.find(f => f.id === folderId);
  const visibleFolders = (folders ?? []).filter(f => (f.parentId ?? null) === folderId);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {folderId != null && (
          <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => setFolderId(currentFolder?.parentId ?? null)}>
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </Button>
        )}
        <div className="text-[11px] font-mono text-muted-foreground truncate">
          {folderId == null ? "/ root" : `/ ${currentFolder?.name ?? "…"}`}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => setShowNewFolder(s => !s)} data-testid="button-new-task-folder">
            <FolderPlus className="w-3.5 h-3.5" /> New folder
          </Button>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
          <Button size="sm" className="h-8 gap-1.5" onClick={() => fileInputRef.current?.click()} disabled={uploading} data-testid="button-upload-task-doc">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </div>

      {showNewFolder && (
        <div className="flex items-center gap-2">
          <Input
            autoFocus value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCreateFolder(); if (e.key === "Escape") { setShowNewFolder(false); setNewFolderName(""); } }}
            placeholder="Folder name"
            className="h-8 text-xs"
          />
          <Button size="sm" className="h-8" onClick={handleCreateFolder} disabled={createFolder.isPending || !newFolderName.trim()}>Add</Button>
        </div>
      )}

      {/* List */}
      <div className="surface-card ring-hairline border border-border/70 rounded-xl divide-y divide-border/40 min-h-[120px] max-h-[40vh] overflow-y-auto">
        {(foldersLoading || docsLoading) ? (
          <div className="p-3 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-9 w-full rounded-md" />)}</div>
        ) : visibleFolders.length === 0 && (docs ?? []).length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground font-mono">
            No documents or folders attached to this task yet.
          </div>
        ) : (
          <>
            {visibleFolders.map(f => (
              <div key={`f-${f.id}`} className="group flex items-center gap-2 px-3 py-2 hover:bg-background/40">
                <button type="button" className="flex items-center gap-2 flex-1 min-w-0 text-left" onClick={() => setFolderId(f.id)}>
                  <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-sm truncate">{f.name}</span>
                </button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100"
                  onClick={() => handleDeleteFolder(f.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
            {(docs ?? []).map(d => (
              <div key={`d-${d.id}`} className="group flex items-center gap-2 px-3 py-2 hover:bg-background/40">
                <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer" className="text-sm hover:text-primary truncate block">{d.title}</a>
                  ) : (
                    <span className="text-sm truncate block">{d.title}</span>
                  )}
                  <div className="text-[10px] font-mono text-muted-foreground">
                    {d.category}{d.updatedAt ? ` · ${format(new Date(d.updatedAt), "MMM d, yyyy")}` : ""}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100"
                  onClick={() => handleDeleteDoc(d.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── Notes panel ────────────────────────────────────────────────────────────
function TaskNotesPanel({ taskId }: { taskId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const { data: notes, isLoading } = useListTaskNotes(taskId);
  const createNote = useCreateTaskNote();

  async function add() {
    const text = body.trim();
    if (!text) return;
    try {
      await createNote.mutateAsync({ taskId, data: { body: text } as any });
      setBody("");
      qc.invalidateQueries({ queryKey: getListTaskNotesQueryKey(taskId) });
    } catch {
      toast({ title: "Failed to add note", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Add a note about this task…"
          className="resize-none h-20 text-sm"
          data-testid="textarea-new-task-note"
        />
        <div className="flex justify-end">
          <Button size="sm" className="h-8 gap-1.5" onClick={add} disabled={createNote.isPending || !body.trim()} data-testid="button-add-task-note">
            {createNote.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquarePlus className="w-3.5 h-3.5" />}
            Add note
          </Button>
        </div>
      </div>

      <div className="surface-card ring-hairline border border-border/70 rounded-xl divide-y divide-border/40 min-h-[120px] max-h-[40vh] overflow-y-auto">
        {isLoading ? (
          <div className="p-3 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)}</div>
        ) : (notes ?? []).length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground font-mono">No notes yet.</div>
        ) : (
          [...(notes ?? [])].reverse().map(n => {
            const isStatus = !!(n.statusBefore || n.statusAfter);
            return (
              <div key={n.id} className="px-3 py-2.5 space-y-1">
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                  {isStatus ? (
                    <span className="inline-flex items-center gap-1 text-amber-400">
                      <Loader2 className="w-2.5 h-2.5" />
                      Status: {n.statusBefore ?? "—"} → {n.statusAfter ?? "—"}
                    </span>
                  ) : (
                    <span>{n.authorName ?? "Note"}</span>
                  )}
                  <span className="ml-auto tabular-nums">{n.createdAt ? format(new Date(n.createdAt), "MMM d, HH:mm") : ""}</span>
                </div>
                <div className="text-sm text-foreground/90 whitespace-pre-wrap break-words">{n.body}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
