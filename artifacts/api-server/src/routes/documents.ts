import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { db } from "@workspace/db";
import { documentsTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  UpdateDocumentParams,
  UpdateDocumentBody,
  DeleteDocumentParams,
} from "@workspace/api-zod";
import { buildEditSession } from "../lib/wopi-token";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

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
  const { projectId, global: globalOnly, category } = req.query;
  if (globalOnly === "true") filtered = filtered.filter(d => d.projectId === null);
  else if (projectId !== undefined) filtered = filtered.filter(d => d.projectId === parseInt(String(projectId)));
  if (category !== undefined) filtered = filtered.filter(d => d.category === String(category));

  res.json(filtered.map(d => fmt(d, projectMap)));
});

router.post("/documents/upload", upload.single("file"), async (req, res): Promise<void> => {
  const projects = await db.select().from(projectsTable);
  const projectMap = Object.fromEntries(projects.map(s => [s.id, s.name]));

  const title = (req.body.title as string | undefined)?.trim() || req.file?.originalname || "Untitled";
  const projectId = req.body.projectId ? parseInt(req.body.projectId) : null;
  const category = (req.body.category as string | undefined) || "general";
  const uploadedBy = (req.body.uploadedBy as string | undefined) || null;
  const version = (req.body.version as string | undefined) || null;

  const fileUrl = req.file ? `/api/uploads/${req.file.filename}` : null;
  const seedText = req.file ? readSeedTextSafe(req.file.path, req.file.originalname) : null;

  const [doc] = await db.insert(documentsTable).values({
    title,
    projectId: projectId ?? undefined,
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
