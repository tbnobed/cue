import { Router } from "express";
import { db } from "@workspace/db";
import { commentsTable, tasksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ListCommentsParams,
  CreateCommentParams,
  CreateCommentBody,
  DeleteCommentParams,
} from "@workspace/api-zod";
import { requireProjectAccess } from "../lib/access.js";

const router = Router();

async function projectIdForTask(taskId: number): Promise<number | null> {
  const [t] = await db.select({ projectId: tasksTable.projectId }).from(tasksTable).where(eq(tasksTable.id, taskId)).limit(1);
  return t?.projectId ?? null;
}

router.get("/tasks/:taskId/comments", async (req, res): Promise<void> => {
  const { taskId } = ListCommentsParams.parse(req.params);
  const pid = await projectIdForTask(taskId);
  if (pid === null) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await requireProjectAccess(req, res, pid))) return;
  const comments = await db.select().from(commentsTable).where(eq(commentsTable.taskId, taskId)).orderBy(commentsTable.createdAt);
  res.json(comments.map(fmt));
});

router.post("/tasks/:taskId/comments", async (req, res): Promise<void> => {
  const { taskId } = CreateCommentParams.parse(req.params);
  const parsed = CreateCommentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const pid = await projectIdForTask(taskId);
  if (pid === null) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await requireProjectAccess(req, res, pid))) return;
  const [c] = await db.insert(commentsTable).values({ ...parsed.data, taskId }).returning();
  res.status(201).json(fmt(c));
});

router.delete("/comments/:id", async (req, res): Promise<void> => {
  const { id } = DeleteCommentParams.parse(req.params);
  const [c] = await db.select({ taskId: commentsTable.taskId }).from(commentsTable).where(eq(commentsTable.id, id)).limit(1);
  if (!c) { res.status(204).send(); return; }
  const pid = await projectIdForTask(c.taskId);
  if (pid === null) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await requireProjectAccess(req, res, pid))) return;
  await db.delete(commentsTable).where(eq(commentsTable.id, id));
  res.status(204).send();
});

function fmt(c: typeof commentsTable.$inferSelect) {
  return {
    id: c.id,
    taskId: c.taskId,
    authorId: c.authorId ?? null,
    authorName: c.authorName,
    content: c.content,
    createdAt: c.createdAt.toISOString(),
  };
}

export default router;
