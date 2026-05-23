import { Router } from "express";
import { db } from "@workspace/db";
import { projectsTable, tasksTable, milestonesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  CreateProjectBody,
  UpdateProjectParams,
  UpdateProjectBody,
  DeleteProjectParams,
  GetProjectProgressParams,
  GetProjectParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/projects", async (req, res): Promise<void> => {
  const projects = await db.select().from(projectsTable).orderBy(projectsTable.createdAt);
  res.json(projects.map(formatProject));
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { budget, ...rest } = parsed.data;
  const [project] = await db.insert(projectsTable).values({
    ...rest,
    budget: budget !== undefined ? String(budget) : undefined,
  }).returning();
  res.status(201).json(formatProject(project));
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  const { id } = GetProjectParams.parse(req.params);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatProject(project));
});

router.patch("/projects/:id", async (req, res): Promise<void> => {
  const { id } = UpdateProjectParams.parse(req.params);
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { budget, ...rest } = parsed.data;
  const [project] = await db.update(projectsTable)
    .set({
      ...rest,
      ...(budget !== undefined ? { budget: String(budget) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(projectsTable.id, id))
    .returning();
  if (!project) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatProject(project));
});

router.delete("/projects/:id", async (req, res): Promise<void> => {
  const { id } = DeleteProjectParams.parse(req.params);
  await db.delete(projectsTable).where(eq(projectsTable.id, id));
  res.status(204).send();
});

router.get("/projects/:id/progress", async (req, res): Promise<void> => {
  const { id } = GetProjectProgressParams.parse(req.params);
  const [tasks, milestones] = await Promise.all([
    db.select().from(tasksTable).where(eq(tasksTable.projectId, id)),
    db.select().from(milestonesTable).where(eq(milestonesTable.projectId, id)),
  ]);
  const now = new Date().toISOString().split("T")[0];

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === "done").length;
  const overdueTasks = tasks.filter(t => t.status !== "done" && t.dueDate && t.dueDate < now).length;

  const totalMilestones = milestones.length;
  const completedMilestones = milestones.filter(m => m.status === "completed").length;

  const taskPercentComplete = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const milestonePercentComplete = totalMilestones > 0 ? Math.round((completedMilestones / totalMilestones) * 100) : 0;
  // Blend by item count so a project with 20 tasks and 5 milestones is dominated
  // by tasks, but a project with only milestones (no tasks yet) still reports
  // real progress instead of stuck-at-0.
  const totalItems = totalTasks + totalMilestones;
  const percentComplete = totalItems > 0
    ? Math.round(((completedTasks + completedMilestones) / totalItems) * 100)
    : 0;

  const categoryMap: Record<string, { total: number; completed: number }> = {};
  for (const task of tasks) {
    if (!categoryMap[task.category]) categoryMap[task.category] = { total: 0, completed: 0 };
    categoryMap[task.category].total++;
    if (task.status === "done") categoryMap[task.category].completed++;
  }
  const byCategory = Object.entries(categoryMap).map(([category, counts]) => ({ category, ...counts }));

  res.json({
    projectId: id,
    totalTasks, completedTasks, overdueTasks,
    totalMilestones, completedMilestones,
    percentComplete, taskPercentComplete, milestonePercentComplete,
    byCategory,
  });
});

function formatProject(s: typeof projectsTable.$inferSelect) {
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
