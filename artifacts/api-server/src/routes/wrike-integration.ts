import { Router } from "express";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { db, wrikeConnectionsTable as connections, projectWrikeLinksTable as links, wrikeSyncRunsTable as jobs, usersTable, projectsTable } from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/require-auth";
import { wrikeDiscoveryParams } from "../lib/wrike-discovery";
import { exchangeWrikeToken, folderPageSchema, personalWrikeConnection, safeWrikeError, wrikeGet } from "../lib/wrike-client";
import { activeWrikeStates } from "../lib/wrike-queue";
import { requireWrikeConfig, sealWrikeToken, validWrikeHost, validWrikeUrl, wrikeConfig, WrikeError } from "../lib/wrike-security";

const router = Router();
router.get("/integrations/wrike", async (req, res) => {
  const [row] = await db.select({
    id: connections.id, host: connections.host, connectedAt: connections.connectedAt,
    lastError: connections.lastError, revokedAt: connections.revokedAt,
  }).from(connections).where(eq(connections.ownerUserId, req.authUser!.id));
  const [{ count }] = row ? await db.select({ count: sql<number>`count(*)::int` }).from(links).where(eq(links.connectionId, row.id)) : [{ count: 0 }];
  res.json({
    ...wrikeConfig(), connected: !!row && !row.revokedAt, userId: req.authUser!.id, linkedProjectCount: count,
    host: row?.host ?? null, connectedAt: row?.connectedAt ?? null, lastError: row?.lastError ?? null,
  });
});
router.post("/integrations/wrike/authorize", async (req, res) => {
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
router.get("/integrations/wrike/callback", async (req, res) => {
  const pending = req.session.wrikeOAuth;
  delete req.session.wrikeOAuth;
  await new Promise<void>((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!pending || pending.userId !== req.authUser!.id || Date.now() - pending.createdAt > 10 * 60_000 ||
      !/^[a-f0-9]{64}$/.test(state) || !timingSafeEqual(Buffer.from(state), Buffer.from(pending.state))) {
    res.redirect("/integrations?wrike=invalid_state"); return;
  }
  if (req.query.error || typeof req.query.code !== "string") { res.redirect("/integrations?wrike=denied"); return; }
  try {
    const config = requireWrikeConfig();
    const token = await exchangeWrikeToken({ grant_type: "authorization_code", code: req.query.code, redirect_uri: config.redirectUri! });
    if (!token.host) throw new WrikeError("Wrike did not provide its data-center host.");
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(61976, ${req.authUser!.id})`);
      const values = {
        ownerUserId: req.authUser!.id, generation: randomUUID(), host: validWrikeHost(token.host!),
        accessToken: sealWrikeToken(token.access_token), refreshToken: sealWrikeToken(token.refresh_token),
        expiresAt: new Date(Date.now() + token.expires_in * 1000), connectedBy: req.authUser!.id,
        connectedAt: new Date(), lastError: null, revokedAt: null, cooldownUntil: null, nextRequestAt: null,
      };
      const [connection] = await tx.insert(connections).values(values).onConflictDoUpdate({ target: connections.ownerUserId, set: values }).returning({ id: connections.id });
      // No other user's tokens, links or jobs are touched.
      await tx.update(links).set({
        autoSync: false, syncStatus: "paused", revision: randomUUID(),
        lastError: "Wrike reconnected. Review this connection's project links before enabling automatic imports.",
      }).where(eq(links.connectionId, connection.id));
      await tx.update(jobs).set({ status: "cancelled", error: "Connection changed; queue a new import.", finishedAt: new Date(), leaseToken: null, leaseUntil: null })
        .where(and(eq(jobs.connectionId, connection.id), inArray(jobs.status, activeWrikeStates)));
    });
    res.redirect("/integrations?wrike=connected");
  } catch (error) {
    req.log.warn({ message: safeWrikeError(error) }, "Wrike authorization failed");
    res.redirect("/integrations?wrike=failed");
  }
});
router.delete("/integrations/wrike", async (req, res) => {
  await db.transaction(async tx => {
    // Keep a credential-free tombstone so projects retain sync-owner identity.
    const [connection] = await tx.update(connections).set({
      accessToken: "", refreshToken: "", generation: randomUUID(), revokedAt: new Date(), lastError: "Disconnected by its owner.",
    }).where(eq(connections.ownerUserId, req.authUser!.id)).returning({ id: connections.id });
    if (!connection) return;
    await tx.update(links).set({ autoSync: false, syncStatus: "paused", revision: randomUUID(), lastError: "Sync owner disconnected Wrike. Reconnect or take over sync." })
      .where(eq(links.connectionId, connection.id));
    await tx.update(jobs).set({ status: "cancelled", error: "Connection disconnected.", finishedAt: new Date(), leaseToken: null, leaseUntil: null })
      .where(and(eq(jobs.connectionId, connection.id), inArray(jobs.status, activeWrikeStates)));
  });
  res.sendStatus(204);
});
router.get("/integrations/wrike/projects", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const token = typeof req.query.nextPageToken === "string" ? req.query.nextPageToken : "";
  if (search.length > 200 || token.length > 4000) { res.status(400).json({ error: "Search or page token is too long." }); return; }
  try {
    const connection = await personalWrikeConnection(req.authUser!.id);
    const page = await wrikeGet(connection.id, `/folders?${wrikeDiscoveryParams(search, token)}`, folderPageSchema);
    if (page.data.some(p => !validWrikeUrl(p.permalink))) throw new WrikeError("Wrike returned an invalid project link.");
    res.json({ projects: page.data.map(p => ({ id: p.id, title: p.title, permalink: p.permalink })), nextPageToken: page.nextPageToken ?? null });
  } catch (error) { res.status(error instanceof WrikeError ? error.status : 502).json({ error: safeWrikeError(error) }); }
});
router.get("/admin/integrations/wrike/health", requireAdmin, async (_req, res) => {
  const health = await db.select({
    userId: connections.ownerUserId, userName: sql<string>`coalesce(${usersTable.name}, 'Cue user')`,
    active: sql<boolean>`${usersTable.isActive} AND ${connections.revokedAt} IS NULL`,
    connectedAt: connections.connectedAt, lastError: connections.lastError,
    linkedProjects: sql<number>`(SELECT count(*)::int FROM project_wrike_links l WHERE l.connection_id = ${connections.id})`,
  }).from(connections).innerJoin(usersTable, eq(usersTable.id, connections.ownerUserId)).orderBy(usersTable.name);
  const failures = await db.select({ run: jobs, projectName: projectsTable.name }).from(jobs)
    .innerJoin(projectsTable, eq(projectsTable.id, jobs.projectId)).where(inArray(jobs.status, ["error", "retry_wait"]))
    .orderBy(desc(jobs.startedAt)).limit(50);
  const counts = await db.select({ status: jobs.status, count: sql<number>`count(*)::int` }).from(jobs)
    .where(inArray(jobs.status, activeWrikeStates)).groupBy(jobs.status);
  res.json({
    connections: health, failures: failures.map(({ run, projectName }) => ({
      id: run.id, projectId: run.projectId, projectName, status: run.status, created: run.created, updated: run.updated,
      skipped: run.skipped, startedAt: run.startedAt, finishedAt: run.finishedAt, error: run.error, attempts: run.attempts, availableAt: run.availableAt,
    })),
    queued: counts.filter(c => c.status !== "running").reduce((n, c) => n + c.count, 0),
    running: counts.find(c => c.status === "running")?.count ?? 0,
  });
});
export default router;
