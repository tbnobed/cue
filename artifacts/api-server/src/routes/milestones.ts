import { Router } from "express";
import { db } from "@workspace/db";
import { milestonesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ListMilestonesParams,
  CreateMilestoneParams,
  CreateMilestoneBody,
  UpdateMilestoneParams,
  UpdateMilestoneBody,
  DeleteMilestoneParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/studios/:studioId/milestones", async (req, res): Promise<void> => {
  const { studioId } = ListMilestonesParams.parse(req.params);
  const milestones = await db.select().from(milestonesTable).where(eq(milestonesTable.studioId, studioId)).orderBy(milestonesTable.dueDate);
  res.json(milestones.map(fmt));
});

router.post("/studios/:studioId/milestones", async (req, res): Promise<void> => {
  const { studioId } = CreateMilestoneParams.parse(req.params);
  const parsed = CreateMilestoneBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [m] = await db.insert(milestonesTable).values({ ...parsed.data, studioId }).returning();
  res.status(201).json(fmt(m));
});

router.patch("/milestones/:id", async (req, res): Promise<void> => {
  const { id } = UpdateMilestoneParams.parse(req.params);
  const parsed = UpdateMilestoneBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [m] = await db.update(milestonesTable).set(parsed.data).where(eq(milestonesTable.id, id)).returning();
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(m));
});

router.delete("/milestones/:id", async (req, res): Promise<void> => {
  const { id } = DeleteMilestoneParams.parse(req.params);
  await db.delete(milestonesTable).where(eq(milestonesTable.id, id));
  res.status(204).send();
});

function fmt(m: typeof milestonesTable.$inferSelect) {
  return {
    id: m.id,
    studioId: m.studioId,
    name: m.name,
    description: m.description ?? null,
    dueDate: m.dueDate ?? null,
    status: m.status,
    color: m.color ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

export default router;
