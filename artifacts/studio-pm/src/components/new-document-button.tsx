import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getListDocumentsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { FilePlus2, FileText, FileSpreadsheet, FileType, Loader2 } from "lucide-react";

type Format = "md" | "txt" | "csv";

const FORMAT_META: Record<Format, { label: string; hint: string; icon: React.ReactNode }> = {
  md:  { label: "Document",    hint: "Markdown — rich text, lists, headings", icon: <FileText className="w-4 h-4" /> },
  csv: { label: "Spreadsheet", hint: "CSV — rows and columns",                 icon: <FileSpreadsheet className="w-4 h-4" /> },
  txt: { label: "Plain text",  hint: "TXT — notes, snippets",                  icon: <FileType className="w-4 h-4" /> },
};

export interface NewDocumentButtonProps {
  projectId?: number | null;
  taskId?: number | null;
  folderId?: number | null;
  category?: string;
  scopeLabel?: string;
  size?: "default" | "sm";
  variant?: "default" | "outline" | "secondary" | "ghost";
  className?: string;
}

export function NewDocumentButton({
  projectId = null, taskId = null, folderId = null,
  category = "general", scopeLabel,
  size = "default", variant = "outline", className,
}: NewDocumentButtonProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const [format, setFormat] = useState<Format | null>(null);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() { setFormat(null); setTitle(""); setSubmitting(false); }

  async function handleCreate() {
    if (!format) return;
    const finalTitle = title.trim() || "Untitled";
    setSubmitting(true);
    try {
      const res = await fetch("/api/documents/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: finalTitle,
          format,
          category,
          ...(taskId != null ? { taskId } : projectId != null ? { projectId } : {}),
          ...(folderId != null ? { folderId } : {}),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast({ title: j.error || "Failed to create document", variant: "destructive" });
        setSubmitting(false);
        return;
      }
      const doc = await res.json();
      qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
      reset();
      navigate(`/documents/${doc.id}/edit`);
    } catch (err: any) {
      toast({ title: err?.message || "Failed to create document", variant: "destructive" });
      setSubmitting(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size={size} variant={variant} className={`gap-1.5 ${className ?? ""}`}>
            <FilePlus2 className="w-4 h-4" /> New
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {(Object.keys(FORMAT_META) as Format[]).map((f) => {
            const m = FORMAT_META[f];
            return (
              <DropdownMenuItem
                key={f}
                onClick={() => { setFormat(f); setTitle(""); }}
                className="gap-2.5 py-2"
              >
                <span className="text-muted-foreground">{m.icon}</span>
                <span className="flex flex-col">
                  <span className="text-sm">{m.label}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{m.hint}</span>
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={format !== null} onOpenChange={(o) => { if (!o) reset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {format && FORMAT_META[format].icon}
              New {format ? FORMAT_META[format].label.toLowerCase() : "document"}
            </DialogTitle>
            <DialogDescription>
              Creates a blank file{scopeLabel ? ` in ${scopeLabel}` : ""} and opens it in the editor.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-doc-title" className="text-xs">Title</Label>
              <Input
                id="new-doc-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && !submitting) handleCreate(); }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => reset()} disabled={submitting}>Cancel</Button>
            <Button onClick={handleCreate} disabled={submitting} className="gap-2">
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FilePlus2 className="w-3.5 h-3.5" />}
              Create &amp; open
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
