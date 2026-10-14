import { db, wrikeConnectionsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { WrikeError, requireWrikeConfig, validWrikeHost, sealWrikeToken, openWrikeToken } from "./wrike-security";

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  host: z.string().optional(),
});
export async function exchangeWrikeToken(params: Record<string, string>) {
  requireWrikeConfig();
  let response: Response;
  try {
    response = await fetch("https://login.wrike.com/oauth2/token", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: process.env.WRIKE_CLIENT_ID!, client_secret: process.env.WRIKE_CLIENT_SECRET!, ...params }),
    });
  } catch { throw new WrikeError("Wrike authorization service is unreachable. Try again."); }
  if (!response.ok) throw new WrikeError(response.status < 500 ? "Wrike authorization was rejected. Reconnect and check the app credentials." : "Wrike authorization service is temporarily unavailable.", response.status < 500 ? 409 : 502);
  const parsed = tokenSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new WrikeError("Wrike returned an invalid authorization response.");
  if (parsed.data.host) validWrikeHost(parsed.data.host);
  return parsed.data;
}

export async function personalWrikeConnection(userId: number) {
  const [row] = await db.select().from(wrikeConnectionsTable).where(eq(wrikeConnectionsTable.ownerUserId, userId));
  if (!row || row.revokedAt) throw new WrikeError("Connect your own Wrike account first.", 409);
  return row;
}

async function credentials(connectionId: number, forceRefresh = false) {
  requireWrikeConfig();
  // Serialize token refresh across all app replicas. Refresh tokens rotate.
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(61974, ${connectionId})`);
    const [row] = await tx.select().from(wrikeConnectionsTable).where(eq(wrikeConnectionsTable.id, connectionId)).for("update");
    if (!row || row.revokedAt) throw new WrikeError("This project's Wrike connection was disconnected. Its owner must reconnect or another manager must take over.", 409);
    const [owner] = await tx.select({ active: usersTable.isActive }).from(usersTable).where(eq(usersTable.id, row.ownerUserId));
    if (!owner?.active) throw new WrikeError("The Wrike connection owner is inactive. An authorized manager must take over sync.", 409);
    if (row.cooldownUntil && row.cooldownUntil.getTime() > Date.now()) {
      throw new WrikeError("Wrike is rate limited. The queued import will retry after the provider's cooldown.", 429, row.cooldownUntil.getTime() - Date.now());
    }
    const host = validWrikeHost(row.host);
    if (!forceRefresh && row.expiresAt.getTime() > Date.now() + 60000) {
      return { token: openWrikeToken(row.accessToken), host };
    }
    try {
      const next = await exchangeWrikeToken({ grant_type: "refresh_token", refresh_token: openWrikeToken(row.refreshToken) });
      if (next.host && next.host !== host) throw new WrikeError("Wrike data-center changed. Reconnect the integration.", 409);
      await tx.update(wrikeConnectionsTable).set({
        accessToken: sealWrikeToken(next.access_token), refreshToken: sealWrikeToken(next.refresh_token),
        expiresAt: new Date(Date.now() + next.expires_in * 1000), lastError: null,
      }).where(eq(wrikeConnectionsTable.id, connectionId));
      return { token: next.access_token, host };
    } catch (error) {
      const message = safeWrikeError(error);
      await tx.update(wrikeConnectionsTable).set({ lastError: message }).where(eq(wrikeConnectionsTable.id, connectionId));
      return { error: message, status: error instanceof WrikeError ? error.status : 502 };
    }
  });
  if ("error" in result) throw new WrikeError(result.error!, result.status);
  return result;
}

export function safeWrikeError(error: unknown) {
  return error instanceof WrikeError ? error.message : "Wrike sync failed. Check server connectivity and database availability, then retry.";
}
export async function wrikeGet<T>(connectionId: number, path: string, schema: z.ZodType<T>): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) throw new WrikeError("Invalid Wrike API path.");
  let auth = await credentials(connectionId);
  for (let attempt = 0; attempt < 3; attempt++) {
    // Reserve a request slot in PostgreSQL, shared by all replicas and picker
    // requests. Do not sleep with a transaction/connection held open.
    const delay = await db.transaction(async tx => {
      const [row] = await tx.select().from(wrikeConnectionsTable).where(eq(wrikeConnectionsTable.id, connectionId)).for("update");
      if (!row || row.revokedAt) throw new WrikeError("Wrike connection was disconnected.", 409);
      const at = Math.max(Date.now(), row.nextRequestAt?.getTime() ?? 0, row.cooldownUntil?.getTime() ?? 0);
      if (at - Date.now() > 5000) throw new WrikeError("Wrike request queue is busy. Retry shortly.", 429, at - Date.now());
      await tx.update(wrikeConnectionsTable).set({ nextRequestAt: new Date(at + 350) }).where(eq(wrikeConnectionsTable.id, connectionId));
      return Math.max(0, at - Date.now());
    });
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    let response: Response;
    try {
      response = await fetch(`https://${auth.host}/api/v4${path}`, {
        headers: { Authorization: `Bearer ${auth.token}`, Accept: "application/json" },
        redirect: "error", signal: AbortSignal.timeout(15000),
      });
    } catch { throw new WrikeError("Wrike could not be reached. Check network access and retry."); }
    if (response.status === 401 && attempt === 0) { auth = await credentials(connectionId, true); continue; }
    if (response.status === 429) {
      const raw = response.headers.get("retry-after") ?? "";
      const seconds = Number(raw);
      const wait = Math.max(1000, raw && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now() || 60_000);
      await db.update(wrikeConnectionsTable).set({ cooldownUntil: new Date(Date.now() + wait) }).where(eq(wrikeConnectionsTable.id, connectionId));
      throw new WrikeError("Wrike rate limit reached. The import will retry after the provider's cooldown.", 429, wait);
    }
    if (response.status >= 500 && attempt < 2) {
      const retry = Number(response.headers.get("retry-after"));
      await new Promise(resolve => setTimeout(resolve, Math.min(5000, Math.max(500, Number.isFinite(retry) ? retry * 1000 : 1000 * 2 ** attempt))));
      continue;
    }
    if (!response.ok) {
      const message = response.status === 401 ? "Wrike access has expired or been revoked. Reconnect Wrike."
        : response.status === 403 ? "The connected Wrike account does not have permission for this resource."
        : response.status === 404 ? "Wrike project was not found or is no longer accessible."
        : response.status === 429 ? "Wrike rate limit reached. Retry later."
        : `Wrike request failed (HTTP ${response.status}). Retry or check the integration.`;
      if (response.status === 401) await db.update(wrikeConnectionsTable).set({ lastError: message }).where(eq(wrikeConnectionsTable.id, connectionId));
      throw new WrikeError(message, [401, 403, 404].includes(response.status) ? response.status : 502);
    }
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new WrikeError("Wrike returned unexpected data; nothing was imported.");
    return parsed.data;
  }
  throw new WrikeError("Wrike request could not be completed.");
}

export const folderSchema = z.object({
  id: z.string().min(1), title: z.string(), permalink: z.string(),
  project: z.object({}).passthrough().optional(),
});
export const folderPageSchema = z.object({ data: z.array(folderSchema), nextPageToken: z.string().nullish() });
export async function getWrikeFolder(connectionId: number, id: string) {
  if (!/^[a-zA-Z0-9_:.=-]{1,256}$/.test(id)) throw new WrikeError("Invalid Wrike project API ID.", 400);
  const result = await wrikeGet(connectionId, `/folders/${encodeURIComponent(id)}`, folderPageSchema);
  const folder = result.data.find(f => f.id === id);
  if (!folder) throw new WrikeError("Wrike project was not found.", 404);
  return folder;
}
