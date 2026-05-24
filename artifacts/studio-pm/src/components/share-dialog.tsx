import { useState } from "react";
import {
  useListShareLinks,
  useCreateShareLink,
  useRevokeShareLink,
  getListShareLinksQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Share2, Copy, Check, Trash2, Loader2, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type ResourceType = "project" | "task" | "document";

interface ShareDialogProps {
  resourceType: ResourceType;
  resourceId: number;
  resourceTitle: string;
  trigger?: React.ReactNode;
  /** Visual variant for the default trigger button. */
  triggerVariant?: "button" | "icon";
}

/**
 * Read-only public sharing dialog. Lists existing links for a resource and
 * lets the operator mint a new one or revoke an existing one. Public viewers
 * land on `/s/:token` and see a stripped-down view with no edit affordances.
 */
export function ShareDialog({
  resourceType, resourceId, resourceTitle, trigger, triggerVariant = "icon",
}: ShareDialogProps) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const queryKey = getListShareLinksQueryKey({ resourceType, resourceId });
  const { data: links, isLoading } = useListShareLinks(
    { resourceType, resourceId },
    { query: { enabled: open, queryKey } },
  );

  const createMut = useCreateShareLink({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey }),
      onError: (e) => toast({ title: "Could not create link", description: String(e), variant: "destructive" }),
    },
  });
  const revokeMut = useRevokeShareLink({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey }),
      onError: (e) => toast({ title: "Could not revoke link", description: String(e), variant: "destructive" }),
    },
  });

  const [justCopied, setJustCopied] = useState<number | null>(null);
  async function copy(url: string, id: number) {
    try {
      await navigator.clipboard.writeText(url);
      setJustCopied(id);
      setTimeout(() => setJustCopied(c => (c === id ? null : c)), 1500);
    } catch {
      toast({ title: "Copy failed", description: "Select and copy manually.", variant: "destructive" });
    }
  }

  const defaultTrigger = triggerVariant === "icon" ? (
    <Button
      variant="ghost" size="icon"
      className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10"
      onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      title="Share"
      data-testid={`button-share-${resourceType}-${resourceId}`}
    >
      <Share2 className="w-3.5 h-3.5" />
    </Button>
  ) : (
    <Button
      variant="outline" size="sm" className="gap-2 h-9 shrink-0"
      onClick={() => setOpen(true)}
      data-testid={`button-share-${resourceType}-${resourceId}`}
    >
      <Share2 className="w-3.5 h-3.5" />
      Share
    </Button>
  );

  const activeLinks = (links ?? []).filter(l => l.active);
  const inactiveLinks = (links ?? []).filter(l => !l.active);

  return (
    <>
      {trigger ? <span onClick={(e) => { e.stopPropagation(); setOpen(true); }}>{trigger}</span> : defaultTrigger}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="w-4 h-4 text-primary" />
              Share {resourceType}
            </DialogTitle>
            <DialogDescription className="truncate">
              Anyone with the link can view <span className="text-foreground">{resourceTitle}</span>. Links are read-only.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : activeLinks.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No active links yet. Create one below.</p>
            ) : (
              <ul className="space-y-2">
                {activeLinks.map(link => (
                  <li key={link.id} className="surface-card ring-hairline rounded-lg p-2.5 flex items-center gap-2">
                    <Input
                      readOnly value={link.url}
                      className="h-8 text-xs font-mono bg-background/40"
                      onFocus={(e) => e.currentTarget.select()}
                      data-testid={`input-share-link-${link.id}`}
                    />
                    <Button
                      size="icon" variant="ghost" className="h-8 w-8 shrink-0"
                      onClick={() => copy(link.url, link.id)}
                      title="Copy link"
                      data-testid={`button-copy-share-${link.id}`}
                    >
                      {justCopied === link.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </Button>
                    <Button
                      size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={() => window.open(link.url, "_blank", "noopener")}
                      title="Open in new tab"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="icon" variant="ghost"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
                      onClick={() => revokeMut.mutate({ id: link.id })}
                      disabled={revokeMut.isPending}
                      title="Revoke link"
                      data-testid={`button-revoke-share-${link.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {inactiveLinks.length > 0 && (
              <details className="text-[11px] text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground">
                  {inactiveLinks.length} revoked / expired
                </summary>
                <ul className="mt-2 space-y-1">
                  {inactiveLinks.map(l => (
                    <li key={l.id} className="flex items-center gap-2 font-mono">
                      <span className="line-through truncate">{l.url}</span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wider">
                        {l.revokedAt ? "revoked" : "expired"} {formatDistanceToNow(new Date(l.revokedAt ?? l.expiresAt ?? l.createdAt), { addSuffix: true })}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
            <Button
              className="gap-2"
              onClick={() => createMut.mutate({ data: { resourceType, resourceId } })}
              disabled={createMut.isPending}
              data-testid="button-create-share-link"
            >
              {createMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
              Create new link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
