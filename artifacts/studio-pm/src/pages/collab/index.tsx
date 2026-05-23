import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Plus, FileText, Table2, Trash2, Clock, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useListStudios } from "@workspace/api-client-react";

type CollabDoc = {
  id: number; title: string; docType: string;
  studioId: number | null; studioName: string | null;
  createdBy: string | null; createdAt: string; updatedAt: string;
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchDocs(): Promise<CollabDoc[]> {
  const res = await fetch(`${BASE}/api/collab/docs`);
  if (!res.ok) throw new Error("Failed to fetch docs");
  return res.json();
}
async function createDoc(data: { title: string; docType: string; studioId?: number; createdBy?: string }): Promise<CollabDoc> {
  const res = await fetch(`${BASE}/api/collab/docs`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create doc");
  return res.json();
}
async function deleteDoc(id: number): Promise<void> {
  await fetch(`${BASE}/api/collab/docs/${id}`, { method: "DELETE" });
}

const NONE_VALUE = "__none__";

export default function CollabDocs() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: "", docType: "text", studioId: "", createdBy: "" });

  const { data: docs, isLoading } = useQuery({ queryKey: ["collab-docs"], queryFn: fetchDocs });
  const { data: studios } = useListStudios();

  const createMutation = useMutation({
    mutationFn: createDoc,
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["collab-docs"] });
      setCreateOpen(false);
      setForm({ title: "", docType: "text", studioId: "", createdBy: "" });
      navigate(`/collab/${doc.id}`);
    },
    onError: () => toast({ title: "Failed to create document", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDoc,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collab-docs"] }),
  });

  function handleCreate() {
    if (!form.title.trim()) { toast({ title: "Title is required", variant: "destructive" }); return; }
    createMutation.mutate({
      title: form.title,
      docType: form.docType,
      studioId: form.studioId ? parseInt(form.studioId) : undefined,
      createdBy: form.createdBy || undefined,
    });
  }

  const textDocs = docs?.filter(d => d.docType === "text") ?? [];
  const sheetDocs = docs?.filter(d => d.docType === "spreadsheet") ?? [];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Shared Documents</h1>
          <p className="text-muted-foreground text-sm uppercase tracking-wider font-mono">Live collaborative editing</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}
          className="bg-primary text-primary-foreground font-mono uppercase tracking-wide gap-2">
          <Plus className="w-4 h-4" /> New Document
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : (
        <div className="space-y-8">
          {[
            { label: "Documents", icon: FileText, color: "text-blue-400", items: textDocs },
            { label: "Spreadsheets", icon: Table2, color: "text-green-400", items: sheetDocs },
          ].map(({ label, icon: Icon, color, items }) => items.length > 0 && (
            <section key={label}>
              <div className="flex items-center gap-2 mb-3">
                <Icon className={`w-4 h-4 ${color}`} />
                <h2 className={`font-mono uppercase tracking-wide text-sm ${color}`}>{label}</h2>
                <span className="text-xs text-muted-foreground font-mono">({items.length})</span>
              </div>
              <div className="space-y-2">
                <AnimatePresence>
                  {items.map((doc, idx) => (
                    <motion.div key={doc.id}
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }} transition={{ delay: idx * 0.04 }}>
                      <Card className="border-border bg-card hover:bg-card/80 transition-colors cursor-pointer"
                        onClick={() => navigate(`/collab/${doc.id}`)}>
                        <CardContent className="p-4 flex items-center gap-4">
                          <Icon className={`w-5 h-5 ${color} shrink-0`} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">{doc.title}</div>
                            <div className="text-xs text-muted-foreground font-mono flex gap-3 mt-0.5 flex-wrap">
                              {doc.studioName && <span className="text-primary/80">{doc.studioName}</span>}
                              {doc.createdBy && <span>Created by {doc.createdBy}</span>}
                              <span className="flex items-center gap-1">
                                <Clock className="w-2.5 h-2.5" />
                                {new Date(doc.updatedAt).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                          <Badge variant="outline" className="font-mono text-[10px] uppercase hidden sm:flex">
                            {doc.docType === "text" ? "Document" : "Spreadsheet"}
                          </Badge>
                          <Button variant="ghost" size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 shrink-0"
                            onClick={e => { e.stopPropagation(); deleteMutation.mutate(doc.id); }}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </section>
          ))}

          {docs?.length === 0 && (
            <div className="text-center py-20 text-muted-foreground font-mono text-sm uppercase tracking-wider">
              No shared documents yet — create one to start collaborating
            </div>
          )}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-wide text-primary">New Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label className="text-xs font-mono uppercase text-muted-foreground">Title *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Document title" className="bg-background border-border"
                onKeyDown={e => e.key === "Enter" && handleCreate()} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs font-mono uppercase text-muted-foreground">Type</Label>
                <Select value={form.docType} onValueChange={v => setForm(f => ({ ...f, docType: v }))}>
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Document</SelectItem>
                    <SelectItem value="spreadsheet">Spreadsheet</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-mono uppercase text-muted-foreground">Studio</Label>
                <Select value={form.studioId || NONE_VALUE} onValueChange={v => setForm(f => ({ ...f, studioId: v === NONE_VALUE ? "" : v }))}>
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>None</SelectItem>
                    {studios?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-mono uppercase text-muted-foreground">Your Name</Label>
              <Input value={form.createdBy} onChange={e => setForm(f => ({ ...f, createdBy: e.target.value }))}
                placeholder="Optional — shown to collaborators" className="bg-background border-border" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} className="font-mono">Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}
              className="bg-primary text-primary-foreground font-mono gap-2">
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
