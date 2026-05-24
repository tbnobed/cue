import { useState } from "react";
import { useCreateDocument } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Link2, Loader2 } from "lucide-react";

const CATEGORY_OPTIONS = ["spec", "plan", "permit", "vendor", "as_built", "safety", "general"] as const;
type DocCategory = typeof CATEGORY_OPTIONS[number];

export interface AddLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Scope: where the new link will live. Exactly one of projectId/taskId should be set; both null = global library. */
  projectId?: number | null;
  taskId?: number | null;
  folderId?: number | null;
  defaultCategory?: DocCategory;
  scopeLabel?: string;
  onCreated?: () => void;
}

export function AddLinkDialog({
  open, onOpenChange, projectId = null, taskId = null, folderId = null,
  defaultCategory = "general", scopeLabel, onCreated,
}: AddLinkDialogProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState<DocCategory>(defaultCategory);
  const createDoc = useCreateDocument();

  function reset() { setTitle(""); setUrl(""); setCategory(defaultCategory); }

  function normalizeUrl(raw: string): string {
    const u = raw.trim();
    if (!u) return u;
    if (/^https?:\/\//i.test(u)) return u;
    return `https://${u}`;
  }

  async function handleSubmit() {
    const finalUrl = normalizeUrl(url);
    const finalTitle = title.trim() || finalUrl.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    if (!finalTitle) { toast({ title: "Title required", variant: "destructive" }); return; }
    if (!/^https?:\/\/\S+$/i.test(finalUrl)) { toast({ title: "Enter a valid URL", variant: "destructive" }); return; }

    try {
      await createDoc.mutateAsync({
        data: {
          title: finalTitle,
          category,
          url: finalUrl,
          ...(taskId != null ? { taskId } : projectId != null ? { projectId } : {}),
          ...(folderId != null ? { folderId } : {}),
        },
      });
      toast({ title: "Link added" });
      reset();
      onOpenChange(false);
      onCreated?.();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Failed to add link";
      toast({ title: msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Link2 className="w-4 h-4" /> Add link</DialogTitle>
          <DialogDescription>
            Save an external URL alongside your documents{scopeLabel ? ` in ${scopeLabel}` : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="link-url" className="text-xs">URL</Label>
            <Input
              id="link-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/spec.pdf"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-title" className="text-xs">Title</Label>
            <Input
              id="link-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Defaults to the URL"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as DocCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map(c => (
                  <SelectItem key={c} value={c} className="capitalize">{c.replace("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={createDoc.isPending} className="gap-2">
            {createDoc.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
            Add link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
