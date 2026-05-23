import { useListDocuments, useListStudios, useDeleteDocument, getListDocumentsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Upload, ExternalLink, Trash2, FileText, Globe, FolderOpen, X, Loader2, PenLine } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

const CATEGORY_OPTIONS = ["spec", "plan", "permit", "vendor", "as_built", "safety", "general"] as const;
type DocCategory = typeof CATEGORY_OPTIONS[number];

const CATEGORY_COLORS: Record<DocCategory, string> = {
  spec:     "text-blue-400   border-blue-400/40   bg-blue-400/10",
  plan:     "text-violet-400 border-violet-400/40 bg-violet-400/10",
  permit:   "text-amber-400  border-amber-400/40  bg-amber-400/10",
  vendor:   "text-teal-400   border-teal-400/40   bg-teal-400/10",
  as_built: "text-green-400  border-green-400/40  bg-green-400/10",
  safety:   "text-red-400    border-red-400/40    bg-red-400/10",
  general:  "text-muted-foreground border-border  bg-muted/20",
};

export default function Documents() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [filterStudio, setFilterStudio] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadStudio, setUploadStudio] = useState("");
  const [uploadCategory, setUploadCategory] = useState("general");

  const { data: allDocs, isLoading } = useListDocuments({});
  const { data: studios } = useListStudios();
  const deleteMutation = useDeleteDocument();

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
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
      if (uploadStudio) fd.append("studioId", uploadStudio);
      try {
        const res = await fetch("/api/documents/upload", { method: "POST", body: fd });
        if (res.ok) ok++;
        else toast({ title: `Failed to upload ${file.name}`, variant: "destructive" });
      } catch {
        toast({ title: `Failed to upload ${file.name}`, variant: "destructive" });
      }
    }
    setUploading(false);
    if (ok > 0) {
      toast({ title: `${ok} file${ok > 1 ? "s" : ""} uploaded` });
      invalidate();
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync({ id });
    invalidate();
  }

  const filtered = (allDocs ?? []).filter(d => {
    if (filterCategory && d.category !== filterCategory) return false;
    if (filterStudio === "__global__" && d.studioId !== null) return false;
    if (filterStudio && filterStudio !== "__global__" && d.studioId !== parseInt(filterStudio)) return false;
    return true;
  });

  const globalDocs  = filtered.filter(d => d.studioId === null);
  const studioDocs  = filtered.filter(d => d.studioId !== null);
  const byStudio: Record<string, { name: string; docs: typeof studioDocs }> = {};
  for (const doc of studioDocs) {
    const k = String(doc.studioId);
    if (!byStudio[k]) byStudio[k] = { name: doc.studioName ?? `Studio ${doc.studioId}`, docs: [] };
    byStudio[k].docs.push(doc);
  }

  const showGlobal = !filterStudio || filterStudio === "__global__";
  const showStudios = !filterStudio || (filterStudio !== "__global__");
  const filterCount = [filterStudio, filterCategory].filter(Boolean).length;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Document Repository</h1>
          <p className="text-muted-foreground text-sm uppercase tracking-wider font-mono">Specs · Plans · Permits · Vendor Docs</p>
        </div>

        {/* Upload controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={uploadStudio || "__global__"} onValueChange={v => setUploadStudio(v === "__global__" ? "" : v)}>
            <SelectTrigger className="h-9 w-44 text-xs font-mono bg-card border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__global__">General Library</SelectItem>
              {studios?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={uploadCategory} onValueChange={setUploadCategory}>
            <SelectTrigger className="h-9 w-32 text-xs font-mono bg-card border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c} className="capitalize">{c.replace("_", " ")}</SelectItem>)}
            </SelectContent>
          </Select>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={e => handleFiles(e.target.files)}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="bg-primary text-primary-foreground hover:bg-primary/90 font-mono uppercase tracking-wide gap-2 h-9"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={filterStudio || "all"} onValueChange={v => setFilterStudio(v === "all" ? "" : v)}>
          <SelectTrigger className="w-48 h-8 text-xs font-mono bg-card border-border">
            <SelectValue placeholder="All Locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            <SelectItem value="__global__"><span className="flex items-center gap-2"><Globe className="w-3 h-3 inline" /> General Library</span></SelectItem>
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

      {/* Document lists */}
      {isLoading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : (
        <div className="space-y-8">
          {showGlobal && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Globe className="w-4 h-4 text-primary" />
                <h2 className="font-mono uppercase tracking-wide text-sm text-primary">General Library</h2>
                <span className="text-xs text-muted-foreground font-mono">({globalDocs.length})</span>
              </div>
              {globalDocs.length === 0 ? (
                <div className="border border-dashed border-border rounded-lg p-8 text-center text-muted-foreground text-sm font-mono">
                  Upload company-wide docs here — safety standards, vendor lists, cable specs
                </div>
              ) : (
                <AnimatePresence>
                  <div className="space-y-2">
                    {globalDocs.map((doc, i) => <DocRow key={doc.id} doc={doc} idx={i} onDelete={() => handleDelete(doc.id)} />)}
                  </div>
                </AnimatePresence>
              )}
            </section>
          )}

          {showStudios && Object.entries(byStudio).map(([sid, { name, docs }]) => (
            (!filterStudio || filterStudio === sid) && (
              <section key={sid}>
                <div className="flex items-center gap-2 mb-3">
                  <FolderOpen className="w-4 h-4 text-amber-400" />
                  <h2 className="font-mono uppercase tracking-wide text-sm text-amber-400">{name}</h2>
                  <span className="text-xs text-muted-foreground font-mono">({docs.length})</span>
                </div>
                <AnimatePresence>
                  <div className="space-y-2">
                    {docs.map((doc, i) => <DocRow key={doc.id} doc={doc} idx={i} onDelete={() => handleDelete(doc.id)} />)}
                  </div>
                </AnimatePresence>
              </section>
            )
          ))}

          {filtered.length === 0 && (
            <div className="text-center py-20 text-muted-foreground font-mono text-sm uppercase tracking-wider">
              No documents yet
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type Doc = { id: number; title: string; url: string | null; category: string; uploadedBy: string | null; version: string | null; updatedAt: string; studioName?: string | null };

function DocRow({ doc, idx, onDelete }: { doc: Doc; idx: number; onDelete: () => void }) {
  const [, navigate] = useLocation();
  const cat = doc.category as DocCategory;
  const color = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.general;
  const isUploaded = doc.url?.startsWith("/api/uploads/");
  const ext = doc.url ? doc.url.split(".").pop()?.toUpperCase() : null;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: idx * 0.03 }}>
      <Card className="border-border bg-card hover:bg-card/80 transition-colors">
        <CardContent className="p-3 flex items-center gap-3">
          <FileText className="w-4 h-4 text-muted-foreground shrink-0" />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium truncate">{doc.title}</span>
              {doc.version && <span className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">{doc.version}</span>}
              {isUploaded && ext && <span className="text-[10px] font-mono text-muted-foreground">{ext}</span>}
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <Badge variant="outline" className={`text-[10px] font-mono uppercase border ${color}`}>{doc.category.replace("_", " ")}</Badge>
              {doc.uploadedBy && <span className="text-[10px] text-muted-foreground font-mono">{doc.uploadedBy}</span>}
              <span className="text-[10px] text-muted-foreground font-mono">{new Date(doc.updatedAt).toLocaleDateString()}</span>
            </div>
          </div>

          <Button
            variant="ghost" size="sm"
            className="h-7 text-xs font-mono text-muted-foreground hover:text-primary hover:bg-primary/10 shrink-0 gap-1.5 px-2"
            onClick={() => navigate(`/documents/${doc.id}/edit`)}
          >
            <PenLine className="w-3 h-3" />
            Edit
          </Button>

          {doc.url && (
            <a href={doc.url} target="_blank" rel="noopener noreferrer" download={isUploaded ? doc.title : undefined}>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary shrink-0">
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            </a>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 shrink-0" onClick={onDelete}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}
