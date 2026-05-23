import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server as HttpServer } from "http";
import * as Y from "yjs";
import { db } from "@workspace/db";
import { collabDocsTable, documentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

type Room = {
  doc: Y.Doc;
  clients: Set<WebSocket>;
  saveTimer: ReturnType<typeof setTimeout> | null;
};

const rooms = new Map<string, Room>();

// ── Persistence helpers ───────────────────────────────────────────────────

async function loadDoc(roomName: string, ydoc: Y.Doc): Promise<void> {
  try {
    const raw = await readContent(roomName);
    if (raw) Y.applyUpdate(ydoc, Buffer.from(raw, "base64"));
  } catch (err) {
    logger.error({ err, roomName }, "Failed to load collab content");
  }
}

async function saveDoc(roomName: string, ydoc: Y.Doc): Promise<void> {
  try {
    const encoded = Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString("base64");
    await writeContent(roomName, encoded);
  } catch (err) {
    logger.error({ err, roomName }, "Failed to save collab content");
  }
}

async function readContent(roomName: string): Promise<string | null> {
  // file-{id}  → documents.collab_content
  const fileId = roomName.match(/^file-(\d+)$/)?.[1];
  if (fileId) {
    const [row] = await db.select().from(documentsTable).where(eq(documentsTable.id, parseInt(fileId)));
    return row?.collabContent ?? null;
  }
  // doc-{id}   → collab_docs.content  (collab page docs)
  const docId = roomName.match(/^doc-(\d+)$/)?.[1];
  if (docId) {
    const [row] = await db.select().from(collabDocsTable).where(eq(collabDocsTable.id, parseInt(docId)));
    return row?.content ?? null;
  }
  return null;
}

async function writeContent(roomName: string, encoded: string): Promise<void> {
  const fileId = roomName.match(/^file-(\d+)$/)?.[1];
  if (fileId) {
    await db.update(documentsTable)
      .set({ collabContent: encoded, updatedAt: new Date() })
      .where(eq(documentsTable.id, parseInt(fileId)));
    return;
  }
  const docId = roomName.match(/^doc-(\d+)$/)?.[1];
  if (docId) {
    await db.update(collabDocsTable)
      .set({ content: encoded, updatedAt: new Date() })
      .where(eq(collabDocsTable.id, parseInt(docId)));
  }
}

// ── Room management ───────────────────────────────────────────────────────

function scheduleSave(roomName: string, room: Room): void {
  if (room.saveTimer) clearTimeout(room.saveTimer);
  room.saveTimer = setTimeout(async () => {
    room.saveTimer = null;
    await saveDoc(roomName, room.doc);
  }, 2000);
}

async function getOrCreateRoom(roomName: string): Promise<Room> {
  const existing = rooms.get(roomName);
  if (existing) return existing;

  const ydoc = new Y.Doc();
  const room: Room = { doc: ydoc, clients: new Set(), saveTimer: null };
  rooms.set(roomName, room);

  await loadDoc(roomName, ydoc);

  ydoc.on("update", (update: Uint8Array) => {
    const r = rooms.get(roomName);
    if (!r) return;
    r.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(update);
    });
  });

  return room;
}

// ── HTTP → WebSocket upgrade ──────────────────────────────────────────────

export function attachCollabServer(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request: IncomingMessage, socket, head) => {
    const url = request.url ?? "";
    if (!url.startsWith("/api/ws")) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    const url = req.url ?? "";
    // /api/ws/file-1  or  /api/ws/doc-1
    const roomName = url.replace(/^\/api\/ws\//, "").split("?")[0] ?? "";

    const room = await getOrCreateRoom(roomName);
    room.clients.add(ws);

    // Send full current state to new client
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(Y.encodeStateAsUpdate(room.doc));
    }

    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      const update = data instanceof Buffer
        ? new Uint8Array(data)
        : new Uint8Array(data as ArrayBuffer);
      Y.applyUpdate(room.doc, update, ws);
      scheduleSave(roomName, room);
    });

    ws.on("close", async () => {
      room.clients.delete(ws);
      if (room.clients.size === 0) {
        if (room.saveTimer) { clearTimeout(room.saveTimer); room.saveTimer = null; }
        await saveDoc(roomName, room.doc);
        rooms.delete(roomName);
      }
    });

    ws.on("error", (err) => {
      logger.error({ err, roomName }, "Collab WS error");
    });
  });
}
