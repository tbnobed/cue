import { Router } from "express";
import { db } from "@workspace/db";
import { tasksTable, membersTable, projectsTable, milestonesTable, taskNotesTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import {
  ListTasksQueryParams,
  CreateTaskBody,
  GetTaskParams,
  UpdateTaskParams,
  UpdateTaskBody,
  DeleteTaskParams,
} from "@workspace/api-zod";
import { getSessionAuthor } from "../lib/session-author.js";
import { notifyTaskEvent, actorFromUserId } from "../lib/notifications.js";

function diffTask(
  before: typeof tasksTable.$inferSelect,
  after: typeof tasksTable.$inferSelect,
): Record<string, { from: unknown; to: unknown }> {
  const fields = ["title", "description", "status", "priority", "category", "assigneeId", "milestoneId", "dueDate"] as const;
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of fields) {
    const a = (before as Record<string, unknown>)[f] ?? null;
    const b = (after as Record<string, unknown>)[f] ?? null;
    if (a !== b) out[f] = { from: a, to: b };
  }
  return out;
}

async function lookupProject(id: number): Promise<{ id: number; name: string } | null> {
  const [p] = await db.select({ id: projectsTable.id, name: projectsTable.name })
    .from(projectsTable).where(eq(projectsTable.id, id));
  return p ?? null;
}

const router = Router();

router.get("/tasks", async (req, res): Promise<void> => {
  const params = ListTasksQueryParams.safeParse(req.query);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  let tasks = await db.select().from(tasksTable).orderBy(tasksTable.createdAt);

  const { projectId, milestoneId, assigneeId, status, category } = params.data;
  if (projectId !== undefined) tasks = tasks.filter(t => t.projectId === projectId);
  if (milestoneId !== undefined) tasks = tasks.filter(t => t.milestoneId === milestoneId);
  if (assigneeId !== undefined) tasks = tasks.filter(t => t.assigneeId === assigneeId);
  if (status !== undefined) tasks = tasks.filter(t => t.status === status);
  if (category !== undefined) tasks = tasks.filter(t => t.category === category);

  const enriched = await enrichTasks(tasks);
  res.json(enriched);
});

router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [task] = await db.insert(tasksTable).values(parsed.data).returning();
  const enriched = await enrichTasks([task]);
  res.status(201).json(enriched[0]);
  void (async () => {
    const project = await lookupProject(task.projectId);
    if (!project) return;
    const actor = await actorFromUserId(req.session?.userId);
    await notifyTaskEvent("created", {
      id: task.id, projectId: task.projectId, title: task.title,
      status: task.status, priority: task.priority, assigneeId: task.assigneeId, dueDate: task.dueDate,
    }, project, actor);
  })();
});

router.get("/tasks/upcoming", async (_req, res): Promise<void> => {
  const today = new Date().toISOString().split("T")[0];
  const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const tasks = await db.select().from(tasksTable).orderBy(tasksTable.dueDate);
  const filtered = tasks.filter(t => t.status !== "done" && t.dueDate && t.dueDate >= today && t.dueDate <= future);
  res.json(await enrichTasks(filtered));
});

router.get("/tasks/:id", async (req, res): Promise<void> => {
  const { id } = GetTaskParams.parse(req.params);
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) { res.status(404).json({ error: "Not found" }); return; }
  const enriched = await enrichTasks([task]);
  res.json(enriched[0]);
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  const { id } = UpdateTaskParams.parse(req.params);
  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  // `noteAuthorName` is intentionally discarded — author identity comes from the session
  // to keep status-change/audit notes trustworthy.
  const { note, noteAuthorName: _ignored, ...rest } = parsed.data as Record<string, unknown> & { note?: string; noteAuthorName?: string };
  void _ignored;

  const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const updateData: Record<string, unknown> = { ...rest, updatedAt: new Date() };
  if (rest.status === "done" && !rest.completedAt) {
    updateData.completedAt = new Date();
  }
  const [task] = await db.update(tasksTable).set(updateData).where(eq(tasksTable.id, id)).returning();
  if (!task) { res.status(404).json({ error: "Not found" }); return; }

  const statusChanged = typeof rest.status === "string" && rest.status !== existing.status;
  const trimmedNote = typeof note === "string" ? note.trim() : "";
  if (statusChanged || trimmedNote.length > 0) {
    const author = await getSessionAuthor(req);
    await db.insert(taskNotesTable).values({
      taskId: id,
      body: trimmedNote.length > 0
        ? trimmedNote
        : `Status changed from ${existing.status} to ${rest.status}.`,
      statusBefore: statusChanged ? existing.status : undefined,
      statusAfter: statusChanged ? String(rest.status) : undefined,
      authorId: author.id,
      authorName: author.name ?? undefined,
    });
  }

  const enriched = await enrichTasks([task]);
  res.json(enriched[0]);

  const changes = diffTask(existing, task);
  if (Object.keys(changes).length > 0) {
    void (async () => {
      const project = await lookupProject(task.projectId);
      if (!project) return;
      const actor = await actorFromUserId(req.session?.userId);
      await notifyTaskEvent("updated", {
        id: task.id, projectId: task.projectId, title: task.title,
        status: task.status, priority: task.priority, assigneeId: task.assigneeId, dueDate: task.dueDate,
      }, project, actor, changes);
    })();
  }
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const { id } = DeleteTaskParams.parse(req.params);
  const [before] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  await db.delete(tasksTable).where(eq(tasksTable.id, id));
  res.status(204).send();
  if (before) {
    void (async () => {
      const project = await lookupProject(before.projectId);
      if (!project) return;
      const actor = await actorFromUserId(req.session?.userId);
      await notifyTaskEvent("deleted", {
        id: before.id, projectId: before.projectId, title: before.title,
        status: before.status, priority: before.priority, assigneeId: before.assigneeId, dueDate: before.dueDate,
      }, project, actor);
    })();
  }
});

async function enrichTasks(tasks: (typeof tasksTable.$inferSelect)[]) {
  if (tasks.length === 0) return [];
  const [members, projects, milestones] = await Promise.all([
    db.select().from(membersTable),
    db.select().from(projectsTable),
    db.select().from(milestonesTable),
  ]);
  const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));
  const projectMap = Object.fromEntries(projects.map(s => [s.id, s.name]));
  const milestoneMap = Object.fromEntries(milestones.map(m => [m.id, m.name]));

  return tasks.map(t => ({
    id: t.id,
    projectId: t.projectId,
    milestoneId: t.milestoneId ?? null,
    assigneeId: t.assigneeId ?? null,
    title: t.title,
    description: t.description ?? null,
    status: t.status,
    priority: t.priority,
    category: t.category,
    dueDate: t.dueDate ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    assigneeName: t.assigneeId ? (memberMap[t.assigneeId] ?? null) : null,
    projectName: projectMap[t.projectId] ?? null,
    milestoneName: t.milestoneId ? (milestoneMap[t.milestoneId] ?? null) : null,
  }));
}

export default router;
