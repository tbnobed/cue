import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import fs from "node:fs/promises";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db, releasesTable, releaseEventsTable } from "@workspace/db";
import { CreateProjectReleaseBody, UpdateReleaseBody } from "@workspace/api-zod";
import { requireProjectAccess, requireProjectManage } from "../lib/access";
import { hashRelease, releasePath, storeRelease, removeUncommittedRelease } from "../lib/release-storage";

const router = Router();
// Calendar dates must remain strings; the shared codegen otherwise coerces
// format:date into Date and can normalize impossible dates before validation.
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const createInput = CreateProjectReleaseBody.extend({ productionDate: calendarDate });
const updateInput = UpdateReleaseBody.extend({ productionDate: calendarDate });
const uploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 1 } }).single("file");
function idValue(value: unknown) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function format(row: typeof releasesTable.$inferSelect) {
  const { storageKey: _key, createdBy: _creator, archivedBy: _archiver, fileSize: _size, ...data } = row;
  return data;
}
function validInput(data: { guestName: string; title: string; templateVersion: string; productionDate?: string | null }) {
  if (![data.guestName, data.title, data.templateVersion].every(s => s.trim())) return false;
  const day = data.productionDate;
  return !day || (/^\d{4}-\d{2}-\d{2}$/.test(day) && !isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day);
}
router.get("/projects/:projectId/releases", async (req, res) => {
  const projectId = idValue(req.params.projectId);
  if (!projectId) { res.status(400).json({ error: "Invalid project" }); return; }
  if (!(await requireProjectAccess(req, res, projectId))) return;
  res.json((await db.select().from(releasesTable).where(eq(releasesTable.projectId, projectId)).orderBy(desc(releasesTable.createdAt))).map(format));
});
router.post("/projects/:projectId/releases", async (req, res) => {
  const projectId = idValue(req.params.projectId);
  if (!projectId) { res.status(400).json({ error: "Invalid project" }); return; }
  if (!(await requireProjectManage(req, res, projectId))) return;
  const parsed = createInput.safeParse(req.body);
  if (!parsed.success || !validInput(parsed.data)) { res.status(400).json({ error: "Valid guest, email, title, template version and production date are required." }); return; }
  const row = await db.transaction(async tx => {
    const [created] = await tx.insert(releasesTable).values({ ...parsed.data, projectId, createdBy: req.authUser!.id }).returning();
    await tx.insert(releaseEventsTable).values({ releaseId: created.id, actorId: req.authUser!.id, action: `created:${created.status}` });
    return created;
  });
  res.status(201).json(format(row));
});
router.patch("/releases/:id", async (req, res) => {
  const id = idValue(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid release" }); return; }
  const [existing] = await db.select().from(releasesTable).where(eq(releasesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Release not found" }); return; }
  if (!(await requireProjectManage(req, res, existing.projectId))) return;
  const parsed = updateInput.safeParse(req.body);
  if (!parsed.success || !validInput(parsed.data)) { res.status(400).json({ error: "Invalid release details" }); return; }
  const row = await db.transaction(async tx => {
    const [locked] = await tx.select().from(releasesTable).where(eq(releasesTable.id, id)).for("update");
    if (locked.status === "archived") return null;
    const [updated] = await tx.update(releasesTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(releasesTable.id, id)).returning();
    await tx.insert(releaseEventsTable).values({ releaseId: id, actorId: req.authUser!.id, action: `updated:${locked.status}->${updated.status}` });
    return updated;
  });
  if (!row) { res.status(409).json({ error: "Archived releases are locked and cannot be changed." }); return; }
  res.json(format(row));
});

// Authorize before accepting file bytes, not after multer has buffered them.
async function authorizeArchive(req: Request, res: Response, next: NextFunction) {
  const id = idValue(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid release" }); return; }
  const [row] = await db.select().from(releasesTable).where(eq(releasesTable.id, id));
  if (!row) { res.status(404).json({ error: "Release not found" }); return; }
  if (!(await requireProjectManage(req, res, row.projectId))) return;
  if (row.status !== "signed") { res.status(409).json({ error: "Only signed releases can be archived; existing archives cannot be replaced." }); return; }
  next();
}
router.post("/releases/:id/archive", authorizeArchive, (req, res, next) => {
  uploader(req, res, error => {
    if (error) { res.status(400).json({ error: "Upload one PDF no larger than 20 MB." }); return; }
    next();
  });
}, async (req, res) => {
  const id = Number(req.params.id);
  const file = req.file;
  if (req.body.confirmed !== "true" || !file || file.buffer.subarray(0, 5).toString() !== "%PDF-" ||
      !file.buffer.subarray(Math.max(0, file.size - 2048)).includes(Buffer.from("%%EOF"))) {
    res.status(400).json({ error: "A PDF and confirmation of all required signatures are required." }); return;
  }
  let stored: Awaited<ReturnType<typeof storeRelease>> | undefined;
  try {
    stored = await storeRelease(file.buffer);
    const archive = stored;
    const row = await db.transaction(async tx => {
      const [locked] = await tx.select().from(releasesTable).where(eq(releasesTable.id, id)).for("update");
      if (locked.status !== "signed") return null;
      const clean = (s: string) => s.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 70);
      const fileName = `${locked.productionDate ?? new Date().toISOString().slice(0, 10)}_project-${locked.projectId}_${clean(locked.guestName)}_Release-${id}.pdf`;
      const [updated] = await tx.update(releasesTable).set({
        status: "archived", storageKey: archive.key, sha256: archive.sha256, fileSize: file.size, fileName,
        archivedAt: new Date(), archivedBy: req.authUser!.id, updatedAt: new Date(),
      }).where(eq(releasesTable.id, id)).returning();
      await tx.insert(releaseEventsTable).values({ releaseId: id, actorId: req.authUser!.id, action: "archived:producer-confirmed-signatures" });
      return updated;
    });
    if (!row) {
      await removeUncommittedRelease(stored.key);
      res.status(409).json({ error: "Release changed during upload. Refresh before retrying." }); return;
    }
    res.json(format(row));
  } catch (error) {
    if (stored) await removeUncommittedRelease(stored.key);
    req.log.error({ releaseId: id, err: error }, "Release archive failed");
    res.status(500).json({ error: "Filing failed. The release has not been marked archived. Retry or contact your administrator." });
  }
});
router.get("/releases/:id/file", async (req, res) => {
  const id = idValue(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid release" }); return; }
  const [row] = await db.select().from(releasesTable).where(eq(releasesTable.id, id));
  if (!row) { res.status(404).json({ error: "Release not found" }); return; }
  if (!(await requireProjectAccess(req, res, row.projectId))) return;
  if (!row.storageKey || row.status !== "archived") { res.status(404).json({ error: "No archived file" }); return; }
  try {
    const data = await fs.readFile(releasePath(row.storageKey));
    if (hashRelease(data) !== row.sha256) throw new Error("Archive checksum mismatch");
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${row.fileName}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }).send(data);
  } catch (error) {
    req.log.error({ releaseId: id, err: error }, "Archived release unavailable or damaged");
    res.status(503).json({ error: "Archived file failed verification. Contact your administrator to restore the backup." });
  }
});
export default router;
