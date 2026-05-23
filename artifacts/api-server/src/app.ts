import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";
import { getSessionMiddleware } from "./lib/session";
import { requireAuth } from "./middlewares/require-auth";
import { isAuthConfigured } from "./lib/oidc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fail-closed production guardrail: requireAuth lets requests through in
// "guest mode" when AUTHENTIK_* env vars are absent (so local dev works).
// In production a missing/mistyped env var would silently expose every data
// route, so refuse to boot unless the operator opts in explicitly.
if (process.env.NODE_ENV === "production" && !isAuthConfigured()) {
  if (process.env.ALLOW_GUEST_MODE !== "true") {
    throw new Error(
      "Authentik OIDC is not configured (missing AUTHENTIK_ISSUER / AUTHENTIK_CLIENT_ID / AUTHENTIK_CLIENT_SECRET / PUBLIC_URL). " +
        "Refusing to start in production with unauthenticated routes. " +
        "Set those env vars, or set ALLOW_GUEST_MODE=true to override (NOT recommended).",
    );
  }
  logger.warn("ALLOW_GUEST_MODE=true in production — all data routes are unauthenticated.");
}

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

// Uploaded files contain potentially sensitive project docs — gate behind session.
// Collabora fetches files via the separate /api/wopi/* HMAC-signed channel, not here.
app.use("/api/uploads", requireAuth, express.static(path.join(__dirname, "..", "uploads")));
app.use("/api", router);

// Centralised error handler so async failures don't crash the worker silently
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  req.log?.error({ err }, "unhandled error");
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});

export default app;
