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
import { notifyProjectEvent, actorFromUserId } from "../lib/notifications.js";

const router = Router();

/** Pick out the fields that changed between two project rows for the change-log email. */
function diffProject(
  before: typeof projectsTable.$inferSelect,
  after: typeof projectsTable.$inferSelect,
): Record<string, { from: unknown; to: unknown }> {
  const fields = ["name", "description", "location", "status", "phase", "startDate", "targetDate", "completedDate", "budget"] as const;
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of fields) {
    const a = (before as Record<string, unknown>)[f] ?? null;
    const b = (after as Record<string, unknown>)[f] ?? null;
    if (a !== b) out[f] = { from: a, to: b };
  }
  return out;
}

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
  // fire-and-forget — notify project members the project exists. On a brand
  // new project there are usually no assigned members yet, so this is mostly
  // a no-op until someone is added.
  void actorFromUserId(req.session?.userId).then((actor) =>
    notifyProjectEvent("created", { id: project.id, name: project.name }, actor),
  );
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
  const [before] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
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
  if (before) {
    const changes = diffProject(before, project);
    if (Object.keys(changes).length > 0) {
      void actorFromUserId(req.session?.userId).then((actor) =>
        notifyProjectEvent("updated", { id: project.id, name: project.name }, actor, changes),
      );
    }
  }
});

router.delete("/projects/:id", async (req, res): Promise<void> => {
  const { id } = DeleteProjectParams.parse(req.params);
  const [before] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  await db.delete(projectsTable).where(eq(projectsTable.id, id));
  res.status(204).send();
  if (before) {
    void actorFromUserId(req.session?.userId).then((actor) =>
      notifyProjectEvent("deleted", { id: before.id, name: before.name }, actor),
    );
  }
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
