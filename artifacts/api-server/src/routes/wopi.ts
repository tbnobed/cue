import { Router, raw } from "express";
import fs from "fs";
import path from "path";
import { db, documentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyWopiToken } from "../lib/wopi-token";
import { convertOffice, shouldTranscodeOnRead, invalidateCacheForFile } from "../lib/office-convert.js";

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

  // Transcode-on-read: some formats (CSV/TSV) trigger LibreOffice's "Text
  // Import" dialog that can't be suppressed. We serve them as XLSX through
  // WOPI and convert back to the original format on PutFile.
  const transcode = shouldTranscodeOnRead(onDiskExt);
  let baseFileName: string;
  let size: number;
  if (transcode) {
    const src = await fs.promises.readFile(fp);
    let converted: Buffer;
    try {
      converted = await convertOffice(src, onDiskExt, transcode.servedExt, fileId, stat.mtimeMs);
    } catch (err) {
      // Conversion failed (Collabora unreachable or rejected the file).
      // Fall back to serving the file as-is so the user at least gets the
      // import-dialog experience instead of a hard failure.
      req.log.warn(
        { err: (err as Error).message, fileId, onDiskExt },
        "office-convert failed, falling back to raw file",
      );
      baseFileName = `${stem}.${onDiskExt}`;
      size = stat.size;
      sendCheckFileInfo(res, { baseFileName, size, doc, stat, claims });
      return;
    }
    baseFileName = `${stem}.${transcode.servedExt}`;
    size = converted.length;
  } else {
    baseFileName = `${stem}.${onDiskExt}`;
    size = stat.size;
  }

  sendCheckFileInfo(res, { baseFileName, size, doc, stat, claims });
});

function sendCheckFileInfo(
  res: import("express").Response,
  args: {
    baseFileName: string;
    size: number;
    doc: typeof documentsTable.$inferSelect;
    stat: fs.Stats;
    claims: { w: 0 | 1 };
  },
): void {
  const { baseFileName, size, doc, stat, claims } = args;
  res.json({
    BaseFileName: baseFileName,
    Size: size,
    OwnerId: "studiopm",
    UserId: doc.uploadedBy || "user",
    UserFriendlyName: doc.uploadedBy || "Project Member",
    UserCanWrite: claims.w === 1,
    UserCanNotWriteRelative: false,
    UserCanRename: false,
    ReadOnly: claims.w !== 1,
    Version: String(doc.updatedAt.getTime()) + ":" + String(stat.mtimeMs),
    LastModifiedTime: new Date(stat.mtimeMs).toISOString(),
    DisablePrint: false,
    DisableExport: false,
    DisableCopy: false,
    SupportsUpdate: true,
    SupportsLocks: false,
    SupportsRename: false,
  });
}

// GetFile: GET /api/wopi/files/:id/contents
router.get("/wopi/files/:id/contents", async (req, res): Promise<void> => {
  const fileId = parseInt(req.params.id ?? "", 10);
  const claims = verifyWopiToken(String(req.query.access_token ?? ""));
  if (!claims || claims.fid !== fileId) { res.status(401).send("Invalid token"); return; }

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, fileId));
  if (!doc) { res.status(404).send("Not found"); return; }
  const fp = uploadPath(doc.url);
  if (!fp || !fs.existsSync(fp)) { res.status(404).send("File missing"); return; }

  const onDiskExt = path.extname(fp).slice(1).toLowerCase();
  const transcode = shouldTranscodeOnRead(onDiskExt);
  if (!transcode) { res.sendFile(fp); return; }

  try {
    const stat = await fs.promises.stat(fp);
    const src = await fs.promises.readFile(fp);
    const converted = await convertOffice(src, onDiskExt, transcode.servedExt, fileId, stat.mtimeMs);
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(converted);
  } catch (err) {
    req.log.warn(
      { err: (err as Error).message, fileId, onDiskExt },
      "office-convert failed on GetFile, serving raw",
    );
    res.sendFile(fp);
  }
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

    const onDiskExt = path.extname(fp).slice(1).toLowerCase();
    const transcode = shouldTranscodeOnRead(onDiskExt);
    let toWrite: Buffer = body;
    if (transcode) {
      // The editor saved as `servedExt` (e.g. xlsx). Convert back to the
      // original on-disk format before persisting so the file the user
      // downloads / external systems consume is still a CSV.
      try {
        const stat = await fs.promises.stat(fp).catch(() => null);
        const mtimeMs = stat?.mtimeMs ?? Date.now();
        toWrite = await convertOffice(
          body,
          transcode.servedExt,
          onDiskExt,
          // Cache key for the *inverse* direction is keyed on the editor
          // buffer's logical mtime — use Date.now() so each save is unique
          // (we don't want to ever serve a stale reverse-conversion).
          fileId,
          Date.now() + mtimeMs,
        );
      } catch (err) {
        req.log.error(
          { err: (err as Error).message, fileId, onDiskExt },
          "office-convert failed on PutFile, refusing save to avoid corruption",
        );
        res.status(500).send("Save conversion failed");
        return;
      }
    }

    fs.writeFileSync(fp, toWrite);
    // The on-disk file's mtime just changed; nuke any cached read-direction
    // conversions so the next open re-converts the new contents.
    invalidateCacheForFile(fileId);

    const now = new Date();
    await db.update(documentsTable).set({ updatedAt: now }).where(eq(documentsTable.id, fileId));
    res.json({ LastModifiedTime: now.toISOString() });
  },
);

export default router;
