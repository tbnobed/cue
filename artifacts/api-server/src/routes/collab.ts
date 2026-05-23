import { Router } from "express";
import { db } from "@workspace/db";
import { collabDocsTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const CreateBody = z.object({
  title: z.string().min(1),
  docType: z.enum(["text", "spreadsheet"]).optional(),
  projectId: z.number().int().optional(),
  createdBy: z.string().optional(),
});

const UpdateBody = z.object({
  title: z.string().min(1).optional(),
  projectId: z.number().int().optional(),
  docType: z.enum(["text", "spreadsheet"]).optional(),
});

router.get("/collab/docs", async (_req, res): Promise<void> => {
  const docs = await db.select().from(collabDocsTable).orderBy(collabDocsTable.updatedAt);
  const projects = await db.select().from(projectsTable);
  const projectMap = Object.fromEntries(projects.map(s => [s.id, s.name]));
  res.json(docs.reverse().map(d => fmt(d, projectMap)));
});

router.post("/collab/docs", async (req, res): Promise<void> => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const projects = await db.select().from(projectsTable);
  const projectMap = Object.fromEntries(projects.map(s => [s.id, s.name]));
  const [doc] = await db.insert(collabDocsTable).values(parsed.data).returning();
  res.status(201).json(fmt(doc, projectMap));
});

router.patch("/collab/docs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const projects = await db.select().from(projectsTable);
  const projectMap = Object.fromEntries(projects.map(s => [s.id, s.name]));
  const [doc] = await db.update(collabDocsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(collabDocsTable.id, id))
    .returning();
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(doc, projectMap));
});

router.delete("/collab/docs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  await db.delete(collabDocsTable).where(eq(collabDocsTable.id, id));
  res.status(204).send();
});

function fmt(d: typeof collabDocsTable.$inferSelect, projectMap: Record<number, string>) {
  return {
    id: d.id,
    title: d.title,
    docType: d.docType,
    projectId: d.projectId ?? null,
    projectName: d.projectId ? (projectMap[d.projectId] ?? null) : null,
    createdBy: d.createdBy ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export default router;
