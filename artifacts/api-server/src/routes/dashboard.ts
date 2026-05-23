import { Router } from "express";
import { db } from "@workspace/db";
import { projectsTable, tasksTable, milestonesTable, activityTable } from "@workspace/db";

const router = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const [projects, tasks, milestones] = await Promise.all([
    db.select().from(projectsTable),
    db.select().from(tasksTable),
    db.select().from(milestonesTable),
  ]);

  const now = new Date().toISOString().split("T")[0];
  const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const totalProjects = projects.length;
  const activeProjects = projects.filter(s => s.status === "in_progress" || s.status === "planning").length;
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === "done").length;
  const overdueTasks = tasks.filter(t => t.status !== "done" && t.dueDate && t.dueDate < now).length;

  const projectMap = Object.fromEntries(projects.map(s => [s.id, s.name]));

  const upcomingDeadlines: unknown[] = [];
  for (const m of milestones) {
    if (m.status !== "completed" && m.dueDate && m.dueDate >= now && m.dueDate <= future) {
      upcomingDeadlines.push({
        type: "milestone",
        id: m.id,
        name: m.name,
        dueDate: m.dueDate,
        projectName: projectMap[m.projectId] ?? "Unknown",
        projectId: m.projectId,
      });
    }
  }
  for (const t of tasks) {
    if (t.status !== "done" && t.dueDate && t.dueDate >= now && t.dueDate <= future) {
      upcomingDeadlines.push({
        type: "task",
        id: t.id,
        name: t.title,
        dueDate: t.dueDate,
        projectName: projectMap[t.projectId] ?? "Unknown",
        projectId: t.projectId,
      });
    }
  }
  upcomingDeadlines.sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate));

  const statusCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  for (const t of tasks) {
    statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
    categoryCounts[t.category] = (categoryCounts[t.category] ?? 0) + 1;
  }

  res.json({
    totalProjects,
    activeProjects,
    totalTasks,
    completedTasks,
    overdueTasks,
    upcomingDeadlines: upcomingDeadlines.slice(0, 10),
    tasksByStatus: Object.entries(statusCounts).map(([status, count]) => ({ status, count })),
    tasksByCategory: Object.entries(categoryCounts).map(([category, count]) => ({ category, count })),
  });
});

router.get("/dashboard/activity", async (_req, res): Promise<void> => {
  const activity = await db.select().from(activityTable).orderBy(activityTable.createdAt).limit(30);
  res.json(
    activity.reverse().map(a => ({
      id: a.id,
      type: a.type,
      message: a.message,
      projectId: a.projectId,
      projectName: a.projectName,
      entityId: a.entityId ?? null,
      entityName: a.entityName ?? null,
      actorName: a.actorName ?? null,
      createdAt: a.createdAt.toISOString(),
    }))
  );
});

export default router;
