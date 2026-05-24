import { Router, raw } from "express";
import fs from "fs";
import path from "path";
import { db, documentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyWopiToken } from "../lib/wopi-token";

import { uploadsDir } from "../lib/uploads-dir.js";

const router = Router();

function uploadPath(url: string | null): string | null {
  if (!url || !url.startsWith("/api/uploads/")) return null;
  const filename = url.replace("/api/uploads/", "");
  if (filename.includes("/") || filename.includes("..")) return null;
  return path.join(uploadsDir, filename);
}

// CheckFileInfo: GET /api/wopi/files/:id?access_token=...
router.get("/wopi/files/:id", async (req, res): Promise<void> => {
  const fileId = parseInt(req.params.id ?? "", 10);
  const claims = verifyWopiToken(String(req.query.access_token ?? ""));
  if (!claims || claims.fid !== fileId) { res.status(401).send("Invalid token"); return; }

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, fileId));
  if (!doc) { res.status(404).send("Not found"); return; }
  const fp = uploadPath(doc.url);
  if (!fp || !fs.existsSync(fp)) { res.status(404).send("File missing"); return; }
  const stat = fs.statSync(fp);

  // BaseFileName MUST end with an extension Collabora recognizes, otherwise
  // it loads the file read-only. doc.title is user-supplied and may either
  // already have the right extension, have a wrong/decorative one (e.g.
  // "Plexall v2"), or none at all. Always coerce the trailing extension to
  // match the actual on-disk file.
  const onDiskExt = path.extname(fp).slice(1).toLowerCase() || "bin";
  const titleExt = path.extname(doc.title).slice(1).toLowerCase();
  const stem = titleExt ? doc.title.slice(0, -(titleExt.length + 1)) : doc.title;
  const baseFileName = `${stem}.${onDiskExt}`;

  res.json({
    BaseFileName: baseFileName,
    Size: stat.size,
    OwnerId: "studiopm",
    UserId: doc.uploadedBy || "user",
    UserFriendlyName: doc.uploadedBy || "Project Member",
    UserCanWrite: claims.w === 1,
    // COOL also looks at these top-level flags — without UserCanNotWriteRelative
    // explicitly false, some COOL builds enter readonly mode.
    UserCanNotWriteRelative: false,
    UserCanRename: false,
    ReadOnly: claims.w !== 1,
    Version: String(doc.updatedAt.getTime()),
    LastModifiedTime: doc.updatedAt.toISOString(),
    DisablePrint: false,
    DisableExport: false,
    DisableCopy: false,
    SupportsUpdate: true,
    SupportsLocks: false,
    SupportsRename: false,
  });
});

// GetFile: GET /api/wopi/files/:id/contents
router.get("/wopi/files/:id/contents", async (req, res): Promise<void> => {
  const fileId = parseInt(req.params.id ?? "", 10);
  const claims = verifyWopiToken(String(req.query.access_token ?? ""));
  if (!claims || claims.fid !== fileId) { res.status(401).send("Invalid token"); return; }

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, fileId));
  if (!doc) { res.status(404).send("Not found"); return; }
  const fp = uploadPath(doc.url);
  if (!fp || !fs.existsSync(fp)) { res.status(404).send("File missing"); return; }
  res.sendFile(fp);
});

// PutFile: POST /api/wopi/files/:id/contents — raw binary body
router.post(
  "/wopi/files/:id/contents",
  raw({ type: "*/*", limit: "100mb" }),
  async (req, res): Promise<void> => {
    const fileId = parseInt(req.params.id ?? "", 10);
    const claims = verifyWopiToken(String(req.query.access_token ?? ""));
    if (!claims || claims.fid !== fileId || claims.w !== 1) {
      res.status(401).send("Invalid token"); return;
    }

    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, fileId));
    if (!doc) { res.status(404).send("Not found"); return; }
    const fp = uploadPath(doc.url);
    if (!fp) { res.status(400).send("No file path"); return; }

    const body = req.body;
    if (!Buffer.isBuffer(body)) { res.status(400).send("Empty body"); return; }
    fs.writeFileSync(fp, body);

    const now = new Date();
    await db.update(documentsTable).set({ updatedAt: now }).where(eq(documentsTable.id, fileId));
    res.json({ LastModifiedTime: now.toISOString() });
  },
);

export default router;
