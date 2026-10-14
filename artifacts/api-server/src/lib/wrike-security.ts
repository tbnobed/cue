import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class WrikeError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}
const hosts = new Set(["www.wrike.com", "app-eu.wrike.com", "app-us2.wrike.com"]);
export function validWrikeHost(host: string) {
  if (!hosts.has(host)) throw new WrikeError("Wrike returned an unsupported data-center host.");
  return host;
}
export function validWrikeUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port &&
      (u.hostname === "wrike.com" || u.hostname.endsWith(".wrike.com"));
  } catch { return false; }
}
export function wrikeConfig() {
  const missing: string[] = [];
  if (!process.env.WRIKE_CLIENT_ID?.trim()) missing.push("WRIKE_CLIENT_ID");
  if (!process.env.WRIKE_CLIENT_SECRET?.trim()) missing.push("WRIKE_CLIENT_SECRET");
  if (!/^[a-fA-F0-9]{64}$/.test(process.env.WRIKE_TOKEN_KEY ?? "")) missing.push("WRIKE_TOKEN_KEY (64 hex characters)");
  let origin: string | null = null;
  try {
    const u = new URL(process.env.PUBLIC_URL ?? "");
    if (u.protocol !== "https:" || u.username || u.password || u.pathname !== "/" || u.search || u.hash) throw new Error();
    origin = u.origin;
  } catch { missing.push("PUBLIC_URL (HTTPS origin without a page path)"); }
  return { configured: missing.length === 0, missingSettings: missing, redirectUri: origin ? `${origin}/api/integrations/wrike/callback` : null };
}
export function requireWrikeConfig() {
  const config = wrikeConfig();
  if (!config.configured) throw new WrikeError("Configure Wrike credentials, token encryption key and PUBLIC_URL on the Cue server first.", 503);
  return config;
}
function key() {
  if (!/^[a-fA-F0-9]{64}$/.test(process.env.WRIKE_TOKEN_KEY ?? "")) throw new WrikeError("Wrike token encryption key is missing or invalid.", 503);
  return Buffer.from(process.env.WRIKE_TOKEN_KEY!, "hex");
}
export function sealWrikeToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString("base64url")).join(".");
}
export function openWrikeToken(value: string) {
  try {
    const [iv, tag, ciphertext] = value.split(".").map(v => Buffer.from(v, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new WrikeError("Cannot decrypt the Wrike connection. Restore the original token key or reconnect Wrike.", 503);
  }
}
