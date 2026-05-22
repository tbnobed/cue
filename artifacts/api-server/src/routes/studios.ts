import { Router } from "express";
import { db } from "@workspace/db";
import { studiosTable, tasksTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  CreateStudioBody,
  UpdateStudioParams,
  UpdateStudioBody,
  DeleteStudioParams,
  GetStudioProgressParams,
  GetStudioParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/studios", async (req, res): Promise<void> => {
  const studios = await db.select().from(studiosTable).orderBy(studiosTable.createdAt);
  res.json(studios.map(formatStudio));
});

router.post("/studios", async (req, res): Promise<void> => {
  const parsed = CreateStudioBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [studio] = await db.insert(studiosTable).values(parsed.data).returning();
  res.status(201).json(formatStudio(studio));
});

router.get("/studios/:id", async (req, res): Promise<void> => {
  const { id } = GetStudioParams.parse(req.params);
  const [studio] = await db.select().from(studiosTable).where(eq(studiosTable.id, id));
  if (!studio) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatStudio(studio));
});

router.patch("/studios/:id", async (req, res): Promise<void> => {
  const { id } = UpdateStudioParams.parse(req.params);
  const parsed = UpdateStudioBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [studio] = await db.update(studiosTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(studiosTable.id, id))
    .returning();
  if (!studio) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatStudio(studio));
});

router.delete("/studios/:id", async (req, res): Promise<void> => {
  const { id } = DeleteStudioParams.parse(req.params);
  await db.delete(studiosTable).where(eq(studiosTable.id, id));
  res.status(204).send();
});

router.get("/studios/:id/progress", async (req, res): Promise<void> => {
  const { id } = GetStudioProgressParams.parse(req.params);
  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.studioId, id));
  const now = new Date().toISOString().split("T")[0];
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === "done").length;
  const overdueTasks = tasks.filter(t => t.status !== "done" && t.dueDate && t.dueDate < now).length;
  const percentComplete = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const categoryMap: Record<string, { total: number; completed: number }> = {};
  for (const task of tasks) {
    if (!categoryMap[task.category]) categoryMap[task.category] = { total: 0, completed: 0 };
    categoryMap[task.category].total++;
    if (task.status === "done") categoryMap[task.category].completed++;
  }
  const byCategory = Object.entries(categoryMap).map(([category, counts]) => ({ category, ...counts }));

  res.json({ studioId: id, totalTasks, completedTasks, overdueTasks, percentComplete, byCategory });
});

function formatStudio(s: typeof studiosTable.$inferSelect) {
  return {
    id: s.id,
    name: s.name,
    description: s.description ?? null,
    location: s.location ?? null,
    status: s.status,
    phase: s.phase ?? null,
    startDate: s.startDate ?? null,
    targetDate: s.targetDate ?? null,
    completedDate: s.completedDate ?? null,
    budget: s.budget ? Number(s.budget) : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export default router;
