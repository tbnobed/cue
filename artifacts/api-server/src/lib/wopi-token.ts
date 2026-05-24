import crypto from "crypto";

// Known weak / placeholder secrets that must never be accepted in production.
// Matches the defaults shipped in .env.example and docker-compose.yml.
const WEAK_SECRETS = new Set(["", "change_me_in_production", "dev_only_secret_change_me"]);

function resolveSecret(): string {
  const s = process.env.SESSION_SECRET ?? "";
  if (process.env.NODE_ENV === "production" && (s.length < 16 || WEAK_SECRETS.has(s))) {
    throw new Error(
      "SESSION_SECRET is missing or set to a weak/default value. " +
        "Set a strong random string (16+ chars) in your environment before starting the server. " +
        "WOPI access tokens for the LibreOffice editor are signed with this key.",
    );
  }
  // In dev we allow a placeholder so local boots don't break, but warn loudly.
  if (s.length < 16 || WEAK_SECRETS.has(s)) {
    // eslint-disable-next-line no-console
    console.warn(
      "[wopi-token] WARNING: SESSION_SECRET is weak — WOPI tokens are not secure. Do NOT use this configuration in production.",
    );
    return s || "dev_only_secret_change_me";
  }
  return s;
}

const SECRET = resolveSecret();
const DEFAULT_TTL_SEC = 8 * 60 * 60;

export type WopiClaims = { fid: number; exp: number; w: 0 | 1 };

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Buffer {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return Buffer.from(t, "base64");
}

export function signWopiToken(
  fileId: number,
  write: boolean,
  ttlSec: number = DEFAULT_TTL_SEC,
): { token: string; ttlMs: number } {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload: WopiClaims = { fid: fileId, exp, w: write ? 1 : 0 };
  const payloadStr = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(crypto.createHmac("sha256", SECRET).update(payloadStr).digest());
  return { token: `${payloadStr}.${sig}`, ttlMs: ttlSec * 1000 };
}

export function verifyWopiToken(token: string): WopiClaims | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadStr, sig] = parts;
  const expected = b64url(
    crypto.createHmac("sha256", SECRET).update(payloadStr).digest(),
  );
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(b64urlDecode(payloadStr).toString("utf8")) as WopiClaims;
    if (typeof payload.fid !== "number" || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Resolves the public Collabora URL the browser should hit.
 *
 * Order of precedence:
 *   1. COLLABORA_URL env var IF it is a real public URL (not localhost / 127.0.0.1 / 0.0.0.0).
 *      `localhost` from a browser means the user's own machine, so it's never
 *      a usable value in production — it's a leftover from local dev defaults
 *      that operators commonly forget to update. We refuse to send it to the
 *      browser even if explicitly set, because the resulting "Unable to
 *      connect to localhost:9980" error is impossible to debug for the end
 *      user.
 *   2. `${PUBLIC_URL}/collabora` — the auto-proxy mounted by collabora-proxy.ts.
 *      This is the zero-config path and works behind any TLS-terminating
 *      reverse proxy that already fronts the app (NPM, Caddy, Traefik, nginx).
 *   3. null — Collabora is unconfigured; the frontend falls back to in-app editors.
 */
function resolvePublicCollaboraUrl(): string | null {
  const raw = process.env.COLLABORA_URL?.trim();
  const pub = process.env.PUBLIC_URL?.trim();
  const autoProxy = pub ? pub.replace(/\/$/, "") + "/collabora" : null;

  if (raw) {
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase();
      const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";

      // Detect "same hostname as the app, but pointing at a different port
      // than the public TLS port" — almost always a stale env from earlier
      // troubleshooting (e.g. `https://cue.obtv.io:9980`). The reverse proxy
      // doesn't forward arbitrary ports, so the browser gets a hung connect.
      let sameHostWrongOrigin = false;
      if (!isLoopback && pub) {
        try {
          const pu = new URL(pub);
          sameHostWrongOrigin = pu.hostname.toLowerCase() === host && pu.origin !== u.origin;
        } catch { /* PUBLIC_URL is malformed; ignore the cross-check */ }
      }

      if (!isLoopback && !sameHostWrongOrigin) {
        // Operator-supplied value looks legit (different hostname → presumably
        // a dedicated Collabora vhost they manage).
        return raw.replace(/\/$/, "");
      }

      // eslint-disable-next-line no-console
      console.warn(
        "[collabora] COLLABORA_URL=" + raw + " is unreachable from end-user browsers " +
          "(" + (isLoopback ? "loopback address" : "same host as PUBLIC_URL but different port — that port isn't proxied") +
          "). Ignoring and using the in-app auto-proxy at " + (autoProxy ?? "<PUBLIC_URL>/collabora") +
          " instead. Remove COLLABORA_URL from your .env to silence this warning.",
      );
    } catch {
      // eslint-disable-next-line no-console
      console.warn("[collabora] COLLABORA_URL is not a valid URL: " + raw + ". Falling back to auto-proxy.");
    }
  }
  return autoProxy;
}

export function isCollaboraConfigured(): boolean {
  return !!(resolvePublicCollaboraUrl() && process.env.WOPI_PUBLIC_URL);
}

/**
 * Filter-option string passed to LibreOffice when opening a CSV. Without this,
 * LibreOffice pops its "Text Import" dialog every time the user opens the
 * file. Field meanings (semicolon-separated would be wrong — must be commas):
 *   44   = field separator (comma)
 *   34   = text-quote character (double quote)
 *   76   = character set (76 = UTF-8 in LO's CharSet enum)
 *   1    = start at row 1
 *   ""   = column formats (auto-detect)
 *   1033 = language identifier (en-US) for number parsing
 *   false= quoted field as text (off — keep numbers numeric)
 *   true = detect special numbers (dates, scientific)
 *   false= skip empty lines
 *   false= remove space
 * See: https://wiki.documentfoundation.org/Documentation/DevGuide/Spreadsheet_Documents#Filter_Options_for_the_CSV_Filter
 */
const CSV_FILTER_OPTIONS = "44,34,76,1,,1033,false,true,false,false";

function filterOptionsForUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const ext = url.split("?")[0]?.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv" || ext === "tsv") {
    return ext === "tsv"
      ? CSV_FILTER_OPTIONS.replace(/^44,/, "9,") // 9 = TAB
      : CSV_FILTER_OPTIONS;
  }
  return null;
}

export function buildEditSession(
  fileId: number,
  fileUrl?: string | null,
): { actionUrl: string; wopiSrc: string; accessToken: string; accessTokenTtl: number } | null {
  const collaboraUrl = resolvePublicCollaboraUrl();
  const WOPI_PUBLIC_URL = process.env.WOPI_PUBLIC_URL;
  if (!collaboraUrl || !WOPI_PUBLIC_URL) return null;
  const { token, ttlMs } = signWopiToken(fileId, true);
  const wopiSrc = `${WOPI_PUBLIC_URL.replace(/\/$/, "")}/api/wopi/files/${fileId}`;
  // permission=edit is explicit — COOL otherwise falls back to readonly for
  // some file types even when UserCanWrite=true in CheckFileInfo.
  let actionUrl = `${collaboraUrl}/browser/dist/cool.html?WOPISrc=${encodeURIComponent(wopiSrc)}&permission=edit`;
  const opts = filterOptionsForUrl(fileUrl ?? null);
  if (opts) actionUrl += `&options=${encodeURIComponent(opts)}`;
  return { actionUrl, wopiSrc, accessToken: token, accessTokenTtl: ttlMs };
}
