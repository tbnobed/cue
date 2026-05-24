import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "@workspace/db";
import { documentsTable, documentFoldersTable, projectsTable, tasksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  UpdateDocumentParams,
  UpdateDocumentBody,
  DeleteDocumentParams,
} from "@workspace/api-zod";
import { buildEditSession } from "../lib/wopi-token";

import { uploadsDir } from "../lib/uploads-dir.js";

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    cb(null, `${Date.now()}_${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

const TEXT_EXTENSIONS = new Set([
  "csv", "tsv", "txt", "md", "markdown", "log",
  "json", "yaml", "yml", "xml", "html", "htm",
  "js", "ts", "jsx", "tsx", "css", "scss",
  "py", "rb", "go", "java", "c", "cpp", "h", "sh", "env",
  "ini", "toml", "conf",
]);

function readSeedTextSafe(filePath: string, originalName: string): string | null {
  try {
    const ext = (originalName.split(".").pop() || "").toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) return null;
    const stat = fs.statSync(filePath);
    if (stat.size > 2 * 1024 * 1024) return null; // skip >2MB seeds
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

const router = Router();

router.get("/documents", async (req, res): Promise<void> => {
  const docs = await db.select().from(documentsTable).orderBy(documentsTable.createdAt);
  const projects = await db.select().from(projectsTable);
  const projectMap = Object.fromEntries(projects.map(s => [s.id, s.name]));

  let filtered = [...docs];
  const { projectId, global: globalOnly, category, folderId, taskId, includeTasks } = req.query;
  // If both projectId and taskId are supplied, require the task to belong to the project.
  if (taskId !== undefined && projectId !== undefined) {
    const tid = parseInt(String(taskId));
    const pid = parseInt(String(projectId));
    const [t] = await db.select({ projectId: tasksTable.projectId }).from(tasksTable).where(eq(tasksTable.id, tid));
    if (!t || t.projectId !== pid) { res.status(400).json({ error: "Task does not belong to the given project" }); return; }
  }
  if (taskId !== undefined) {
    filtered = filtered.filter(d => d.taskId === parseInt(String(taskId)));
  } else if (globalOnly === "true") filtered = filtered.filter(d => d.projectId === null && d.taskId === null);
  else if (projectId !== undefined) {
    const pid = parseInt(String(projectId));
    if (includeTasks === "true") {
      // Include project-scoped docs (taskId NULL) AND docs attached to any task in this project.
      const projectTasks = await db.select({ id: tasksTable.id })
        .from(tasksTable).where(eq(tasksTable.projectId, pid));
      const taskIds = new Set(projectTasks.map(t => t.id));
      filtered = filtered.filter(d =>
        (d.projectId === pid && d.taskId === null) ||
        (d.taskId !== null && taskIds.has(d.taskId))
      );
    } else {
      filtered = filtered.filter(d => d.projectId === pid && d.taskId === null);
    }
  }
  if (category !== undefined) filtered = filtered.filter(d => d.category === String(category));
  if (folderId !== undefined) {
    const fid = parseInt(String(folderId));
    if (fid === 0) filtered = filtered.filter(d => d.folderId === null);
    else filtered = filtered.filter(d => d.folderId === fid);
  }

  res.json(filtered.map(d => fmt(d, projectMap)));
});

router.post("/documents/upload", upload.single("file"), async (req, res): Promise<void> => {
  const projects = await db.select().from(projectsTable);
  const projectMap = Object.fromEntries(projects.map(s => [s.id, s.name]));

  const title = (req.body.title as string | undefined)?.trim() || req.file?.originalname || "Untitled";
  let projectId = req.body.projectId ? parseInt(req.body.projectId) : null;
  const taskId = req.body.taskId ? parseInt(req.body.taskId) : null;
  const folderId = req.body.folderId ? parseInt(req.body.folderId) : null;
  const category = (req.body.category as string | undefined) || "general";

  // If taskId is supplied, the task must exist; if projectId is also supplied they must match.
  if (taskId !== null) {
    const [t] = await db.select({ projectId: tasksTable.projectId }).from(tasksTable).where(eq(tasksTable.id, taskId));
    if (!t) { res.status(400).json({ error: "Task not found" }); return; }
    if (projectId !== null && t.projectId !== projectId) {
      res.status(400).json({ error: "Task does not belong to the given project" }); return;
    }
    projectId = null; // task-attached docs are scoped via taskId; projectId stays NULL (matches existing rows).
  }

  // Validate folder scope matches document scope (prevents cross-scope linkage).
  if (folderId !== null) {
    const [folder] = await db.select().from(documentFoldersTable).where(eq(documentFoldersTable.id, folderId));
    if (!folder) { res.status(400).json({ error: "Folder not found" }); return; }
    if ((folder.projectId ?? null) !== (projectId ?? null) || (folder.taskId ?? null) !== (taskId ?? null)) {
      res.status(400).json({ error: "Folder belongs to a different scope" });
      return;
    }
  }
  const uploadedBy = (req.body.uploadedBy as string | undefined) || null;
  const version = (req.body.version as string | undefined) || null;

  const fileUrl = req.file ? `/api/uploads/${req.file.filename}` : null;
  const seedText = req.file ? readSeedTextSafe(req.file.path, req.file.originalname) : null;

  const [doc] = await db.insert(documentsTable).values({
    title,
    projectId: projectId ?? undefined,
    taskId: taskId ?? undefined,
    folderId: folderId ?? undefined,
    category,
    url: fileUrl ?? undefined,
    uploadedBy: uploadedBy ?? undefined,
    version: version ?? undefined,
    pendingSeedText: seedText ?? undefined,
  }).returning();

  res.status(201).json(fmt(doc, projectMap));
});

// Atomically returns and clears the pending seed text — first caller wins.
router.post("/documents/:id/consume-seed", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const text = await db.transaction(async (tx) => {
    const [row] = await tx.select({ seed: documentsTable.pendingSeedText })
      .from(documentsTable)
      .where(eq(documentsTable.id, id))
      .for("update");
    if (!row || !row.seed) return null;
    await tx.update(documentsTable)
      .set({ pendingSeedText: null })
      .where(eq(documentsTable.id, id));
    return row.seed;
  });
  res.json({ text });
});

// Returns a Collabora Online edit session (WOPI access_token + actionUrl)
// for the requested document. 503 if Collabora is not configured.
router.post("/documents/:id/edit-session", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  const session = buildEditSession(id);
  if (!session) {
    res.status(503).json({
      error: "Collabora editor not configured",
      hint: "Set COLLABORA_URL and WOPI_PUBLIC_URL environment variables and start the collabora container.",
    });
    return;
  }
  res.json(session);
});

router.patch("/documents/:id", async (req, res): Promise<void> => {
  const { id } = UpdateDocumentParams.parse(req.params);
  const parsed = UpdateDocumentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Validate folder scope on move/reassign — must match BOTH projectId AND taskId of the doc.
  if (parsed.data.folderId !== undefined && parsed.data.folderId !== null) {
    const [existing] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    const [folder] = await db.select().from(documentFoldersTable).where(eq(documentFoldersTable.id, parsed.data.folderId));
    if (!folder) { res.status(400).json({ error: "Folder not found" }); return; }
    const data = parsed.data as { projectId?: number | null; taskId?: number | null };
    const newProjectId = data.projectId !== undefined ? data.projectId : existing.projectId;
    const newTaskId    = data.taskId    !== undefined ? data.taskId    : existing.taskId;
    if ((folder.projectId ?? null) !== (newProjectId ?? null) || (folder.taskId ?? null) !== (newTaskId ?? null)) {
      res.status(400).json({ error: "Folder belongs to a different scope" });
      return;
    }
  }

  const projects = await db.select().from(projectsTable);
  const projectMap = Object.fromEntries(projects.map(s => [s.id, s.name]));
  const [doc] = await db.update(documentsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(documentsTable.id, id))
    .returning();
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(doc, projectMap));
});

router.delete("/documents/:id", async (req, res): Promise<void> => {
  const { id } = DeleteDocumentParams.parse(req.params);
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (doc?.url?.startsWith("/api/uploads/")) {
    const filename = doc.url.replace("/api/uploads/", "");
    const filePath = path.join(uploadsDir, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  await db.delete(documentsTable).where(eq(documentsTable.id, id));
  res.status(204).send();
});

function fmt(d: typeof documentsTable.$inferSelect, projectMap: Record<number, string>) {
  return {
    id: d.id,
    projectId: d.projectId ?? null,
    projectName: d.projectId ? (projectMap[d.projectId] ?? null) : null,
    taskId: d.taskId ?? null,
    folderId: d.folderId ?? null,
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
