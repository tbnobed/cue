import { Router } from "express";
import { db } from "@workspace/db";
import { documentFoldersTable, documentsTable, tasksTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireProjectAccess, visibleProjectIdsCached } from "../lib/access.js";

const router = Router();

router.get("/folders", async (req, res): Promise<void> => {
  const { projectId, global: globalOnly, taskId, includeTasks } = req.query;
  // Gate: any specific project/task query must be visible to the caller.
  if (projectId !== undefined) {
    const pid = parseInt(String(projectId), 10);
    if (Number.isFinite(pid) && !(await requireProjectAccess(req, res, pid))) return;
  }
  if (taskId !== undefined) {
    const tid = parseInt(String(taskId), 10);
    if (Number.isFinite(tid)) {
      const [t] = await db.select({ projectId: tasksTable.projectId }).from(tasksTable).where(eq(tasksTable.id, tid)).limit(1);
      if (!t) { res.status(404).json({ error: "Not found" }); return; }
      if (!(await requireProjectAccess(req, res, t.projectId))) return;
    }
  }
  // Global listing: filter project-scoped folders to visible projects.
  const visible = await visibleProjectIdsCached(req);
  // If both projectId and taskId are supplied, require the task to belong to the project.
  if (taskId !== undefined && projectId !== undefined) {
    const tid = parseInt(String(taskId));
    const pid = parseInt(String(projectId));
    const [t] = await db.select({ projectId: tasksTable.projectId }).from(tasksTable).where(eq(tasksTable.id, tid));
    if (!t || t.projectId !== pid) { res.status(400).json({ error: "Task does not belong to the given project" }); return; }
  }
  let folders = await db.select().from(documentFoldersTable).orderBy(documentFoldersTable.name);
  // Strip folders whose project the caller can't see (defense in depth on
  // top of the explicit scope filters below). Task-scoped folders carry
  // projectId=null + taskId!=null, so they'd otherwise sneak through — we
  // resolve them to their task's project and apply the same filter.
  if (visible !== "all") {
    const allowed = new Set(visible);
    const taskScoped = folders.filter(f => f.projectId == null && f.taskId != null);
    let taskProjectMap: Map<number, number> = new Map();
    if (taskScoped.length > 0) {
      const ids = Array.from(new Set(taskScoped.map(f => f.taskId!).filter(Boolean)));
      if (ids.length > 0) {
        const ts = await db.select({ id: tasksTable.id, projectId: tasksTable.projectId })
          .from(tasksTable).where(inArray(tasksTable.id, ids));
        taskProjectMap = new Map(ts.map(t => [t.id, t.projectId]));
      }
    }
    folders = folders.filter(f => {
      if (f.projectId != null) return allowed.has(f.projectId);
      if (f.taskId != null) {
        const pid = taskProjectMap.get(f.taskId);
        return pid != null && allowed.has(pid);
      }
      // Global folder (both null) — admin-only.
      return req.authUser!.isAdmin;
    });
  }
  if (taskId !== undefined) folders = folders.filter(f => f.taskId === parseInt(String(taskId)));
  else if (globalOnly === "true") folders = folders.filter(f => f.projectId === null && f.taskId === null);
  else if (projectId !== undefined) {
    const pid = parseInt(String(projectId));
    if (includeTasks === "true") {
      const projectTasks = await db.select({ id: tasksTable.id })
        .from(tasksTable).where(eq(tasksTable.projectId, pid));
      const taskIds = new Set(projectTasks.map(t => t.id));
      folders = folders.filter(f =>
        (f.projectId === pid && f.taskId === null) ||
        (f.taskId !== null && taskIds.has(f.taskId))
      );
    } else {
      folders = folders.filter(f => f.projectId === pid && f.taskId === null);
    }
  }
  res.json(folders.map(fmt));
});

router.post("/folders", async (req, res): Promise<void> => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  let projectId  = req.body?.projectId != null ? Number(req.body.projectId) : null;
  const taskId    = req.body?.taskId    != null ? Number(req.body.taskId)    : null;
  const parentId  = req.body?.parentId  != null ? Number(req.body.parentId)  : null;
  // If taskId is supplied, the task must exist; if projectId is also supplied they must match.
  if (taskId != null) {
    const [t] = await db.select({ projectId: tasksTable.projectId }).from(tasksTable).where(eq(tasksTable.id, taskId));
    if (!t) { res.status(400).json({ error: "Task not found" }); return; }
    if (projectId != null && t.projectId !== projectId) {
      res.status(400).json({ error: "Task does not belong to the given project" }); return;
    }
    if (!(await requireProjectAccess(req, res, t.projectId))) return;
    projectId = null; // task-attached folders are scoped via taskId; projectId stays NULL.
  } else if (projectId != null) {
    if (!(await requireProjectAccess(req, res, projectId))) return;
  }
  // Global folder (projectId & taskId both null) — only admins can create.
  if (projectId == null && taskId == null && !req.authUser!.isAdmin) {
    res.status(403).json({ error: "Only an admin can create global folders." });
    return;
  }
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
  const folderProject = existing.projectId ?? (existing.taskId
    ? (await db.select({ p: tasksTable.projectId }).from(tasksTable).where(eq(tasksTable.id, existing.taskId)).limit(1))[0]?.p ?? null
    : null);
  if (folderProject != null) {
    if (!(await requireProjectAccess(req, res, folderProject))) return;
  } else if (!req.authUser!.isAdmin) {
    // global folder — admin-only
    res.status(403).json({ error: "Only an admin can modify global folders." });
    return;
  }

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
  const [existing] = await db.select().from(documentFoldersTable).where(eq(documentFoldersTable.id, id)).limit(1);
  if (!existing) { res.status(204).send(); return; }
  const folderProject = existing.projectId ?? (existing.taskId
    ? (await db.select({ p: tasksTable.projectId }).from(tasksTable).where(eq(tasksTable.id, existing.taskId)).limit(1))[0]?.p ?? null
    : null);
  if (folderProject != null) {
    if (!(await requireProjectAccess(req, res, folderProject))) return;
  } else if (!req.authUser!.isAdmin) {
    res.status(403).json({ error: "Only an admin can delete global folders." });
    return;
  }
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
