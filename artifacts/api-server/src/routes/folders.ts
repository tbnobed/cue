import { Router } from "express";
import { db } from "@workspace/db";
import { documentFoldersTable, documentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/folders", async (req, res): Promise<void> => {
  const { projectId, global: globalOnly, taskId } = req.query;
  let folders = await db.select().from(documentFoldersTable).orderBy(documentFoldersTable.name);
  if (taskId !== undefined) folders = folders.filter(f => f.taskId === parseInt(String(taskId)));
  else if (globalOnly === "true") folders = folders.filter(f => f.projectId === null && f.taskId === null);
  else if (projectId !== undefined) folders = folders.filter(f => f.projectId === parseInt(String(projectId)) && f.taskId === null);
  res.json(folders.map(fmt));
});

router.post("/folders", async (req, res): Promise<void> => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const projectId = req.body?.projectId != null ? Number(req.body.projectId) : null;
  const taskId    = req.body?.taskId    != null ? Number(req.body.taskId)    : null;
  const parentId  = req.body?.parentId  != null ? Number(req.body.parentId)  : null;
  if (parentId != null) {
    const [parent] = await db.select().from(documentFoldersTable).where(eq(documentFoldersTable.id, parentId));
    if (!parent) { res.status(400).json({ error: "Parent folder not found" }); return; }
    if ((parent.projectId ?? null) !== (projectId ?? null) || (parent.taskId ?? null) !== (taskId ?? null)) {
      res.status(400).json({ error: "Parent folder belongs to a different scope" });
      return;
    }
  }
  const [folder] = await db.insert(documentFoldersTable).values({
    projectId: projectId ?? undefined,
    taskId: taskId ?? undefined,
    parentId: parentId ?? undefined,
    name,
  }).returning();
  res.status(201).json(fmt(folder));
});

router.patch("/folders/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(documentFoldersTable).where(eq(documentFoldersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (req.body?.name != null) {
    const n = String(req.body.name).trim();
    if (!n) { res.status(400).json({ error: "name required" }); return; }
    update.name = n;
  }
  if (req.body?.parentId !== undefined) {
    const newParentId = req.body.parentId == null ? null : Number(req.body.parentId);
    if (newParentId != null) {
      if (newParentId === id) { res.status(400).json({ error: "Folder cannot be its own parent" }); return; }
      const [parent] = await db.select().from(documentFoldersTable).where(eq(documentFoldersTable.id, newParentId));
      if (!parent) { res.status(400).json({ error: "Parent folder not found" }); return; }
      if ((parent.projectId ?? null) !== (existing.projectId ?? null) || (parent.taskId ?? null) !== (existing.taskId ?? null)) {
        res.status(400).json({ error: "Parent folder belongs to a different scope" });
        return;
      }
      // Cycle prevention: walk up parent chain, ensure we don't hit `id`
      let cursor: number | null = parent.parentId ?? null;
      const seen = new Set<number>([newParentId]);
      while (cursor != null) {
        if (cursor === id) { res.status(400).json({ error: "Cannot move folder into its own descendant" }); return; }
        if (seen.has(cursor)) break; // safety against malformed loop
        seen.add(cursor);
        const [next] = await db.select().from(documentFoldersTable).where(eq(documentFoldersTable.id, cursor));
        cursor = next?.parentId ?? null;
      }
    }
    update.parentId = newParentId;
  }
  const [folder] = await db.update(documentFoldersTable)
    .set(update)
    .where(eq(documentFoldersTable.id, id))
    .returning();
  if (!folder) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(folder));
});

router.delete("/folders/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [child] = await db.select().from(documentFoldersTable).where(eq(documentFoldersTable.parentId, id)).limit(1);
  if (child) { res.status(409).json({ error: "Folder still has subfolders" }); return; }
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.folderId, id)).limit(1);
  if (doc) { res.status(409).json({ error: "Folder still has documents" }); return; }
  await db.delete(documentFoldersTable).where(eq(documentFoldersTable.id, id));
  res.status(204).send();
});

function fmt(f: typeof documentFoldersTable.$inferSelect) {
  return {
    id: f.id,
    projectId: f.projectId ?? null,
    taskId: f.taskId ?? null,
    parentId: f.parentId ?? null,
    name: f.name,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

export default router;
