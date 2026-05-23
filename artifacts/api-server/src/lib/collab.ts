import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Server as HttpServer } from "http";
import * as Y from "yjs";
import { db } from "@workspace/db";
import { collabDocsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

type Room = {
  doc: Y.Doc;
  clients: Set<WebSocket>;
  saveTimer: ReturnType<typeof setTimeout> | null;
};

const rooms = new Map<string, Room>();

async function loadDoc(docName: string, doc: Y.Doc): Promise<void> {
  const id = docNameToId(docName);
  if (!id) return;
  try {
    const [row] = await db
      .select()
      .from(collabDocsTable)
      .where(eq(collabDocsTable.id, id));
    if (row?.content) {
      Y.applyUpdate(doc, Buffer.from(row.content, "base64"));
    }
  } catch (err) {
    logger.error({ err, docName }, "Failed to load collab doc");
  }
}

async function saveDoc(docName: string, doc: Y.Doc): Promise<void> {
  const id = docNameToId(docName);
  if (!id) return;
  try {
    const state = Y.encodeStateAsUpdate(doc);
    await db
      .update(collabDocsTable)
      .set({
        content: Buffer.from(state).toString("base64"),
        updatedAt: new Date(),
      })
      .where(eq(collabDocsTable.id, id));
  } catch (err) {
    logger.error({ err, docName }, "Failed to save collab doc");
  }
}

function scheduleSave(docName: string, room: Room): void {
  if (room.saveTimer) clearTimeout(room.saveTimer);
  room.saveTimer = setTimeout(async () => {
    room.saveTimer = null;
    await saveDoc(docName, room.doc);
  }, 2000);
}

async function getOrCreateRoom(docName: string): Promise<Room> {
  const existing = rooms.get(docName);
  if (existing) return existing;

  const doc = new Y.Doc();
  const room: Room = { doc, clients: new Set(), saveTimer: null };
  rooms.set(docName, room);

  await loadDoc(docName, doc);

  // Broadcast local doc updates to all connected clients
  doc.on("update", (update: Uint8Array) => {
    const room = rooms.get(docName);
    if (!room) return;
    room.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(update);
      }
    });
  });

  return room;
}

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
    // URL pattern: /api/ws/doc-{id}
    const docName = url.replace(/^\/api\/ws\//, "").split("?")[0] ?? "";

    const room = await getOrCreateRoom(docName);
    room.clients.add(ws);

    // Send current document state to newly connected client
    const currentState = Y.encodeStateAsUpdate(room.doc);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(currentState);
    }

    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      const update = data instanceof Buffer
        ? new Uint8Array(data)
        : new Uint8Array(data as ArrayBuffer);

      // Apply to room doc (triggers the doc update event → broadcast)
      Y.applyUpdate(room.doc, update, ws);

      // Schedule a debounced persist
      scheduleSave(docName, room);
    });

    ws.on("close", async () => {
      room.clients.delete(ws);
      if (room.clients.size === 0) {
        // Flush save and remove room
        if (room.saveTimer) {
          clearTimeout(room.saveTimer);
          room.saveTimer = null;
        }
        await saveDoc(docName, room.doc);
        rooms.delete(docName);
      }
    });

    ws.on("error", (err) => {
      logger.error({ err, docName }, "Collab WebSocket error");
    });
  });
}

function docNameToId(name: string): number | null {
  const match = name.match(/doc-(\d+)$/);
  if (!match || !match[1]) return null;
  const id = parseInt(match[1], 10);
  return isNaN(id) ? null : id;
}
