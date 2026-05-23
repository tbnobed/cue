import { useListDocuments, useListProjects, useDeleteDocument, getListDocumentsQueryKey } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Upload, ExternalLink, Trash2, FileText, FileSpreadsheet, FileImage, FileCode, FileArchive, Globe, FolderOpen, X, Loader2, PenLine } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const CATEGORY_OPTIONS = ["spec", "plan", "permit", "vendor", "as_built", "safety", "general"] as const;
type DocCategory = typeof CATEGORY_OPTIONS[number];

const CATEGORY_TONE: Record<DocCategory, string> = {
  spec:     "text-blue-400 bg-blue-500/10 ring-blue-500/20",
  plan:     "text-violet-400 bg-violet-500/10 ring-violet-500/20",
  permit:   "text-amber-400 bg-amber-500/10 ring-amber-500/20",
  vendor:   "text-teal-400 bg-teal-500/10 ring-teal-500/20",
  as_built: "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
  safety:   "text-red-400 bg-red-500/10 ring-red-500/20",
  general:  "text-muted-foreground bg-muted/40 ring-border/60",
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
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
            <span className="w-1 h-1 rounded-full bg-primary" />
            Documents
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Document repository</h1>
        </div>

        {/* Upload controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={uploadStudio || "__global__"} onValueChange={v => setUploadStudio(v === "__global__" ? "" : v)}>
            <SelectTrigger className="h-9 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__global__">General Library</SelectItem>
              {projects?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={uploadCategory} onValueChange={setUploadCategory}>
            <SelectTrigger className="h-9 w-32 text-xs"><SelectValue /></SelectTrigger>
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
            className="gap-2 h-9"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="surface-card ring-hairline border border-border/70 rounded-xl p-3 flex flex-wrap gap-2 items-center">
        <Select value={filterStudio || "all"} onValueChange={v => setFilterStudio(v === "all" ? "" : v)}>
          <SelectTrigger className="w-48 h-8 text-xs bg-background/60">
            <SelectValue placeholder="All locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            <SelectItem value="__global__">
              <span className="flex items-center gap-2"><Globe className="w-3 h-3 inline" /> General Library</span>
            </SelectItem>
            {projects?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterCategory || "all"} onValueChange={v => setFilterCategory(v === "all" ? "" : v)}>
          <SelectTrigger className="w-36 h-8 text-xs bg-background/60">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c} className="capitalize">{c.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>

        {filterCount > 0 && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground gap-1"
            onClick={() => { setFilterStudio(""); setFilterCategory(""); }}>
            <X className="w-3 h-3" /> Clear
          </Button>
        )}
        <span className="ml-auto text-[11px] font-mono text-muted-foreground tabular-nums">
          {filtered.length} {filtered.length === 1 ? "document" : "documents"}
        </span>
      </div>

      {/* Document lists */}
      {isLoading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
      ) : (
        <div className="space-y-7">
          {showGlobal && (
            <DocSection
              icon={<Globe className="w-3.5 h-3.5" />}
              title="General Library"
              accent="text-primary"
              count={globalDocs.length}
              emptyMessage="Upload company-wide docs — safety standards, vendor lists, cable specs."
              docs={globalDocs}
              collaboraEnabled={collaboraEnabled}
              onDelete={handleDelete}
            />
          )}

          {showStudios && Object.entries(byStudio).map(([sid, { name, docs }]) => (
            (!filterStudio || filterStudio === sid) && (
              <DocSection
                key={sid}
                icon={<FolderOpen className="w-3.5 h-3.5" />}
                title={name}
                accent="text-amber-400"
                count={docs.length}
                docs={docs}
                collaboraEnabled={collaboraEnabled}
                onDelete={handleDelete}
              />
            )
          ))}

          {filtered.length === 0 && (
            <div className="surface-card ring-hairline border border-border/70 rounded-2xl p-12 text-center text-sm text-muted-foreground font-mono">
              No documents yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type Doc = { id: number; title: string; url?: string | null; category: string; uploadedBy?: string | null; version?: string | null; updatedAt?: string; projectName?: string | null; projectId?: number | null };

function DocSection({
  icon, title, accent, count, emptyMessage, docs, collaboraEnabled, onDelete,
}: {
  icon: React.ReactNode;
  title: string;
  accent: string;
  count: number;
  emptyMessage?: string;
  docs: Doc[];
  collaboraEnabled: boolean;
  onDelete: (id: number) => void;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className={accent}>{icon}</span>
        <h2 className={`text-[12px] font-mono uppercase tracking-[0.18em] ${accent}`}>{title}</h2>
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">({count})</span>
      </div>
      {docs.length === 0 && emptyMessage ? (
        <div className="border border-dashed border-border/70 rounded-2xl p-8 text-center text-muted-foreground text-sm font-mono">
          {emptyMessage}
        </div>
      ) : docs.length > 0 ? (
        <div className="surface-card ring-hairline border border-border/70 rounded-2xl overflow-hidden divide-y divide-border/40">
          <AnimatePresence initial={false}>
            {docs.map((doc, i) => (
              <DocRow key={doc.id} doc={doc} idx={i} collaboraEnabled={collaboraEnabled} onDelete={() => onDelete(doc.id)} />
            ))}
          </AnimatePresence>
        </div>
      ) : null}
    </section>
  );
}

const EXT_META: Record<string, { icon: React.ReactNode; tone: string }> = {
  CSV:  { icon: <FileSpreadsheet className="w-4 h-4" />, tone: "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20" },
  XLSX: { icon: <FileSpreadsheet className="w-4 h-4" />, tone: "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20" },
  XLS:  { icon: <FileSpreadsheet className="w-4 h-4" />, tone: "text-emerald-400 bg-emerald-500/10 ring-emerald-500/20" },
  PDF:  { icon: <FileText className="w-4 h-4" />,        tone: "text-red-400 bg-red-500/10 ring-red-500/20" },
  DOC:  { icon: <FileText className="w-4 h-4" />,        tone: "text-blue-400 bg-blue-500/10 ring-blue-500/20" },
  DOCX: { icon: <FileText className="w-4 h-4" />,        tone: "text-blue-400 bg-blue-500/10 ring-blue-500/20" },
  PNG:  { icon: <FileImage className="w-4 h-4" />,       tone: "text-pink-400 bg-pink-500/10 ring-pink-500/20" },
  JPG:  { icon: <FileImage className="w-4 h-4" />,       tone: "text-pink-400 bg-pink-500/10 ring-pink-500/20" },
  JPEG: { icon: <FileImage className="w-4 h-4" />,       tone: "text-pink-400 bg-pink-500/10 ring-pink-500/20" },
  SVG:  { icon: <FileImage className="w-4 h-4" />,       tone: "text-purple-400 bg-purple-500/10 ring-purple-500/20" },
  DWG:  { icon: <FileCode className="w-4 h-4" />,        tone: "text-orange-400 bg-orange-500/10 ring-orange-500/20" },
  DXF:  { icon: <FileCode className="w-4 h-4" />,        tone: "text-orange-400 bg-orange-500/10 ring-orange-500/20" },
  ZIP:  { icon: <FileArchive className="w-4 h-4" />,     tone: "text-yellow-400 bg-yellow-500/10 ring-yellow-500/20" },
  RAR:  { icon: <FileArchive className="w-4 h-4" />,     tone: "text-yellow-400 bg-yellow-500/10 ring-yellow-500/20" },
};
const DEFAULT_EXT_META = { icon: <FileText className="w-4 h-4" />, tone: "text-muted-foreground bg-muted/40 ring-border/60" };

function FileTypeBadge({ url }: { url: string | null | undefined }) {
  const ext = url ? (url.split(".").pop()?.toUpperCase() ?? "") : "";
  const meta = EXT_META[ext] ?? DEFAULT_EXT_META;
  return (
    <div className={`shrink-0 w-10 h-10 rounded-lg flex flex-col items-center justify-center ring-1 ring-inset ${meta.tone} gap-0.5`}>
      {meta.icon}
      {ext && <span className="text-[8px] font-bold font-mono leading-none">{ext}</span>}
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
  const tone = CATEGORY_TONE[cat] ?? CATEGORY_TONE.general;
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
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ delay: Math.min(idx * 0.02, 0.2) }}
      className="group flex items-center gap-3 px-4 py-3 hover:bg-background/40 transition-colors"
    >
      <FileTypeBadge url={doc.url} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{doc.title}</span>
          {doc.version && <span className="text-[10px] font-mono text-muted-foreground border border-border/70 rounded px-1.5 py-0.5">{doc.version}</span>}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-[11px] font-mono text-muted-foreground">
          <span className={`text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-md ring-1 ring-inset ${tone}`}>
            {doc.category.replace("_", " ")}
          </span>
          {doc.uploadedBy && <><span className="text-border">·</span><span>{doc.uploadedBy}</span></>}
          {doc.updatedAt && <><span className="text-border">·</span><span className="tabular-nums">{format(new Date(doc.updatedAt), "MMM dd, yyyy")}</span></>}
        </div>
      </div>

      <Button
        variant="ghost" size="sm"
        className="h-7 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 shrink-0 gap-1.5 px-2"
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
      <Button
        variant="ghost" size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={onDelete}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </motion.div>
  );
}
