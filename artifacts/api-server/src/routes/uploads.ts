// Authorized download endpoint for files stored under uploadsDir.
//
// Replaces the previous `app.use("/api/uploads", requireAuth, express.static(...))`.
// The old version only checked authentication — any signed-in user who learned
// a filename could fetch any other project's file. This handler resolves the
// filename → document row → parent project and gates with requireProjectAccess.
//
// Global documents (project_id and task_id both NULL) are admin-only.
// Public share-link downloads remain handled by /api/share/* (HMAC token).
// Collabora Online fetches via /api/wopi/* (HMAC token).
import { Router } from "express";
import path from "path";
import fs from "fs";
import { db, documentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { uploadsDir } from "../lib/uploads-dir.js";
import { requireProjectAccess } from "../lib/access.js";

const router = Router();

router.get("/uploads/:filename", async (req, res): Promise<void> => {
  const filename = req.params.filename ?? "";
  // Defence-in-depth against path traversal: resolve under uploadsDir and
  // refuse anything that escapes the directory. multer's storage uses a
  // sanitized filename already, but never trust that alone.
  const resolved = path.resolve(path.join(uploadsDir, filename));
  if (!resolved.startsWith(path.resolve(uploadsDir) + path.sep)) {
    res.status(400).json({ error: "Invalid filename" }); return;
  }
  // Resolve filename → document via stored URL. The DB is the source of
  // truth for which project owns this file; a file with no document row
  // is treated as 404 (orphan), even if it physically exists on disk.
  const url = `/api/uploads/${filename}`;
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.url, url)).limit(1);
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  // Project-scoped or task-scoped → gate via project access. Global doc
  // (both null) → admin-only (mirrors documents.ts policy).
  let projectId: number | null = doc.projectId ?? null;
  if (projectId == null && doc.taskId != null) {
    const { tasksTable } = await import("@workspace/db");
    const [t] = await db.select({ p: tasksTable.projectId }).from(tasksTable).where(eq(tasksTable.id, doc.taskId)).limit(1);
    projectId = t?.p ?? null;
  }
  if (projectId != null) {
    if (!(await requireProjectAccess(req, res, projectId))) return;
  } else if (!req.authUser!.isAdmin) {
    res.status(404).json({ error: "Not found" }); return;
  }
  if (!fs.existsSync(resolved)) { res.status(404).json({ error: "File missing" }); return; }
  res.sendFile(resolved);
});

export default router;
