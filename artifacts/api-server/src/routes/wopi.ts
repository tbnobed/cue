import { Router, raw } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db, documentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyWopiToken } from "../lib/wopi-token";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "..", "..", "uploads");

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

  res.json({
    BaseFileName: doc.title.includes(".") ? doc.title : `${doc.title}.${path.extname(fp).slice(1) || "bin"}`,
    Size: stat.size,
    OwnerId: "studiopm",
    UserId: doc.uploadedBy || "user",
    UserFriendlyName: doc.uploadedBy || "Project Member",
    UserCanWrite: claims.w === 1,
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
