import { Router } from "express";
import { db, projectWrikeLinksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { SetProjectWrikeLinkBody } from "@workspace/api-zod";
import { requireProjectAccess, requireProjectManage } from "../lib/access";

const router = Router();
const format = (projectId: number, row?: typeof projectWrikeLinksTable.$inferSelect) => ({
  projectId, linked: !!row, remoteId: row?.remoteId ?? null, url: row?.url ?? null,
  updatedAt: row?.updatedAt ?? null, syncStatus: "not_configured",
});
router.get("/projects/:projectId/wrike-link", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) { res.status(400).json({ error: "Invalid project" }); return; }
  if (!(await requireProjectAccess(req, res, projectId))) return;
  const [row] = await db.select().from(projectWrikeLinksTable).where(eq(projectWrikeLinksTable.projectId, projectId));
  res.json(format(projectId, row));
});
router.put("/projects/:projectId/wrike-link", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) { res.status(400).json({ error: "Invalid project" }); return; }
  if (!(await requireProjectManage(req, res, projectId))) return;
  const parsed = SetProjectWrikeLinkBody.safeParse(req.body);
  if (!parsed.success || !/^[a-zA-Z0-9_-]+$/.test(parsed.data.remoteId)) { res.status(400).json({ error: "A valid Wrike project/folder API ID and URL are required." }); return; }
  let url: URL;
  try { url = new URL(parsed.data.url); } catch { res.status(400).json({ error: "Invalid Wrike URL" }); return; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !(url.hostname === "wrike.com" || url.hostname.endsWith(".wrike.com"))) {
    res.status(400).json({ error: "Use an HTTPS link on wrike.com." }); return;
  }
  try {
    const values = { ...parsed.data, projectId, updatedBy: req.authUser!.id, updatedAt: new Date() };
    const [row] = await db.insert(projectWrikeLinksTable).values(values)
      .onConflictDoUpdate({ target: projectWrikeLinksTable.projectId, set: values }).returning();
    res.json(format(projectId, row));
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === "23505") {
      res.status(409).json({ error: "That Wrike project is already linked to another local project." }); return;
    }
    throw error;
  }
});
router.delete("/projects/:projectId/wrike-link", async (req, res) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) { res.status(400).json({ error: "Invalid project" }); return; }
  if (!(await requireProjectManage(req, res, projectId))) return;
  await db.delete(projectWrikeLinksTable).where(eq(projectWrikeLinksTable.projectId, projectId));
  res.sendStatus(204);
});
export default router;
