import { useListDocuments, useListProjects, useDeleteDocument, getListDocumentsQueryKey } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Upload, ExternalLink, Trash2, FileText, FileSpreadsheet, FileImage, FileCode, FileArchive, Globe, FolderOpen, X, Loader2, PenLine } from "lucide-react";
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
  const { data: projects } = useListProjects();
  const { data: appConfig } = useQuery<{ collaboraEnabled: boolean }>({
    queryKey: ["app-config"],
    queryFn: async () => {
      const r = await fetch("/api/config");
      if (!r.ok) return { collaboraEnabled: false };
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  const deleteMutation = useDeleteDocument();
  const collaboraEnabled = !!appConfig?.collaboraEnabled;

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
      if (uploadStudio) fd.append("projectId", uploadStudio);
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
    if (filterStudio === "__global__" && d.projectId !== null) return false;
    if (filterStudio && filterStudio !== "__global__" && d.projectId !== parseInt(filterStudio)) return false;
    return true;
  });

  const globalDocs  = filtered.filter(d => d.projectId === null);
  const studioDocs  = filtered.filter(d => d.projectId !== null);
  const byStudio: Record<string, { name: string; docs: typeof studioDocs }> = {};
  for (const doc of studioDocs) {
    const k = String(doc.projectId);
    if (!byStudio[k]) byStudio[k] = { name: doc.projectName ?? `Project ${doc.projectId}`, docs: [] };
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
              {projects?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
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
            {projects?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
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
                    {globalDocs.map((doc, i) => <DocRow key={doc.id} doc={doc} idx={i} collaboraEnabled={collaboraEnabled} onDelete={() => handleDelete(doc.id)} />)}
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
                    {docs.map((doc, i) => <DocRow key={doc.id} doc={doc} idx={i} collaboraEnabled={collaboraEnabled} onDelete={() => handleDelete(doc.id)} />)}
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

type Doc = { id: number; title: string; url?: string | null; category: string; uploadedBy?: string | null; version?: string | null; updatedAt?: string; projectName?: string | null };

const EXT_META: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  CSV:  { icon: <FileSpreadsheet className="w-4 h-4" />, color: "text-emerald-400", bg: "bg-emerald-400/15 border-emerald-400/30" },
  XLSX: { icon: <FileSpreadsheet className="w-4 h-4" />, color: "text-emerald-400", bg: "bg-emerald-400/15 border-emerald-400/30" },
  XLS:  { icon: <FileSpreadsheet className="w-4 h-4" />, color: "text-emerald-400", bg: "bg-emerald-400/15 border-emerald-400/30" },
  PDF:  { icon: <FileText className="w-4 h-4" />,        color: "text-red-400",     bg: "bg-red-400/15 border-red-400/30" },
  DOC:  { icon: <FileText className="w-4 h-4" />,        color: "text-blue-400",    bg: "bg-blue-400/15 border-blue-400/30" },
  DOCX: { icon: <FileText className="w-4 h-4" />,        color: "text-blue-400",    bg: "bg-blue-400/15 border-blue-400/30" },
  PNG:  { icon: <FileImage className="w-4 h-4" />,       color: "text-pink-400",    bg: "bg-pink-400/15 border-pink-400/30" },
  JPG:  { icon: <FileImage className="w-4 h-4" />,       color: "text-pink-400",    bg: "bg-pink-400/15 border-pink-400/30" },
  JPEG: { icon: <FileImage className="w-4 h-4" />,       color: "text-pink-400",    bg: "bg-pink-400/15 border-pink-400/30" },
  SVG:  { icon: <FileImage className="w-4 h-4" />,       color: "text-purple-400",  bg: "bg-purple-400/15 border-purple-400/30" },
  DWG:  { icon: <FileCode className="w-4 h-4" />,        color: "text-orange-400",  bg: "bg-orange-400/15 border-orange-400/30" },
  DXF:  { icon: <FileCode className="w-4 h-4" />,        color: "text-orange-400",  bg: "bg-orange-400/15 border-orange-400/30" },
  ZIP:  { icon: <FileArchive className="w-4 h-4" />,     color: "text-yellow-400",  bg: "bg-yellow-400/15 border-yellow-400/30" },
  RAR:  { icon: <FileArchive className="w-4 h-4" />,     color: "text-yellow-400",  bg: "bg-yellow-400/15 border-yellow-400/30" },
};
const DEFAULT_EXT_META = { icon: <FileText className="w-4 h-4" />, color: "text-muted-foreground", bg: "bg-muted/20 border-border" };

function FileTypeBadge({ url }: { url: string | null | undefined }) {
  if (!url) return (
    <div className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-muted/20 border border-border text-muted-foreground/40">
      <FileText className="w-4 h-4" />
    </div>
  );
  const ext = url.split(".").pop()?.toUpperCase() ?? "";
  const meta = EXT_META[ext] ?? DEFAULT_EXT_META;
  return (
    <div className={`shrink-0 w-9 h-9 rounded-lg flex flex-col items-center justify-center border ${meta.bg} ${meta.color} gap-0.5`}>
      {meta.icon}
      {ext && <span className="text-[8px] font-black font-mono leading-none">{ext}</span>}
    </div>
  );
}

const COLLABORA_EXTS = new Set([
  "csv","tsv","txt","md","markdown","rtf",
  "doc","docx","odt",
  "xls","xlsx","ods",
  "ppt","pptx","odp",
]);

function DocRow({ doc, idx, collaboraEnabled, onDelete }: { doc: Doc; idx: number; collaboraEnabled: boolean; onDelete: () => void }) {
  const [, navigate] = useLocation();
  const cat = doc.category as DocCategory;
  const color = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.general;
  const isUploaded = doc.url?.startsWith("/api/uploads/");
  const ext = (doc.url ?? "").split(".").pop()?.toLowerCase() ?? "";
  const useCollabora = collaboraEnabled && COLLABORA_EXTS.has(ext);

  function handleEdit() {
    if (useCollabora) {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const url = `${base}/collabora-launcher.html?docId=${doc.id}&base=${encodeURIComponent(base)}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      navigate(`/documents/${doc.id}/edit`);
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: idx * 0.03 }}>
      <Card className="border-border bg-card hover:bg-card/80 transition-colors">
        <CardContent className="p-3 flex items-center gap-3">
          <FileTypeBadge url={doc.url} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium truncate">{doc.title}</span>
              {doc.version && <span className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">{doc.version}</span>}
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <Badge variant="outline" className={`text-[10px] font-mono uppercase border ${color}`}>{doc.category.replace("_", " ")}</Badge>
              {doc.uploadedBy && <span className="text-[10px] text-muted-foreground font-mono">{doc.uploadedBy}</span>}
              {doc.updatedAt && <span className="text-[10px] text-muted-foreground font-mono">{new Date(doc.updatedAt).toLocaleDateString()}</span>}
            </div>
          </div>

          <Button
            variant="ghost" size="sm"
            className="h-7 text-xs font-mono text-muted-foreground hover:text-primary hover:bg-primary/10 shrink-0 gap-1.5 px-2"
            onClick={handleEdit}
            title={useCollabora ? "Open in LibreOffice (new window)" : "Edit"}
          >
            <PenLine className="w-3 h-3" />
            {useCollabora ? "Open" : "Edit"}
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
