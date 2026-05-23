import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import * as Y from "yjs";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Users, Wifi, WifiOff, Bold, Italic, List, ListOrdered,
  Heading1, Heading2, Heading3, Table2, Minus, Undo2, Redo2,
} from "lucide-react";

type CollabDoc = {
  id: number; title: string; docType: string;
  studioId: number | null; studioName: string | null;
  createdBy: string | null; createdAt: string; updatedAt: string;
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function buildWsUrl(docName: string): string {
  const loc = window.location;
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}${BASE}/api/ws/${docName}`;
}

/**
 * Minimal Yjs ↔ WebSocket bridge.
 * - On connect: receive current doc state from the server.
 * - On receive: apply the update to ydoc.
 * - On ydoc update: send the update to the server (unless it originated from the socket).
 */
function useCollabSocket(wsUrl: string, ydoc: Y.Doc) {
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let ws: WebSocket;
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);

      ws.onclose = () => {
        setConnected(false);
        if (!destroyed) {
          // Reconnect after 2 seconds
          setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror — reconnect handled there
      };

      ws.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        const update = new Uint8Array(event.data);
        Y.applyUpdate(ydoc, update, ws);
      };
    }

    connect();

    const updateHandler = (update: Uint8Array, origin: unknown) => {
      // Don't echo back updates that came from the socket
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

  return { connected, peers };
}

export default function CollabEditor() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const docId = parseInt(id || "0", 10);

  const { data: doc, isLoading } = useQuery<CollabDoc>({
    queryKey: ["collab-doc", docId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/collab/docs`);
      const docs: CollabDoc[] = await res.json();
      const found = docs.find(d => d.id === docId);
      if (!found) throw new Error("Not found");
      return found;
    },
    enabled: !!docId,
  });

  const ydoc = useMemo(() => new Y.Doc(), [docId]);
  const wsUrl = useMemo(() => buildWsUrl(`doc-${docId}`), [docId]);
  const { connected } = useCollabSocket(wsUrl, ydoc);

  const isSpreadsheet = doc?.docType === "spreadsheet";

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false, undoRedo: false }),
      Collaboration.configure({ document: ydoc }),
      Placeholder.configure({
        placeholder: isSpreadsheet
          ? "Start typing in the table cells…"
          : "Start typing… everyone connected sees your changes in real time.",
      }),
      CharacterCount,
      Table.configure({ resizable: true }),
      TableRow, TableHeader, TableCell,
    ],
    editorProps: {
      attributes: {
        class: "prose prose-invert max-w-none focus:outline-none min-h-[60vh] px-1",
      },
    },
    onCreate({ editor }) {
      if (isSpreadsheet && editor.isEmpty) {
        editor.commands.insertTable({ rows: 10, cols: 6, withHeaderRow: true });
      }
    },
  }, [ydoc, isSpreadsheet]);

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
        <button className="text-primary underline" onClick={() => navigate("/collab")}>
          Back to docs
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 pb-2 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/collab")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="font-bold text-xl truncate">{doc.title}</h1>
            {doc.studioName && (
              <p className="text-xs text-muted-foreground font-mono">{doc.studioName}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <Badge variant="outline"
            className={`font-mono text-[10px] gap-1.5 ${
              connected
                ? "text-green-400 border-green-400/40"
                : "text-amber-400 border-amber-400/40"
            }`}>
            {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {connected ? "Live" : "Reconnecting…"}
          </Badge>
          <span className="text-[10px] text-muted-foreground font-mono hidden sm:block">
            {editor?.storage.characterCount?.characters() ?? 0} chars
          </span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-1 p-2 bg-card border border-border rounded-lg">
        {!isSpreadsheet && (
          <>
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
          </>
        )}
        <ToolBtn title="Bold" active={editor?.isActive("bold")}
          onClick={() => editor?.chain().focus().toggleBold().run()}>
          <Bold className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Italic" active={editor?.isActive("italic")}
          onClick={() => editor?.chain().focus().toggleItalic().run()}>
          <Italic className="w-3.5 h-3.5" />
        </ToolBtn>
        <div className="w-px h-6 bg-border mx-1 self-center" />
        {!isSpreadsheet && (
          <>
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
          </>
        )}
        {isSpreadsheet && (
          <>
            <ToolBtn title="Add row after"
              onClick={() => editor?.chain().focus().addRowAfter().run()}>
              <Table2 className="w-3.5 h-3.5" />
            </ToolBtn>
            <div className="w-px h-6 bg-border mx-1 self-center" />
          </>
        )}
        <ToolBtn title="Undo" onClick={() => editor?.chain().focus().undo().run()}>
          <Undo2 className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Redo" onClick={() => editor?.chain().focus().redo().run()}>
          <Redo2 className="w-3.5 h-3.5" />
        </ToolBtn>
      </div>

      {/* Editor area */}
      <div
        className="min-h-[65vh] bg-card border border-border rounded-lg p-6 cursor-text"
        onClick={() => editor?.commands.focus()}
      >
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          <div className="flex items-center justify-center h-40 text-muted-foreground font-mono text-sm">
            Loading editor…
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
