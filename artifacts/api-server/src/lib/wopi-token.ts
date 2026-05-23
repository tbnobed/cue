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

export function isCollaboraConfigured(): boolean {
  return !!(process.env.COLLABORA_URL && process.env.WOPI_PUBLIC_URL);
}

export function buildEditSession(
  fileId: number,
): { actionUrl: string; wopiSrc: string; accessToken: string; accessTokenTtl: number } | null {
  const COLLABORA_URL = process.env.COLLABORA_URL;
  const WOPI_PUBLIC_URL = process.env.WOPI_PUBLIC_URL;
  if (!COLLABORA_URL || !WOPI_PUBLIC_URL) return null;
  const { token, ttlMs } = signWopiToken(fileId, true);
  const wopiSrc = `${WOPI_PUBLIC_URL.replace(/\/$/, "")}/api/wopi/files/${fileId}`;
  const actionUrl = `${COLLABORA_URL.replace(/\/$/, "")}/browser/dist/cool.html?WOPISrc=${encodeURIComponent(wopiSrc)}`;
  return { actionUrl, wopiSrc, accessToken: token, accessTokenTtl: ttlMs };
}
