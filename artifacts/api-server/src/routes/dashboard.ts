import { Router } from "express";
import { db } from "@workspace/db";
import { projectsTable, tasksTable, milestonesTable, activityTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { visibleProjectIdsCached } from "../lib/access.js";

const router = Router();

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const visible = await visibleProjectIdsCached(req);
  // Non-admin with zero projects → empty dashboard, skip the queries.
  if (visible !== "all" && visible.length === 0) {
    res.json({
      totalProjects: 0, activeProjects: 0,
      totalTasks: 0, completedTasks: 0, overdueTasks: 0,
      upcomingDeadlines: [], tasksByStatus: [], tasksByCategory: [],
    });
    return;
  }
  const [projects, tasks, milestones] = await Promise.all([
    visible === "all"
      ? db.select().from(projectsTable)
      : db.select().from(projectsTable).where(inArray(projectsTable.id, visible)),
    visible === "all"
      ? db.select().from(tasksTable)
      : db.select().from(tasksTable).where(inArray(tasksTable.projectId, visible)),
    (visible === "all"
      ? db.select().from(milestonesTable)
      : db.select().from(milestonesTable).where(inArray(milestonesTable.projectId, visible))
    ).orderBy(milestonesTable.dueDate),
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

router.get("/dashboard/activity", async (req, res): Promise<void> => {
  const visible = await visibleProjectIdsCached(req);
  if (visible !== "all" && visible.length === 0) { res.json([]); return; }
  // Filter activity to visible projects only. Fetch a larger window then trim
  // post-filter, since the activity table can include rows for projects the
  // caller can't see and we still want 30 visible items in the response.
  const all = visible === "all"
    ? await db.select().from(activityTable).orderBy(activityTable.createdAt).limit(30)
    : await db.select().from(activityTable).where(inArray(activityTable.projectId, visible)).orderBy(activityTable.createdAt).limit(30);
  const activity = all;
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
