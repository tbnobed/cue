import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import * as Y from "yjs";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Download, Wifi, WifiOff,
  Bold, Italic, List, ListOrdered, Heading1, Heading2, Heading3, Minus, Undo2, Redo2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function buildWsUrl(roomName: string): string {
  const loc = window.location;
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}${BASE}/api/ws/${roomName}`;
}

function useCollabSocket(wsUrl: string, ydoc: Y.Doc) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let destroyed = false;
    let ws: WebSocket;

    function connect() {
      if (destroyed) return;
      ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!destroyed) setTimeout(connect, 2000);
      };
      ws.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        Y.applyUpdate(ydoc, new Uint8Array(e.data), ws);
      };
    }

    connect();

    const updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin === wsRef.current) return;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(update);
      }
    };
    ydoc.on("update", updateHandler);

    return () => {
      destroyed = true;
      ydoc.off("update", updateHandler);
      ws?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [wsUrl, ydoc]);

  return connected;
}

export default function DocumentEditor() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const docId = parseInt(id || "0", 10);

  const { data: doc, isLoading } = useQuery({
    queryKey: ["document", docId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/documents`);
      if (!res.ok) throw new Error("Failed to fetch documents");
      const docs: Array<{ id: number; title: string; url: string | null; category: string; uploadedBy: string | null; version: string | null; studioId: number | null; studioName: string | null; updatedAt: string }> = await res.json();
      const found = docs.find(d => d.id === docId);
      if (!found) throw new Error("Document not found");
      return found;
    },
    enabled: !!docId,
  });

  const ydoc = useMemo(() => new Y.Doc(), [docId]);
  const wsUrl = useMemo(() => buildWsUrl(`file-${docId}`), [docId]);
  const connected = useCollabSocket(wsUrl, ydoc);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false, undoRedo: false }),
      Collaboration.configure({ document: ydoc }),
      Placeholder.configure({
        placeholder: "Add collaborative notes for this document — all editors see changes in real time…",
      }),
      CharacterCount,
    ],
    editorProps: {
      attributes: {
        class: "prose prose-invert max-w-none focus:outline-none min-h-[60vh] px-1",
      },
    },
  }, [ydoc]);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4 py-8">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-[60vh] w-full mt-8" />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="text-center py-20 text-muted-foreground font-mono">
        Document not found.{" "}
        <button className="text-primary underline" onClick={() => navigate("/documents")}>
          Back to documents
        </button>
      </div>
    );
  }

  const isUploadedFile = doc.url?.startsWith("/api/uploads/");
  const fileExt = doc.url ? doc.url.split(".").pop()?.toUpperCase() : null;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 pb-3 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/documents")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="font-bold text-xl truncate">{doc.title}</h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {doc.studioName && (
                <span className="text-xs text-primary/80 font-mono">{doc.studioName}</span>
              )}
              {doc.version && (
                <span className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">
                  {doc.version}
                </span>
              )}
              {isUploadedFile && fileExt && (
                <span className="text-[10px] font-mono text-muted-foreground">{fileExt}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {doc.url && (
            <a href={`${BASE}${doc.url}`} target="_blank" rel="noopener noreferrer" download={isUploadedFile ? doc.title : undefined}>
              <Button variant="outline" size="sm" className="font-mono text-xs gap-1.5 h-8">
                <Download className="w-3.5 h-3.5" />
                Download
              </Button>
            </a>
          )}
          <Badge variant="outline"
            className={`font-mono text-[10px] gap-1.5 ${
              connected
                ? "text-green-400 border-green-400/40"
                : "text-amber-400 border-amber-400/40"
            }`}>
            {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {connected ? "Live" : "Connecting…"}
          </Badge>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-1 p-2 bg-card border border-border rounded-lg">
        <ToolBtn title="Heading 1" active={editor?.isActive("heading", { level: 1 })}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>
          <Heading1 className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Heading 2" active={editor?.isActive("heading", { level: 2 })}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Heading 3" active={editor?.isActive("heading", { level: 3 })}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 className="w-3.5 h-3.5" />
        </ToolBtn>
        <div className="w-px h-6 bg-border mx-1 self-center" />
        <ToolBtn title="Bold" active={editor?.isActive("bold")}
          onClick={() => editor?.chain().focus().toggleBold().run()}>
          <Bold className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Italic" active={editor?.isActive("italic")}
          onClick={() => editor?.chain().focus().toggleItalic().run()}>
          <Italic className="w-3.5 h-3.5" />
        </ToolBtn>
        <div className="w-px h-6 bg-border mx-1 self-center" />
        <ToolBtn title="Bullet list" active={editor?.isActive("bulletList")}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}>
          <List className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Numbered list" active={editor?.isActive("orderedList")}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Horizontal rule"
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}>
          <Minus className="w-3.5 h-3.5" />
        </ToolBtn>
        <div className="w-px h-6 bg-border mx-1 self-center" />
        <ToolBtn title="Undo" onClick={() => editor?.chain().focus().undo().run()}>
          <Undo2 className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Redo" onClick={() => editor?.chain().focus().redo().run()}>
          <Redo2 className="w-3.5 h-3.5" />
        </ToolBtn>
        <span className="ml-auto text-[10px] text-muted-foreground font-mono self-center pr-1">
          {editor?.storage.characterCount?.characters() ?? 0} chars
        </span>
      </div>

      {/* Editor */}
      <div
        className="min-h-[65vh] bg-card border border-border rounded-lg p-6 cursor-text"
        onClick={() => editor?.commands.focus()}
      >
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          <div className="flex items-center justify-center h-40 text-muted-foreground font-mono text-sm">
            Loading…
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground font-mono text-center pb-4">
        Changes sync automatically — share this page URL with your team to collaborate in real time
      </p>
    </div>
  );
}

function ToolBtn({
  children, onClick, active, title,
}: {
  children: React.ReactNode; onClick: () => void; active?: boolean; title?: string;
}) {
  return (
    <button
      title={title}
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      className={`p-1.5 rounded text-sm transition-colors ${
        active
          ? "bg-primary/20 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}
