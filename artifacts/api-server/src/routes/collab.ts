import { Router } from "express";
import { db } from "@workspace/db";
import { collabDocsTable, projectsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireProjectAccess, visibleProjectIdsCached } from "../lib/access.js";

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

router.get("/collab/docs", async (req, res): Promise<void> => {
  const visible = await visibleProjectIdsCached(req);
  let docs: (typeof collabDocsTable.$inferSelect)[];
  if (visible === "all") {
    docs = await db.select().from(collabDocsTable).orderBy(collabDocsTable.updatedAt);
  } else {
    // Filter by visible project ids. Un-scoped collab docs (projectId null)
    // are admin-only — mirrors the documents.ts global-doc policy.
    const scoped = visible.length === 0
      ? []
      : await db.select().from(collabDocsTable).where(inArray(collabDocsTable.projectId, visible)).orderBy(collabDocsTable.updatedAt);
    docs = scoped;
  }
  const projects = await db.select().from(projectsTable);
  const projectMap = Object.fromEntries(projects.map(s => [s.id, s.name]));
  res.json(docs.reverse().map(d => fmt(d, projectMap)));
});

router.post("/collab/docs", async (req, res): Promise<void> => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  // Must have access to the parent project; un-scoped (no projectId) is
  // admin-only to match the documents.ts global-doc policy.
  if (parsed.data.projectId != null) {
    if (!(await requireProjectAccess(req, res, parsed.data.projectId))) return;
  } else if (!req.authUser!.isAdmin) {
    res.status(403).json({ error: "Only an admin can create un-scoped collab docs." });
    return;
  }
  const projects = await db.select().from(projectsTable);
  const projectMap = Object.fromEntries(projects.map(s => [s.id, s.name]));
  const [doc] = await db.insert(collabDocsTable).values(parsed.data).returning();
  res.status(201).json(fmt(doc, projectMap));
});

router.patch("/collab/docs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [existing] = await db.select().from(collabDocsTable).where(eq(collabDocsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  // Gate against the doc's current parent.
  if (existing.projectId != null) {
    if (!(await requireProjectAccess(req, res, existing.projectId))) return;
  } else if (!req.authUser!.isAdmin) {
    res.status(404).json({ error: "Not found" }); return;
  }
  // If re-parenting to a different project, also gate against the destination
  // to prevent cross-project IDOR (member of A moving a doc into B).
  if (parsed.data.projectId !== undefined && parsed.data.projectId !== existing.projectId) {
    if (parsed.data.projectId != null) {
      if (!(await requireProjectAccess(req, res, parsed.data.projectId))) return;
    } else if (!req.authUser!.isAdmin) {
      res.status(403).json({ error: "Only an admin can detach a collab doc from its project." });
      return;
    }
  }
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
  const [existing] = await db.select().from(collabDocsTable).where(eq(collabDocsTable.id, id)).limit(1);
  if (!existing) { res.status(204).send(); return; }
  if (existing.projectId != null) {
    if (!(await requireProjectAccess(req, res, existing.projectId))) return;
  } else if (!req.authUser!.isAdmin) {
    res.status(404).json({ error: "Not found" }); return;
  }
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
