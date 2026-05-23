import { Router } from "express";
import { db } from "@workspace/db";
import { tasksTable, membersTable, projectsTable, milestonesTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import {
  ListTasksQueryParams,
  CreateTaskBody,
  GetTaskParams,
  UpdateTaskParams,
  UpdateTaskBody,
  DeleteTaskParams,
} from "@workspace/api-zod";

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
  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.status === "done" && !parsed.data.completedAt) {
    updateData.completedAt = new Date();
  }
  const [task] = await db.update(tasksTable).set(updateData).where(eq(tasksTable.id, id)).returning();
  if (!task) { res.status(404).json({ error: "Not found" }); return; }
  const enriched = await enrichTasks([task]);
  res.json(enriched[0]);
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const { id } = DeleteTaskParams.parse(req.params);
  await db.delete(tasksTable).where(eq(tasksTable.id, id));
  res.status(204).send();
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
