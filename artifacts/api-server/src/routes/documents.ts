import { Router } from "express";
import { db } from "@workspace/db";
import { documentsTable, studiosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateDocumentBody,
  UpdateDocumentParams,
  UpdateDocumentBody,
  DeleteDocumentParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/documents", async (req, res): Promise<void> => {
  const docs = await db.select().from(documentsTable).orderBy(documentsTable.createdAt);
  const studios = await db.select().from(studiosTable);
  const studioMap = Object.fromEntries(studios.map(s => [s.id, s.name]));

  let filtered = docs;

  const { studioId, global: globalOnly, category } = req.query;

  if (globalOnly === "true") {
    filtered = filtered.filter(d => d.studioId === null);
  } else if (studioId !== undefined) {
    const sid = parseInt(String(studioId), 10);
    filtered = filtered.filter(d => d.studioId === sid);
  }

  if (category !== undefined) {
    filtered = filtered.filter(d => d.category === String(category));
  }

  res.json(filtered.map(d => fmt(d, studioMap)));
});

router.post("/documents", async (req, res): Promise<void> => {
  const parsed = CreateDocumentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const studios = await db.select().from(studiosTable);
  const studioMap = Object.fromEntries(studios.map(s => [s.id, s.name]));
  const [doc] = await db.insert(documentsTable).values(parsed.data).returning();
  res.status(201).json(fmt(doc, studioMap));
});

router.patch("/documents/:id", async (req, res): Promise<void> => {
  const { id } = UpdateDocumentParams.parse(req.params);
  const parsed = UpdateDocumentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const studios = await db.select().from(studiosTable);
  const studioMap = Object.fromEntries(studios.map(s => [s.id, s.name]));
  const [doc] = await db.update(documentsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(documentsTable.id, id))
    .returning();
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(doc, studioMap));
});

router.delete("/documents/:id", async (req, res): Promise<void> => {
  const { id } = DeleteDocumentParams.parse(req.params);
  await db.delete(documentsTable).where(eq(documentsTable.id, id));
  res.status(204).send();
});

function fmt(d: typeof documentsTable.$inferSelect, studioMap: Record<number, string>) {
  return {
    id: d.id,
    studioId: d.studioId ?? null,
    studioName: d.studioId ? (studioMap[d.studioId] ?? null) : null,
    title: d.title,
    description: d.description ?? null,
    url: d.url ?? null,
    notes: d.notes ?? null,
    category: d.category,
    uploadedBy: d.uploadedBy ?? null,
    version: d.version ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export default router;
