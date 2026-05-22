import {
  useListDocuments,
  useListStudios,
  useCreateDocument,
  useUpdateDocument,
  useDeleteDocument,
  getListDocumentsQueryKey,
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
import { Plus, ExternalLink, Trash2, Pencil, FolderOpen, Globe, Loader2, FileText, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CATEGORY_OPTIONS = ["spec", "plan", "permit", "vendor", "as_built", "safety", "general"] as const;
type DocCategory = typeof CATEGORY_OPTIONS[number];

const CATEGORY_COLORS: Record<DocCategory, string> = {
  spec: "text-blue-400 border-blue-400/40 bg-blue-400/10",
  plan: "text-violet-400 border-violet-400/40 bg-violet-400/10",
  permit: "text-amber-400 border-amber-400/40 bg-amber-400/10",
  vendor: "text-teal-400 border-teal-400/40 bg-teal-400/10",
  as_built: "text-green-400 border-green-400/40 bg-green-400/10",
  safety: "text-red-400 border-red-400/40 bg-red-400/10",
  general: "text-muted-foreground border-border bg-muted/20",
};

const NONE_VALUE = "__none__";

type DocForm = {
  title: string; description: string; url: string; notes: string;
  category: string; studioId: string; uploadedBy: string; version: string;
};

const emptyForm: DocForm = { title: "", description: "", url: "", notes: "", category: "general", studioId: "", uploadedBy: "", version: "" };

export default function Documents() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [filterStudio, setFilterStudio] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editDoc, setEditDoc] = useState<number | null>(null);
  const [form, setForm] = useState<DocForm>(emptyForm);

  const { data: allDocs, isLoading } = useListDocuments({});
  const { data: studios } = useListStudios();

  const createMutation = useCreateDocument();
  const updateMutation = useUpdateDocument();
  const deleteMutation = useDeleteDocument();

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
  }

  function resetForm() { setForm(emptyForm); setEditDoc(null); }

  function openEdit(doc: NonNullable<typeof allDocs>[0]) {
    setForm({
      title: doc.title,
      description: doc.description ?? "",
      url: doc.url ?? "",
      notes: doc.notes ?? "",
      category: doc.category,
      studioId: doc.studioId ? String(doc.studioId) : "",
      uploadedBy: doc.uploadedBy ?? "",
      version: doc.version ?? "",
    });
    setEditDoc(doc.id);
    setCreateOpen(true);
  }

  async function handleSave() {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    const payload = {
      title: form.title,
      description: form.description || undefined,
      url: form.url || undefined,
      notes: form.notes || undefined,
      category: form.category as any,
      studioId: form.studioId ? parseInt(form.studioId) : undefined,
      uploadedBy: form.uploadedBy || undefined,
      version: form.version || undefined,
    };
    try {
      if (editDoc !== null) {
        await updateMutation.mutateAsync({ id: editDoc, data: payload });
        toast({ title: "Document updated" });
      } else {
        await createMutation.mutateAsync({ data: payload });
        toast({ title: "Document added" });
      }
      setCreateOpen(false);
      resetForm();
      invalidate();
    } catch {
      toast({ title: "Failed to save document", variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteMutation.mutateAsync({ id });
      toast({ title: "Document removed" });
      invalidate();
    } catch {
      toast({ title: "Failed to remove document", variant: "destructive" });
    }
  }

  // Split into global + per-studio
  const filtered = (allDocs ?? []).filter(d => {
    if (filterCategory && d.category !== filterCategory) return false;
    if (filterStudio === "__global__") return d.studioId === null;
    if (filterStudio && d.studioId !== parseInt(filterStudio)) return false;
    return true;
  });

  const globalDocs = filtered.filter(d => d.studioId === null);
  const studioDocs = filtered.filter(d => d.studioId !== null);

  // Group studio docs by studio
  const byStudio: Record<string, { name: string; docs: typeof studioDocs }> = {};
  for (const doc of studioDocs) {
    const key = String(doc.studioId);
    if (!byStudio[key]) byStudio[key] = { name: doc.studioName ?? `Studio ${doc.studioId}`, docs: [] };
    byStudio[key].docs.push(doc);
  }

  const filterCount = [filterStudio, filterCategory].filter(Boolean).length;
  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Document Repository</h1>
          <p className="text-muted-foreground text-sm uppercase tracking-wider font-mono">Specs · Plans · Permits · Vendor Docs</p>
        </div>
        <Button
          onClick={() => { resetForm(); setCreateOpen(true); }}
          className="bg-primary text-primary-foreground hover:bg-primary/90 font-mono uppercase tracking-wide gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Document
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={filterStudio || "all"} onValueChange={v => setFilterStudio(v === "all" ? "" : v)}>
          <SelectTrigger className="w-48 h-8 text-xs font-mono bg-card border-border">
            <SelectValue placeholder="All Locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            <SelectItem value="__global__">
              <span className="flex items-center gap-2"><Globe className="w-3 h-3" /> General Library</span>
            </SelectItem>
            {studios?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterCategory || "all"} onValueChange={v => setFilterCategory(v === "all" ? "" : v)}>
          <SelectTrigger className="w-36 h-8 text-xs font-mono bg-card border-border">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c} className="capitalize">{c.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>

        {filterCount > 0 && (
          <Button variant="ghost" size="sm" className="h-8 text-xs font-mono text-muted-foreground gap-1"
            onClick={() => { setFilterStudio(""); setFilterCategory(""); }}>
            <X className="w-3 h-3" /> Clear
          </Button>
        )}

        <span className="ml-auto text-xs font-mono text-muted-foreground">{filtered.length} documents</span>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : (
        <div className="space-y-8">
          {/* General Library */}
          {(filterStudio === "" || filterStudio === "__global__") && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Globe className="w-4 h-4 text-primary" />
                <h2 className="font-mono uppercase tracking-wide text-sm text-primary">General Library</h2>
                <span className="text-xs text-muted-foreground font-mono ml-1">({globalDocs.length})</span>
              </div>
              {globalDocs.length === 0 ? (
                <div className="border border-dashed border-border rounded-lg p-8 text-center text-muted-foreground text-sm font-mono">
                  No general documents yet. Add specs, safety docs, or company-wide references here.
                </div>
              ) : (
                <div className="space-y-2">
                  <AnimatePresence>
                    {globalDocs.map((doc, idx) => (
                      <DocRow key={doc.id} doc={doc} idx={idx} onEdit={() => openEdit(doc)} onDelete={() => handleDelete(doc.id)} />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </section>
          )}

          {/* Per-Studio Repositories */}
          {(filterStudio === "" || !["", "__global__"].includes(filterStudio)) &&
            Object.entries(byStudio).map(([studioId, { name, docs }]) => (
              filterStudio === "" || filterStudio === studioId ? (
                <section key={studioId}>
                  <div className="flex items-center gap-2 mb-3">
                    <FolderOpen className="w-4 h-4 text-amber-400" />
                    <h2 className="font-mono uppercase tracking-wide text-sm text-amber-400">{name}</h2>
                    <span className="text-xs text-muted-foreground font-mono ml-1">({docs.length})</span>
                  </div>
                  <div className="space-y-2">
                    <AnimatePresence>
                      {docs.map((doc, idx) => (
                        <DocRow key={doc.id} doc={doc} idx={idx} onEdit={() => openEdit(doc)} onDelete={() => handleDelete(doc.id)} />
                      ))}
                    </AnimatePresence>
                  </div>
                </section>
              ) : null
            ))
          }

          {filtered.length === 0 && !isLoading && (
            <div className="text-center py-20 text-muted-foreground font-mono text-sm uppercase tracking-wider">
              No documents found
            </div>
          )}
        </div>
      )}

      {/* Create / Edit Modal */}
      <Dialog open={createOpen} onOpenChange={o => { setCreateOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="bg-card border-border max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-wide text-primary">
              {editDoc !== null ? "Edit Document" : "Add Document"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label className="text-xs font-mono uppercase text-muted-foreground">Title *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Document title" className="bg-background border-border" />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-mono uppercase text-muted-foreground">Description</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="What this document covers..." className="bg-background border-border resize-none h-16" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs font-mono uppercase text-muted-foreground">Studio (or leave blank for General)</Label>
                <Select value={form.studioId || NONE_VALUE} onValueChange={v => setForm(f => ({ ...f, studioId: v === NONE_VALUE ? "" : v }))}>
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue placeholder="General Library" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>General Library</SelectItem>
                    {studios?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-mono uppercase text-muted-foreground">Document Type</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c} className="capitalize">{c.replace("_", " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-mono uppercase text-muted-foreground">Document URL</Label>
              <Input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                placeholder="https://drive.google.com/... or SharePoint link"
                className="bg-background border-border font-mono text-sm" />
              <p className="text-[10px] text-muted-foreground font-mono">Paste a link to Google Drive, SharePoint, Dropbox, or any shared file</p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-mono uppercase text-muted-foreground">Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Revision notes, location details, access instructions..."
                className="bg-background border-border resize-none h-16" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs font-mono uppercase text-muted-foreground">Added By</Label>
                <Input value={form.uploadedBy} onChange={e => setForm(f => ({ ...f, uploadedBy: e.target.value }))}
                  placeholder="Your name" className="bg-background border-border" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-mono uppercase text-muted-foreground">Version</Label>
                <Input value={form.version} onChange={e => setForm(f => ({ ...f, version: e.target.value }))}
                  placeholder="e.g. v3.2, Rev B" className="bg-background border-border font-mono" />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm(); }} className="font-mono">Cancel</Button>
            <Button onClick={handleSave} disabled={isPending}
              className="bg-primary text-primary-foreground font-mono gap-2">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {editDoc !== null ? "Save Changes" : "Add Document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DocRow({
  doc, idx, onEdit, onDelete
}: {
  doc: { id: number; title: string; description: string | null; url: string | null; notes: string | null; category: string; uploadedBy: string | null; version: string | null; studioName: string | null; updatedAt: string };
  idx: number; onEdit: () => void; onDelete: () => void;
}) {
  const catColor = CATEGORY_COLORS[doc.category as DocCategory] ?? CATEGORY_COLORS.general;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -6 }}
      transition={{ delay: idx * 0.03 }}
    >
      <Card className="border-border bg-card hover:bg-card/80 transition-colors">
        <CardContent className="p-4 flex items-start gap-4">
          <div className="mt-0.5 text-muted-foreground shrink-0">
            <FileText className="w-4 h-4" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2 flex-wrap">
              <span className="font-medium">{doc.title}</span>
              {doc.version && (
                <span className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">{doc.version}</span>
              )}
            </div>
            {doc.description && <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{doc.description}</p>}
            {doc.notes && <p className="text-xs text-muted-foreground/70 mt-0.5 font-mono line-clamp-1">{doc.notes}</p>}
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <Badge variant="outline" className={`text-[10px] font-mono uppercase border ${catColor}`}>
                {doc.category.replace("_", " ")}
              </Badge>
              {doc.uploadedBy && <span className="text-[10px] text-muted-foreground font-mono">Added by {doc.uploadedBy}</span>}
              <span className="text-[10px] text-muted-foreground font-mono">{new Date(doc.updatedAt).toLocaleDateString()}</span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {doc.url && (
              <a href={doc.url} target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary">
                  <ExternalLink className="w-3.5 h-3.5" />
                </Button>
              </a>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-amber-400"
              onClick={onEdit}>
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
              onClick={onDelete}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
