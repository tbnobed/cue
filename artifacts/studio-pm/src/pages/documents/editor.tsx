import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import * as Y from "yjs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Download, Wifi, WifiOff } from "lucide-react";
import { SpreadsheetEditor } from "./editor-spreadsheet";
import { RichTextEditor } from "./editor-richtext";

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

type FileKind = "spreadsheet" | "richtext" | "code" | "image" | "pdf" | "binary";

function detectKind(url: string | null): FileKind {
  if (!url) return "richtext";
  const ext = url.split(".").pop()?.toLowerCase() ?? "";
  if (["csv", "tsv"].includes(ext)) return "spreadsheet";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["txt", "md", "markdown"].includes(ext)) return "richtext";
  if (["js", "ts", "jsx", "tsx", "json", "yaml", "yml", "xml", "html", "htm", "css", "scss", "py", "rb", "go", "java", "c", "cpp", "h", "sh", "env", "ini", "toml", "conf", "log"].includes(ext)) return "code";
  return "binary";
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
      const docs: Array<{ id: number; title: string; url: string | null; category: string; uploadedBy: string | null; version: string | null; projectId: number | null; projectName: string | null; updatedAt: string }> = await res.json();
      const found = docs.find(d => d.id === docId);
      if (!found) throw new Error("Document not found");
      return found;
    },
    enabled: !!docId,
  });

  const kind = useMemo(() => doc ? detectKind(doc.url) : "richtext", [doc]);

  // One canonical room per document. Kind is derived from the immutable file
  // extension, so it never changes for a given doc; this keeps the collab
  // persistence path (`file-{id}` → documents.collab_content) intact.
  const roomName = useMemo(() => `file-${docId}`, [docId]);
  const ydoc = useMemo(() => new Y.Doc(), [roomName]);
  const wsUrl = useMemo(() => buildWsUrl(roomName), [roomName]);
  const connected = useCollabSocket(wsUrl, ydoc);

  // Consume the one-time seed text from server (atomic - first viewer wins).
  // Persist to sessionStorage so StrictMode double-mount / page refresh
  // before first ymap write doesn't lose the seed.
  const [seedText, setSeedText] = useState<string | null>(null);
  const [seedReady, setSeedReady] = useState(false);
  const seedStorageKey = `doc-seed-${docId}`;

  useEffect(() => {
    if (!doc) return;
    if (kind === "image" || kind === "pdf" || kind === "binary") {
      setSeedReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      // 1) If a prior mount already fetched the seed, reuse it.
      try {
        const cached = sessionStorage.getItem(seedStorageKey);
        if (cached !== null) {
          if (!cancelled) {
            setSeedText(cached);
            setSeedReady(true);
          }
          return;
        }
      } catch {
        // sessionStorage may be unavailable; fall through to network.
      }
      // 2) Otherwise call the atomic consume-seed endpoint.
      try {
        const res = await fetch(`${BASE}/api/documents/${docId}/consume-seed`, { method: "POST" });
        if (res.ok) {
          const json = await res.json();
          const text: string | null = typeof json.text === "string" ? json.text : null;
          if (text !== null) {
            try { sessionStorage.setItem(seedStorageKey, text); } catch { /* ignore quota */ }
          }
          if (!cancelled) setSeedText(text);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setSeedReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [doc, docId, kind, seedStorageKey]);

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-4 py-8">
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
  const kindLabel: Record<FileKind, string> = {
    spreadsheet: "Spreadsheet",
    richtext: "Document",
    code: "Code",
    image: "Image",
    pdf: "PDF",
    binary: "File",
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
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
              <span className="text-[10px] font-mono uppercase text-primary/80 border border-primary/40 bg-primary/10 rounded px-1.5 py-0.5">
                {kindLabel[kind]}
              </span>
              {doc.projectName && (
                <span className="text-xs text-primary/80 font-mono">{doc.projectName}</span>
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
                Download original
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

      {/* Viewer/Editor based on file kind */}
      {!seedReady ? (
        <Skeleton className="h-[65vh] w-full" />
      ) : kind === "spreadsheet" ? (
        <SpreadsheetEditor ydoc={ydoc} seedText={seedText} />
      ) : kind === "image" ? (
        <ImageViewer url={`${BASE}${doc.url}`} title={doc.title} />
      ) : kind === "pdf" ? (
        <PdfViewer url={`${BASE}${doc.url}`} />
      ) : kind === "binary" ? (
        <BinaryViewer url={doc.url ? `${BASE}${doc.url}` : null} title={doc.title} ext={fileExt ?? null} />
      ) : (
        <RichTextEditor
          ydoc={ydoc}
          seedText={seedText}
          seedAsCode={kind === "code"}
          placeholder={
            kind === "code"
              ? "Code preview — edit collaboratively in real time…"
              : "Start writing — all editors see changes in real time…"
          }
        />
      )}

      <p className="text-[11px] text-muted-foreground font-mono text-center pb-4">
        {kind === "image" || kind === "pdf" || kind === "binary"
          ? "Original file is read-only — download to make changes locally"
          : "Changes sync automatically — share this page URL with your team to collaborate in real time"}
      </p>
    </div>
  );
}

function ImageViewer({ url, title }: { url: string; title: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-6 flex items-center justify-center min-h-[60vh]">
      <img src={url} alt={title} className="max-w-full max-h-[75vh] object-contain rounded" />
    </div>
  );
}

function PdfViewer({ url }: { url: string }) {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <iframe src={url} className="w-full h-[75vh] border-0" title="PDF preview" />
    </div>
  );
}

function BinaryViewer({ url, title, ext }: { url: string | null; title: string; ext: string | null }) {
  return (
    <div className="bg-card border border-border rounded-lg p-12 flex flex-col items-center justify-center text-center min-h-[40vh] gap-3">
      <div className="text-5xl font-mono font-black text-muted-foreground/40">{ext ?? "FILE"}</div>
      <div className="font-medium">{title}</div>
      <div className="text-xs text-muted-foreground font-mono max-w-md">
        This file type can't be previewed inline. Download the original to open it in the appropriate application.
      </div>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" download={title}>
          <Button variant="default" size="sm" className="font-mono text-xs gap-1.5 mt-2">
            <Download className="w-3.5 h-3.5" />
            Download
          </Button>
        </a>
      )}
    </div>
  );
}
