import { Router } from "express";
import { db, projectWrikeLinksTable, wrikeConnectionsTable, wrikeSyncRunsTable, usersTable, projectsTable, projectMembersTable, membersTable } from "@workspace/db";
import { randomUUID, randomInt } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { SetProjectWrikeLinkBody, UpdateWrikeSettingsBody } from "@workspace/api-zod";
import { requireProjectAccess, requireProjectManage } from "../lib/access";
import { getWrikeFolder, safeWrikeError, personalWrikeConnection } from "../lib/wrike-client";
import { activeWrikeStates, enqueueWrikeSync } from "../lib/wrike-queue";
import { checkWrikeSyncOwner } from "../lib/wrike-policy";
import { WrikeError, validWrikeUrl, wrikeConfig } from "../lib/wrike-security";

const router = Router();
const unlocked = sql`NOT EXISTS (SELECT 1 FROM wrike_sync_runs j WHERE j.project_id = ${projectWrikeLinksTable.projectId} AND j.status IN ('queued','running','retry_wait'))`;
async function format(projectId: number) {
  const [row] = await db.select().from(projectWrikeLinksTable).where(eq(projectWrikeLinksTable.projectId, projectId));
  const [connection] = row?.connectionId ? await db.select().from(wrikeConnectionsTable).where(eq(wrikeConnectionsTable.id, row.connectionId)) : [];
  const [owner] = connection ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, connection.ownerUserId)) : [];
  let ready = false, reason: string | null = null;
  if (row?.connectionId) {
    try { await checkWrikeSyncOwner(row.connectionId, projectId); ready = wrikeConfig().configured; }
    catch (error) { reason = safeWrikeError(error); }
  }
  return {
    projectId, linked: !!row, remoteId: row?.remoteId ?? null, url: row?.url ?? null,
    remoteTitle: row?.remoteTitle ?? null, autoSync: row?.autoSync ?? false,
    updatedAt: row?.updatedAt ?? null, lastSyncedAt: row?.lastSyncedAt ?? null,
    lastError: reason ?? row?.lastError ?? null,
    syncOwnerUserId: connection?.ownerUserId ?? null, syncOwnerName: owner?.name ?? null,
    connectionReady: ready, nextSyncAt: row?.nextSyncAt ?? null,
    syncStatus: !wrikeConfig().configured ? "not_configured" : row && !ready ? "paused" : row?.syncStatus ?? "idle",
  };
}
router.use("/projects/:projectId/wrike-link", (req, res, next) => {
  const id = Number(req.params.projectId);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid project" }); return; }
  next();
});
router.get("/projects/:projectId/wrike-link", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!(await requireProjectAccess(req, res, projectId))) return;
  res.json(await format(projectId));
});
// Managers can import only from their own personal Wrike account, after
// explicitly reviewing the Cue audience. A shared service account is never used.
router.put("/projects/:projectId/wrike-link", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!(await requireProjectManage(req, res, projectId))) return;
  const parsed = SetProjectWrikeLinkBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.confirmVisibility || !validWrikeUrl(parsed.data.url)) { res.status(400).json({ error: "Review and confirm the Cue project audience before linking a Wrike location." }); return; }
  try {
    const connection = await personalWrikeConnection(req.authUser!.id);
    const folder = await getWrikeFolder(connection.id, parsed.data.remoteId);
    if (!validWrikeUrl(folder.permalink)) throw new WrikeError("Wrike returned an invalid project link.");
    const values = {
      projectId, remoteId: folder.id, url: folder.permalink, remoteTitle: folder.title,
      connectionId: connection.id, revision: randomUUID(),
      updatedBy: req.authUser!.id, updatedAt: new Date(), autoSync: false, syncStatus: "idle",
      lastError: null, lastSyncedAt: null, lastAttemptAt: null, lockToken: null, lockedUntil: null,
    };
    const rows = await db.transaction(async tx => {
      const [current] = await tx.select().from(wrikeConnectionsTable).where(eq(wrikeConnectionsTable.id, connection.id)).for("share");
      if (current?.generation !== connection.generation || current.revokedAt) throw new WrikeError("Your Wrike connection changed. Select the project again.", 409);
      return tx.insert(projectWrikeLinksTable).values(values)
      .onConflictDoUpdate({ target: projectWrikeLinksTable.projectId, set: values, setWhere: unlocked }).returning();
    });
    if (!rows.length) throw new WrikeError("Wait for the current sync to finish before changing the link.", 409);
    res.json(await format(projectId));
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === "23505") {
      res.status(409).json({ error: "That Wrike project is already linked to another Cue project." }); return;
    }
    res.status(error instanceof WrikeError ? error.status : 502).json({ error: safeWrikeError(error) });
  }
});
router.delete("/projects/:projectId/wrike-link", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!(await requireProjectManage(req, res, projectId))) return;
  const deleted = await db.delete(projectWrikeLinksTable).where(and(eq(projectWrikeLinksTable.projectId, projectId), unlocked)).returning();
  if (!deleted.length) {
    const [existing] = await db.select({ id: projectWrikeLinksTable.projectId }).from(projectWrikeLinksTable).where(eq(projectWrikeLinksTable.projectId, projectId));
    if (existing) { res.status(409).json({ error: "Wait for the current sync to finish before unlinking." }); return; }
  }
  res.sendStatus(204);
});
router.post("/projects/:projectId/wrike-sync", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) { res.status(400).json({ error: "Invalid project" }); return; }
  if (!(await requireProjectManage(req, res, projectId))) return;
  try { res.status(202).json(await enqueueWrikeSync(projectId, req.authUser!.id)); }
  catch (error) { res.status(error instanceof WrikeError ? error.status : 502).json({ error: safeWrikeError(error) }); }
});
router.get("/projects/:projectId/wrike-sync-runs", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) { res.status(400).json({ error: "Invalid project" }); return; }
  if (!(await requireProjectAccess(req, res, projectId))) return;
  const rows = await db.select().from(wrikeSyncRunsTable).where(eq(wrikeSyncRunsTable.projectId, projectId)).orderBy(desc(wrikeSyncRunsTable.startedAt)).limit(20);
  res.json(rows.map(({ actorId: _actor, leaseToken: _lease, leaseUntil: _until, connectionId: _conn, linkRevision: _rev, ...rest }) => rest));
});
router.patch("/projects/:projectId/wrike-settings", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) { res.status(400).json({ error: "Invalid project" }); return; }
  if (!(await requireProjectManage(req, res, projectId))) return;
  const parsed = UpdateWrikeSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "An autoSync boolean is required." }); return; }
  const state = await format(projectId);
  if (parsed.data.autoSync && !state.connectionReady) { res.status(409).json({ error: "Reconnect the designated sync owner or take over sync first." }); return; }
  const rows = await db.update(projectWrikeLinksTable).set({ autoSync: parsed.data.autoSync, nextSyncAt: new Date(Date.now() + randomInt(300_000)), updatedBy: req.authUser!.id, updatedAt: new Date() })
    .where(eq(projectWrikeLinksTable.projectId, projectId)).returning();
  if (!rows.length) { res.status(404).json({ error: "Link a Wrike project first." }); return; }
  res.json(await format(projectId));
});
router.get("/projects/:projectId/wrike-audience", async (req, res) => {
  const id = Number(req.params.projectId);
  if (!Number.isSafeInteger(id) || id <= 0) { res.sendStatus(400); return; }
  if (!(await requireProjectManage(req, res, id))) return;
  const members = await db.select({ id: membersTable.id, name: membersTable.name }).from(projectMembersTable)
    .innerJoin(membersTable, eq(membersTable.id, projectMembersTable.memberId)).where(eq(projectMembersTable.projectId, id));
  const [owner] = await db.select({ id: usersTable.id, name: usersTable.name }).from(projectsTable)
    .innerJoin(usersTable, eq(usersTable.id, projectsTable.ownerUserId)).where(eq(projectsTable.id, id));
  res.json({ members: [...members, ...(owner ? [{ id: -owner.id, name: `${owner.name ?? "Project owner"} (owner)` }] : [])],
    note: "Imported data is visible to this Cue project's owner, listed members, and all Cue administrators. Existing share links may expose project or task content to their recipients. Wrike permissions are not copied. Review the Team and sharing settings before confirming." });
});
router.post("/projects/:projectId/wrike-takeover", async (req, res) => {
  const id = Number(req.params.projectId);
  if (!Number.isSafeInteger(id) || id <= 0) { res.sendStatus(400); return; }
  if (!(await requireProjectManage(req, res, id))) return;
  if (req.body?.confirmVisibility !== true) { res.status(400).json({ error: "Confirm the destination project's audience first." }); return; }
  try {
    const [link] = await db.select().from(projectWrikeLinksTable).where(eq(projectWrikeLinksTable.projectId, id));
    if (!link) throw new WrikeError("Link a Wrike project first.", 404);
    const connection = await personalWrikeConnection(req.authUser!.id);
    await getWrikeFolder(connection.id, link.remoteId);
    await db.transaction(async tx => {
      const [current] = await tx.select().from(wrikeConnectionsTable).where(eq(wrikeConnectionsTable.id, connection.id)).for("share");
      if (current?.generation !== connection.generation || current.revokedAt) throw new WrikeError("Your connection changed. Retry takeover.", 409);
      const rows = await tx.update(projectWrikeLinksTable).set({
        connectionId: connection.id, revision: randomUUID(), autoSync: false, syncStatus: "idle",
        lastError: null, updatedBy: req.authUser!.id, updatedAt: new Date(),
      }).where(and(eq(projectWrikeLinksTable.projectId, id), eq(projectWrikeLinksTable.revision, link.revision))).returning();
      if (!rows.length) throw new WrikeError("The project link changed. Review it and retry takeover.", 409);
      // A departed owner's stalled queue must not block an authorized takeover.
      // Running workers recheck the revision and job lease before committing.
      await tx.update(wrikeSyncRunsTable).set({
        status: "cancelled", error: "Sync ownership transferred. Queue a new import.",
        finishedAt: new Date(), leaseToken: null, leaseUntil: null,
      }).where(and(eq(wrikeSyncRunsTable.projectId, id), inArray(wrikeSyncRunsTable.status, activeWrikeStates)));
    });
    res.json(await format(id));
  } catch (error) { res.status(error instanceof WrikeError ? error.status : 502).json({ error: safeWrikeError(error) }); }
});
export default router;
