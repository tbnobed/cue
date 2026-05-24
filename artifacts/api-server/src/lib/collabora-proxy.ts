import httpProxy from "http-proxy";
import type { Express, Request, Response, NextFunction } from "express";
import type { Server as HttpServer, IncomingMessage } from "http";
import type { Socket } from "net";
import { logger } from "./logger.js";

/**
 * Reverse-proxy Collabora Online through the app at `/collabora/*`.
 *
 * Why this exists:
 *   Operators repeatedly hit the trap of pointing `COLLABORA_URL` at
 *   `http://localhost:9980` and then wondering why end-users see "can't
 *   connect to localhost:9980" — `localhost` from a browser means the user's
 *   own machine. The fix is normally "stand up a new vhost on your reverse
 *   proxy (Caddy/nginx/NPM), terminate TLS, forward WebSockets". That's
 *   error-prone (esp. NPM users who forget the Websockets checkbox).
 *
 *   So we just do it for them. The app already sits behind a reverse proxy
 *   on a known public hostname (PUBLIC_URL). We expose Collabora under
 *   `${PUBLIC_URL}/collabora/*` — same domain, same TLS cert, same WS
 *   upgrade path that already works for /api/ws/*. Operators only need to
 *   add the `collabora` service to docker-compose (already there) and the
 *   editor Just Works.
 *
 *   Collabora supports being mounted at a subpath via `--o:net.proxy_prefix=true`
 *   (set in docker-compose.yml). It extracts the prefix from the request
 *   path itself, so we forward the full `/collabora/...` path upstream
 *   without stripping the prefix.
 *
 * Security:
 *   The proxy is mounted WITHOUT requireAuth because Collabora's HTML/JS
 *   assets (cool.html, /browser/*) are loaded by the browser anonymously —
 *   actual document access is gated by the WOPI access_token in the URL
 *   (HMAC-signed, see wopi-token.ts). This matches how Collabora is
 *   deployed behind any reverse proxy in the wild.
 *
 *   The proxy is also a strict prefix match — only `/collabora/*` paths
 *   are forwarded, nothing else.
 */

const PREFIX = "/collabora";
const DEFAULT_UPSTREAM = "http://collabora:9980";

/**
 * Replaces the `frame-ancestors` directive in any CSP header on the proxied
 * response with one that allows `allowedOrigin`, and strips X-Frame-Options
 * (which would otherwise win against frame-ancestors in some browsers).
 * Mutates the headers object in place.
 */
function rewriteFrameAncestors(
  headers: import("http").IncomingHttpHeaders,
  allowedOrigin: string,
): void {
  // X-Frame-Options can't express multi-origin allow lists — just drop it
  // and rely on CSP frame-ancestors below.
  delete headers["x-frame-options"];

  const cspKey = Object.keys(headers).find((k) => k.toLowerCase() === "content-security-policy");
  const replacement = `frame-ancestors 'self' ${allowedOrigin}`;
  if (!cspKey) {
    headers["content-security-policy"] = replacement;
    return;
  }
  const raw = headers[cspKey];
  const current = Array.isArray(raw) ? raw.join("; ") : (raw ?? "");
  const directives = current.split(";").map((d) => d.trim()).filter(Boolean);
  let found = false;
  const rewritten = directives.map((d) => {
    if (/^frame-ancestors\b/i.test(d)) {
      found = true;
      return replacement;
    }
    return d;
  });
  if (!found) rewritten.push(replacement);
  headers[cspKey] = rewritten.join("; ");
}

function upstream(): string {
  // COLLABORA_UPSTREAM_URL = the in-network URL the *server* uses to reach
  // Collabora (docker compose service name). Distinct from COLLABORA_URL,
  // which is the public URL the browser sees.
  return (process.env.COLLABORA_UPSTREAM_URL || DEFAULT_UPSTREAM).replace(/\/$/, "");
}

let proxyInstance: ReturnType<typeof httpProxy.createProxyServer> | null = null;

function getProxy(): ReturnType<typeof httpProxy.createProxyServer> {
  if (proxyInstance) return proxyInstance;
  proxyInstance = httpProxy.createProxyServer({
    target: upstream(),
    // changeOrigin must be false — Collabora uses the incoming Host header to
    // build absolute URLs for its static assets and WebSocket endpoint. If we
    // rewrite Host to `collabora:9980` (the upstream), the browser then tries
    // to fetch from collabora:9980 and fails with NS_ERROR_UNKNOWN_HOST.
    // Keep Host = cue.obtv.io (or whatever the operator's public domain is).
    changeOrigin: false,
    ws: true,
    // Long-lived editing sessions need WS pings to stay alive; node-http-proxy
    // doesn't enforce a read timeout by default which is what we want here.
    proxyTimeout: 0,
    timeout: 0,
    xfwd: true,
  });
  // Rewrite Collabora's CSP/X-Frame-Options so the editor iframe is always
  // embeddable by whatever host the operator's reverse proxy is using.
  // Collabora by default emits `frame-ancestors 'self'` which blocks embedding
  // in the parent app (different origin from Collabora's POV). Without this
  // rewrite, operators would have to set --o:net.frame_ancestors=<their host>
  // in docker-compose for every deployment.
  proxyInstance.on("proxyRes", (proxyRes: import("http").IncomingMessage, req: import("http").IncomingMessage) => {
    const host = (req.headers["x-forwarded-host"] || req.headers.host || "") as string;
    const proto = ((req.headers["x-forwarded-proto"] as string) || "https").split(",")[0]?.trim() || "https";
    const allow = host ? `${proto}://${host}` : "*";
    rewriteFrameAncestors(proxyRes.headers, allow);
  });
  proxyInstance.on("error", (err, _req, res) => {
    logger.error({ err: err.message }, "collabora proxy error");
    // `res` may be a ServerResponse or a Socket depending on whether the
    // error fired during an HTTP request or a WS upgrade.
    if (!res) return;
    const maybeServerRes = res as Partial<import("http").ServerResponse>;
    if (typeof maybeServerRes.writeHead === "function" && !maybeServerRes.headersSent) {
      try { maybeServerRes.writeHead(502, { "content-type": "text/plain" }); } catch { /* noop */ }
      try { maybeServerRes.end?.("Bad gateway: Collabora upstream unreachable"); } catch { /* noop */ }
    } else {
      try { (res as Socket).destroy?.(); } catch { /* noop */ }
    }
  });
  return proxyInstance;
}

/** Mounts HTTP forwarding for `/collabora/*` on the Express app. */
export function attachCollaboraHttpProxy(app: Express): void {
  app.use(PREFIX, (req: Request, res: Response, next: NextFunction) => {
    // Collabora runs with `--o:net.service_root=/collabora` so it natively
    // serves every endpoint under the `/collabora` prefix. Express strips
    // the mount path from req.url, so we restore it before forwarding.
    req.url = PREFIX + (req.url === "/" ? "/" : req.url);
    getProxy().web(req, res, undefined, (err) => {
      logger.error({ err: err?.message, url: req.url }, "collabora http proxy failed");
      next(err);
    });
  });
  logger.info({ prefix: PREFIX, upstream: upstream() }, "Collabora HTTP proxy mounted");
}

/**
 * Returns a WebSocket upgrade router scoped to `/collabora/*`. Returns
 * `true` when it handled the upgrade, `false` otherwise. Wired into the
 * single upgrade dispatcher in index.ts.
 */
export function createCollaboraUpgradeRouter(): (
  req: IncomingMessage,
  socket: import("stream").Duplex,
  head: Buffer,
) => boolean {
  return (req, socket, head) => {
    const url = req.url ?? "";
    if (!url.startsWith(PREFIX + "/") && url !== PREFIX) return false;
    // service_root mode: forward the full /collabora/* path unchanged.
    // http-proxy's .ws() accepts any Duplex; Socket-typed signature is overly narrow.
    getProxy().ws(req, socket as unknown as Socket, head);
    return true;
  };
}

export { PREFIX as COLLABORA_PROXY_PREFIX };

export function getCollaboraUpstream(): string {
  return upstream();
}
