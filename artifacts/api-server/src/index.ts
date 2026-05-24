import http from "http";
import app from "./app";
import { createCollabUpgradeRouter } from "./lib/collab";
import { createCollaboraUpgradeRouter } from "./lib/collabora-proxy";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = http.createServer(app);

// Single WebSocket upgrade dispatcher. Each router returns true if it
// claimed the upgrade; if none claim it, we destroy the socket so unknown
// upgrade requests can't be used to hold connections open (DoS surface).
const upgradeRouters = [
  createCollabUpgradeRouter(),       // /api/ws/*  — Yjs live collab
  createCollaboraUpgradeRouter(),    // /collabora/* — Collabora reverse proxy
];

httpServer.on("upgrade", (req, socket, head) => {
  for (const route of upgradeRouters) {
    if (route(req, socket, head)) return;
  }
  logger.warn({ url: req.url }, "rejecting unknown WS upgrade");
  try { socket.write("HTTP/1.1 404 Not Found\r\n\r\n"); } catch { /* noop */ }
  socket.destroy();
});

httpServer.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});
