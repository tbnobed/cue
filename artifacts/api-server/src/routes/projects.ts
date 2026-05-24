import { Router } from "express";
import { db } from "@workspace/db";
import { projectsTable, tasksTable, milestonesTable, usersTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  CreateProjectBody,
  UpdateProjectParams,
  UpdateProjectBody,
  DeleteProjectParams,
  GetProjectProgressParams,
  GetProjectParams,
} from "@workspace/api-zod";
import { notifyProjectEvent, actorFromUserId } from "../lib/notifications.js";
import {
  requireProjectAccess,
  requireProjectManage,
  visibleProjectIdsCached,
  canAccessProject,
} from "../lib/access.js";

const router = Router();

/** Pick out the fields that changed between two project rows for the change-log email. */
function diffProject(
  before: typeof projectsTable.$inferSelect,
  after: typeof projectsTable.$inferSelect,
): Record<string, { from: unknown; to: unknown }> {
  const fields = ["name", "description", "location", "status", "phase", "startDate", "targetDate", "completedDate", "budget", "ownerUserId"] as const;
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of fields) {
    const a = (before as Record<string, unknown>)[f] ?? null;
    const b = (after as Record<string, unknown>)[f] ?? null;
    if (a !== b) out[f] = { from: a, to: b };
  }
  return out;
}

router.get("/projects", async (req, res): Promise<void> => {
  const visible = await visibleProjectIdsCached(req);
  let rows: (typeof projectsTable.$inferSelect)[];
  if (visible === "all") {
    rows = await db.select().from(projectsTable).orderBy(projectsTable.createdAt);
  } else if (visible.length === 0) {
    rows = [];
  } else {
    rows = await db.select().from(projectsTable).where(inArray(projectsTable.id, visible)).orderBy(projectsTable.createdAt);
  }
  res.json(rows.map(formatProject));
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { budget, ...rest } = parsed.data;
  // Creator becomes owner. Admins still become owner on create — they can
  // transfer afterwards via POST /projects/:id/transfer if they want to
  // hand it to a non-admin.
  const [project] = await db.insert(projectsTable).values({
    ...rest,
    budget: budget !== undefined ? String(budget) : undefined,
    ownerUserId: req.authUser!.id,
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
  if (!(await requireProjectAccess(req, res, id))) return;
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatProject(project));
});

router.patch("/projects/:id", async (req, res): Promise<void> => {
  const { id } = UpdateProjectParams.parse(req.params);
  if (!(await requireProjectManage(req, res, id))) return;
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
  if (!(await requireProjectManage(req, res, id))) return;
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
  if (!(await requireProjectAccess(req, res, id))) return;
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

// POST /api/projects/:id/transfer — change project ownership.
// Manage gate (owner or admin). New owner must be an existing user; the
// safer behavior is to require the recipient to ALREADY be a member of
// the project (so we don't silently grant project access via transfer) —
// but admins are allowed to bypass that to recover from a stuck project.
// Setting newOwnerUserId to null clears the owner (admin-only).
const TransferBody = z.object({
  newOwnerUserId: z.number().int().positive().nullable(),
});
const TransferParams = z.object({ id: z.coerce.number().int().positive() });

router.post("/projects/:id/transfer", async (req, res): Promise<void> => {
  const { id } = TransferParams.parse(req.params);
  if (!(await requireProjectManage(req, res, id))) return;
  const parsed = TransferBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const newOwnerId = parsed.data.newOwnerUserId;

  if (newOwnerId === null) {
    if (!req.authUser!.isAdmin) {
      res.status(403).json({ error: "Only an admin can clear the project owner." });
      return;
    }
  } else {
    const [u] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, newOwnerId)).limit(1);
    if (!u) { res.status(400).json({ error: "New owner user does not exist." }); return; }
    // Recipient must already be able to access the project — otherwise
    // ownership transfer would silently grant project visibility to an
    // arbitrary user. Admins can bypass this to recover a stuck project.
    if (!req.authUser!.isAdmin) {
      const recipientCanAccess = await canAccessProject({ id: newOwnerId, isAdmin: false }, id);
      if (!recipientCanAccess) {
        res.status(400).json({
          error: "New owner must already be a member or owner of this project. Add them via /projects/:id/members first.",
        });
        return;
      }
    }
  }

  const [before] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!before) { res.status(404).json({ error: "Not found" }); return; }
  const [project] = await db.update(projectsTable)
    .set({ ownerUserId: newOwnerId, updatedAt: new Date() })
    .where(eq(projectsTable.id, id))
    .returning();
  req.log.info({
    actorUserId: req.authUser!.id,
    projectId: id,
    fromOwner: before.ownerUserId,
    toOwner: newOwnerId,
  }, "project owner transferred");
  res.json(formatProject(project));
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
    ownerUserId: s.ownerUserId ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// `sql` import is unused but kept for future raw-SQL filters; silence TS.
void sql;

export default router;
