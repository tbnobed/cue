import { Router } from "express";
import { db, projectWrikeLinksTable, wrikeConnectionsTable, wrikeSyncRunsTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { SetProjectWrikeLinkBody, UpdateWrikeSettingsBody } from "@workspace/api-zod";
import { requireProjectAccess, requireProjectManage } from "../lib/access";
import { requireAdmin } from "../middlewares/require-auth";
import { getWrikeFolder, safeWrikeError } from "../lib/wrike-client";
import { syncWrikeProject } from "../lib/wrike-sync";
import { WrikeError, validWrikeUrl, wrikeConfig } from "../lib/wrike-security";

const router = Router();
const unlocked = sql`(${projectWrikeLinksTable.lockedUntil} IS NULL OR ${projectWrikeLinksTable.lockedUntil} < now())`;
async function format(projectId: number) {
  const [row] = await db.select().from(projectWrikeLinksTable).where(eq(projectWrikeLinksTable.projectId, projectId));
  const [connection] = await db.select({ id: wrikeConnectionsTable.id }).from(wrikeConnectionsTable).where(eq(wrikeConnectionsTable.id, 1));
  const expired = row?.syncStatus === "running" && (!row.lockedUntil || row.lockedUntil.getTime() < Date.now());
  return {
    projectId, linked: !!row, remoteId: row?.remoteId ?? null, url: row?.url ?? null,
    remoteTitle: row?.remoteTitle ?? null, autoSync: row?.autoSync ?? false,
    updatedAt: row?.updatedAt ?? null, lastSyncedAt: row?.lastSyncedAt ?? null,
    lastError: expired ? "The previous sync was interrupted. Retry the import." : row?.lastError ?? null,
    syncStatus: !wrikeConfig().configured || !connection ? "not_configured" : expired ? "error" : row?.syncStatus ?? "idle",
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
// Organization credentials may see more Wrike projects than ordinary Cue
// users. Only admins may choose which data enters a project's access boundary.
router.put("/projects/:projectId/wrike-link", requireAdmin, async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!(await requireProjectManage(req, res, projectId))) return;
  const parsed = SetProjectWrikeLinkBody.safeParse(req.body);
  if (!parsed.success || !validWrikeUrl(parsed.data.url)) { res.status(400).json({ error: "A valid Wrike project API ID and HTTPS Wrike URL are required." }); return; }
  try {
    const folder = await getWrikeFolder(parsed.data.remoteId);
    if (!validWrikeUrl(folder.permalink)) throw new WrikeError("Wrike returned an invalid project link.");
    const values = {
      projectId, remoteId: folder.id, url: folder.permalink, remoteTitle: folder.title,
      updatedBy: req.authUser!.id, updatedAt: new Date(), autoSync: false, syncStatus: "idle",
      lastError: null, lastSyncedAt: null, lastAttemptAt: null, lockToken: null, lockedUntil: null,
    };
    const rows = await db.insert(projectWrikeLinksTable).values(values)
      .onConflictDoUpdate({ target: projectWrikeLinksTable.projectId, set: values, setWhere: unlocked }).returning();
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
  try { res.json(await syncWrikeProject(projectId, req.authUser!.id)); }
  catch (error) { res.status(error instanceof WrikeError ? error.status : 502).json({ error: safeWrikeError(error) }); }
});
router.get("/projects/:projectId/wrike-sync-runs", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) { res.status(400).json({ error: "Invalid project" }); return; }
  if (!(await requireProjectAccess(req, res, projectId))) return;
  const rows = await db.select().from(wrikeSyncRunsTable).where(eq(wrikeSyncRunsTable.projectId, projectId)).orderBy(desc(wrikeSyncRunsTable.startedAt)).limit(20);
  res.json(rows.map(({ actorId: _actor, ...rest }) => rest));
});
router.patch("/projects/:projectId/wrike-settings", requireAdmin, async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) { res.status(400).json({ error: "Invalid project" }); return; }
  if (!(await requireProjectManage(req, res, projectId))) return;
  const parsed = UpdateWrikeSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "An autoSync boolean is required." }); return; }
  const [connection] = await db.select({ id: wrikeConnectionsTable.id }).from(wrikeConnectionsTable).where(eq(wrikeConnectionsTable.id, 1));
  if (parsed.data.autoSync && (!connection || !wrikeConfig().configured)) { res.status(409).json({ error: "Connect Wrike before enabling automatic imports." }); return; }
  const rows = await db.update(projectWrikeLinksTable).set({ autoSync: parsed.data.autoSync, updatedBy: req.authUser!.id, updatedAt: new Date() })
    .where(eq(projectWrikeLinksTable.projectId, projectId)).returning();
  if (!rows.length) { res.status(404).json({ error: "Link a Wrike project first." }); return; }
  res.json(await format(projectId));
});
export default router;
