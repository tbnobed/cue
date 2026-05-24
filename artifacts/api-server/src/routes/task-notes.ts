import { Router } from "express";
import { db } from "@workspace/db";
import { taskNotesTable, tasksTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { getSessionAuthor } from "../lib/session-author.js";
import { requireProjectAccess } from "../lib/access.js";

const router = Router();

router.get("/tasks/:taskId/notes", async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.taskId ?? "", 10);
  if (!Number.isFinite(taskId)) { res.status(400).json({ error: "Invalid task id" }); return; }
  const [task] = await db.select({ projectId: tasksTable.projectId }).from(tasksTable).where(eq(tasksTable.id, taskId)).limit(1);
  if (!task) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await requireProjectAccess(req, res, task.projectId))) return;
  const rows = await db.select().from(taskNotesTable)
    .where(eq(taskNotesTable.taskId, taskId))
    .orderBy(asc(taskNotesTable.createdAt));
  res.json(rows.map(fmt));
});

router.post("/tasks/:taskId/notes", async (req, res): Promise<void> => {
  const taskId = parseInt(req.params.taskId ?? "", 10);
  if (!Number.isFinite(taskId)) { res.status(400).json({ error: "Invalid task id" }); return; }
  const body = String(req.body?.body ?? "").trim();
  if (!body) { res.status(400).json({ error: "body required" }); return; }
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  if (!(await requireProjectAccess(req, res, task.projectId))) return;
  // Authorship is derived from the session — client-supplied authorId/authorName is ignored
  // to prevent spoofing the audit trail.
  const author = await getSessionAuthor(req);
  const [note] = await db.insert(taskNotesTable).values({
    taskId,
    body,
    authorId: author.id,
    authorName: author.name ?? undefined,
  }).returning();
  res.status(201).json(fmt(note));
});

function fmt(n: typeof taskNotesTable.$inferSelect) {
  return {
    id: n.id,
    taskId: n.taskId,
    authorId: n.authorId ?? null,
    authorName: n.authorName ?? null,
    body: n.body,
    statusBefore: n.statusBefore ?? null,
    statusAfter: n.statusAfter ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

export default router;
