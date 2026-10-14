import { db, wrikeConnectionsTable } from "@workspace/db";
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

async function credentials(forceRefresh = false) {
  requireWrikeConfig();
  // Serialize token refresh across all app replicas. Refresh tokens rotate.
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(61974, 1)`);
    const [row] = await tx.select().from(wrikeConnectionsTable).where(eq(wrikeConnectionsTable.id, 1));
    if (!row) throw new WrikeError("Wrike is not connected. Ask an administrator to connect it.", 409);
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
      }).where(eq(wrikeConnectionsTable.id, 1));
      return { token: next.access_token, host };
    } catch (error) {
      const message = safeWrikeError(error);
      await tx.update(wrikeConnectionsTable).set({ lastError: message }).where(eq(wrikeConnectionsTable.id, 1));
      return { error: message };
    }
  });
  if ("error" in result) throw new WrikeError(result.error!, 409);
  return result;
}

export function safeWrikeError(error: unknown) {
  return error instanceof WrikeError ? error.message : "Wrike sync failed. Check server connectivity and database availability, then retry.";
}
export async function wrikeGet<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) throw new WrikeError("Invalid Wrike API path.");
  let auth = await credentials();
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(`https://${auth.host}/api/v4${path}`, {
        headers: { Authorization: `Bearer ${auth.token}`, Accept: "application/json" },
        redirect: "error", signal: AbortSignal.timeout(15000),
      });
    } catch { throw new WrikeError("Wrike could not be reached. Check network access and retry."); }
    if (response.status === 401 && attempt === 0) { auth = await credentials(true); continue; }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
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
      if (response.status === 401) await db.update(wrikeConnectionsTable).set({ lastError: message }).where(eq(wrikeConnectionsTable.id, 1));
      throw new WrikeError(message, response.status === 429 ? 429 : 502);
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
export async function getWrikeFolder(id: string) {
  if (!/^[a-zA-Z0-9_:.=-]{1,256}$/.test(id)) throw new WrikeError("Invalid Wrike project API ID.", 400);
  const result = await wrikeGet(`/folders/${encodeURIComponent(id)}`, folderPageSchema);
  const folder = result.data.find(f => f.id === id);
  if (!folder) throw new WrikeError("Wrike project was not found.", 404);
  return folder;
}
