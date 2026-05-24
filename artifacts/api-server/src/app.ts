import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { getSessionMiddleware } from "./lib/session";

const app: Express = express();

// Required when running behind a TLS-terminating reverse proxy (Caddy/Traefik/nginx).
// Without this, `secure` cookies aren't set in production because Express sees HTTP,
// causing post-login redirect loops with "Sign-in session expired".
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(getSessionMiddleware());

// Uploaded files contain potentially sensitive project docs. Authenticated
// download is now served by routes/uploads.ts via the /api router below — it
// resolves filename → document → project and enforces requireProjectAccess
// (the old express.static here only checked auth, not project visibility).
// Collabora fetches files via the separate /api/wopi/* HMAC-signed channel.
app.use("/api", router);

// Serve the built studio-pm frontend when its bundle is present on disk.
// In the Docker runner image the Dockerfile copies `artifacts/studio-pm/dist`
// to /app/artifacts/studio-pm/dist, and the api-server runs with cwd=/app
// (see Dockerfile WORKDIR + CMD), so this resolves to the right place.
// In Replit dev the frontend is served by its own Vite workflow and this
// directory doesn't exist — the existsSync check keeps dev a no-op so we
// don't double-serve or shadow the dev server.
const frontendDir = path.resolve(process.cwd(), "artifacts/studio-pm/dist/public");
if (fs.existsSync(frontendDir)) {
  logger.info({ frontendDir }, "Serving built frontend");
  app.use(express.static(frontendDir, { index: false, maxAge: "1h" }));
  // SPA fallback: any non-/api GET that didn't match a static file returns
  // index.html so client-side routing (Wouter) handles the path.
  app.get(/^\/(?!api\/).*/, (_req, res, next) => {
    res.sendFile(path.join(frontendDir, "index.html"), (err) => {
      if (err) next(err);
    });
  });
} else {
  logger.info({ frontendDir }, "Frontend bundle not found; skipping static serving (dev mode)");
}

// Centralised error handler so async failures don't crash the worker silently
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  req.log?.error({ err }, "unhandled error");
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});

export default app;
