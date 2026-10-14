import { Router } from "express";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { db, wrikeConnectionsTable, projectWrikeLinksTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/require-auth";
import { wrikeDiscoveryParams } from "../lib/wrike-discovery";
import { exchangeWrikeToken, folderPageSchema, safeWrikeError, wrikeGet } from "../lib/wrike-client";
import { requireWrikeConfig, sealWrikeToken, validWrikeHost, validWrikeUrl, wrikeConfig, WrikeError } from "../lib/wrike-security";

const router = Router();
router.get("/integrations/wrike", async (_req, res) => {
  const config = wrikeConfig();
  const [row] = await db.select({
    host: wrikeConnectionsTable.host, connectedAt: wrikeConnectionsTable.connectedAt, lastError: wrikeConnectionsTable.lastError,
  }).from(wrikeConnectionsTable).where(eq(wrikeConnectionsTable.id, 1));
  res.json({ ...config, connected: !!row, host: row?.host ?? null, connectedAt: row?.connectedAt ?? null, lastError: row?.lastError ?? null });
});
router.post("/integrations/wrike/authorize", requireAdmin, async (req, res) => {
  try {
    const config = requireWrikeConfig();
    const state = randomBytes(32).toString("hex");
    req.session.wrikeOAuth = { state, createdAt: Date.now(), userId: req.authUser!.id };
    await new Promise<void>((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
    const url = new URL("https://login.wrike.com/oauth2/authorize/v4");
    url.search = new URLSearchParams({
      client_id: process.env.WRIKE_CLIENT_ID!, response_type: "code", redirect_uri: config.redirectUri!,
      state, scope: "Default,wsReadOnly",
    }).toString();
    res.json({ url: url.toString() });
  } catch (error) { res.status(error instanceof WrikeError ? error.status : 500).json({ error: safeWrikeError(error) }); }
});
router.get("/integrations/wrike/callback", requireAdmin, async (req, res) => {
  const pending = req.session.wrikeOAuth;
  delete req.session.wrikeOAuth;
  await new Promise<void>((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!pending || pending.userId !== req.authUser!.id || Date.now() - pending.createdAt > 10 * 60_000 ||
      !/^[a-f0-9]{64}$/.test(state) || !timingSafeEqual(Buffer.from(state), Buffer.from(pending.state))) {
    res.redirect("/admin/integrations?wrike=invalid_state"); return;
  }
  if (req.query.error || typeof req.query.code !== "string") { res.redirect("/admin/integrations?wrike=denied"); return; }
  try {
    const config = requireWrikeConfig();
    const token = await exchangeWrikeToken({ grant_type: "authorization_code", code: req.query.code, redirect_uri: config.redirectUri! });
    if (!token.host) throw new WrikeError("Wrike did not provide its data-center host.");
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(61974, 1)`);
      const values = {
        id: 1, generation: randomUUID(), host: validWrikeHost(token.host!),
        accessToken: sealWrikeToken(token.access_token), refreshToken: sealWrikeToken(token.refresh_token),
        expiresAt: new Date(Date.now() + token.expires_in * 1000), connectedBy: req.authUser!.id, connectedAt: new Date(), lastError: null,
      };
      await tx.insert(wrikeConnectionsTable).values(values).onConflictDoUpdate({ target: wrikeConnectionsTable.id, set: values });
      // Admin must explicitly re-enable imports after changing the account.
      await tx.update(projectWrikeLinksTable).set({ autoSync: false });
    });
    res.redirect("/admin/integrations?wrike=connected");
  } catch (error) {
    req.log.warn({ message: safeWrikeError(error) }, "Wrike authorization failed");
    res.redirect("/admin/integrations?wrike=failed");
  }
});
router.delete("/integrations/wrike", requireAdmin, async (_req, res) => {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(61974, 1)`);
    await tx.delete(wrikeConnectionsTable).where(eq(wrikeConnectionsTable.id, 1));
    await tx.update(projectWrikeLinksTable).set({ autoSync: false });
  });
  res.sendStatus(204);
});
router.get("/integrations/wrike/projects", requireAdmin, async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const token = typeof req.query.nextPageToken === "string" ? req.query.nextPageToken : "";
  if (search.length > 200 || token.length > 4000) { res.status(400).json({ error: "Search or page token is too long." }); return; }
  try {
    const params = wrikeDiscoveryParams(search, token);
    const page = await wrikeGet(`/folders?${params}`, folderPageSchema);
    if (page.data.some(p => !validWrikeUrl(p.permalink))) throw new WrikeError("Wrike returned an invalid project link.");
    res.json({ projects: page.data.map(p => ({ id: p.id, title: p.title, permalink: p.permalink })), nextPageToken: page.nextPageToken ?? null });
  } catch (error) { res.status(error instanceof WrikeError ? error.status : 502).json({ error: safeWrikeError(error) }); }
});
export default router;
