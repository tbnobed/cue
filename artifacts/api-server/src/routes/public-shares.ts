import { Router } from "express";
import path from "node:path";
import fs from "node:fs";
import { db, shareLinksTable, projectsTable, tasksTable, documentsTable, milestonesTable, documentFoldersTable, projectMembersTable, membersTable } from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { uploadsDir } from "../lib/uploads-dir.js";

const router: Router = Router();

const TokenParam = z.object({ token: z.string().min(8).max(128) });

/**
 * Look up an active share link by token. Returns null for missing, revoked,
 * or expired links — all of which surface to the public as a flat 404.
 */
async function resolveActiveLink(token: string) {
  const [link] = await db.select().from(shareLinksTable).where(eq(shareLinksTable.token, token)).limit(1);
  if (!link) return null;
  if (link.revokedAt) return null;
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return null;
  return link;
}

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".txt": "text/plain", ".md": "text/plain", ".csv": "text/csv",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

router.get("/public/shares/:token", async (req, res): Promise<void> => {
  const { token } = TokenParam.parse(req.params);
  const link = await resolveActiveLink(token);
  if (!link) { res.status(404).json({ error: "Link not found or expired" }); return; }

  const base = {
    resourceType: link.resourceType as "project" | "task" | "document",
    resourceId: link.resourceId,
    createdAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt ? link.expiresAt.toISOString() : undefined,
  };

  if (link.resourceType === "project") {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, link.resourceId)).limit(1);
    if (!project) { res.status(404).json({ error: "Resource no longer exists" }); return; }
    // Pull the project's children too so the public viewer can show a real
    // overview, not just project metadata.
    const [milestones, tasks, projectDocs, projectFolders, teamMembers] = await Promise.all([
      db.select().from(milestonesTable).where(eq(milestonesTable.projectId, link.resourceId)).orderBy(milestonesTable.dueDate),
      db.select().from(tasksTable).where(eq(tasksTable.projectId, link.resourceId)).orderBy(desc(tasksTable.updatedAt)),
      db.select().from(documentsTable).where(eq(documentsTable.projectId, link.resourceId)).orderBy(desc(documentsTable.updatedAt)),
      db.select().from(documentFoldersTable).where(eq(documentFoldersTable.projectId, link.resourceId)),
      // Project team — mirrors the in-app Team tab. Public viewers see roster
      // (name, role, department, avatar) but NOT contact info (email withheld).
      db.select({
        memberId: projectMembersTable.memberId,
        projectRole: projectMembersTable.projectRole,
        name: membersTable.name,
        role: membersTable.role,
        department: membersTable.department,
        avatarUrl: membersTable.avatarUrl,
      })
        .from(projectMembersTable)
        .innerJoin(membersTable, eq(membersTable.id, projectMembersTable.memberId))
        .where(eq(projectMembersTable.projectId, link.resourceId))
        .orderBy(membersTable.name),
    ]);
    // Also include docs/folders attached to any task of this project (mirrors
    // the in-app project Documents tab which surfaces task attachments).
    const taskIds = tasks.map(t => t.id);
    const [taskDocs, taskFolders] = taskIds.length === 0
      ? [[], []] as [typeof projectDocs, typeof projectFolders]
      : await Promise.all([
          db.select().from(documentsTable).where(inArray(documentsTable.taskId, taskIds)).orderBy(desc(documentsTable.updatedAt)),
          db.select().from(documentFoldersTable).where(inArray(documentFoldersTable.taskId, taskIds)),
        ]);
    res.json({
      ...base,
      project: formatProject(project),
      milestones: milestones.map(formatMilestone),
      tasks: tasks.map(formatTask),
      documents: [...projectDocs, ...taskDocs].map(formatDocument),
      folders: [...projectFolders, ...taskFolders].map(formatFolder),
      team: teamMembers.map(m => ({
        memberId: m.memberId,
        name: m.name,
        role: m.role,
        projectRole: m.projectRole ?? undefined,
        department: m.department ?? undefined,
        avatarUrl: m.avatarUrl ?? undefined,
      })),
    });
    return;
  }

  if (link.resourceType === "task") {
    const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, link.resourceId)).limit(1);
    if (!task) { res.status(404).json({ error: "Resource no longer exists" }); return; }
    const [project] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, task.projectId)).limit(1);
    res.json({ ...base, task: formatTask(task), projectName: project?.name });
    return;
  }

  if (link.resourceType === "document") {
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, link.resourceId)).limit(1);
    if (!doc) { res.status(404).json({ error: "Resource no longer exists" }); return; }
    let projectName: string | undefined;
    if (doc.projectId) {
      const [p] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, doc.projectId)).limit(1);
      projectName = p?.name;
    }
    let fileUrl: string | undefined;
    let fileMimeType: string | undefined;
    if (doc.url?.startsWith("/api/uploads/")) {
      fileUrl = `/api/public/shares/${token}/file`;
      const ext = path.extname(doc.url).toLowerCase();
      fileMimeType = MIME[ext];
    }
    res.json({ ...base, document: formatDocument(doc), projectName, fileUrl, fileMimeType });
    return;
  }

  res.status(404).json({ error: "Unknown resource type" });
});

/**
 * Stream the underlying file for a shared document. Mirrors the gating logic
 * of the JSON endpoint so a revoked/expired link can't keep leaking the file.
 */
router.get("/public/shares/:token/file", async (req, res): Promise<void> => {
  const { token } = TokenParam.parse(req.params);
  const link = await resolveActiveLink(token);
  if (!link || link.resourceType !== "document") { res.status(404).send("Not found"); return; }
  await streamDoc(link.resourceId, res);
});

/**
 * Stream a child document of a *project* share. Verifies the document belongs
 * to the shared project so a token can't be used to enumerate other projects'
 * files.
 */
router.get("/public/shares/:token/documents/:docId/file", async (req, res): Promise<void> => {
  const { token } = TokenParam.parse(req.params);
  const docId = Number(req.params.docId);
  if (!Number.isInteger(docId)) { res.status(400).send("Bad id"); return; }
  const link = await resolveActiveLink(token);
  if (!link) { res.status(404).send("Not found"); return; }

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, docId)).limit(1);
  if (!doc) { res.status(404).send("Not found"); return; }
  // Allow if (a) the share is for this document, (b) the share is for the
  // project the document is directly attached to, or (c) the share is for a
  // project whose task this document is attached to (task attachments are
  // stored with projectId=NULL + taskId set, but surface in the project view).
  let allowed =
    (link.resourceType === "document" && link.resourceId === docId) ||
    (link.resourceType === "project" && doc.projectId === link.resourceId);
  if (!allowed && link.resourceType === "project" && doc.taskId != null) {
    const [t] = await db.select({ projectId: tasksTable.projectId })
      .from(tasksTable).where(eq(tasksTable.id, doc.taskId)).limit(1);
    if (t?.projectId === link.resourceId) allowed = true;
  }
  if (!allowed) { res.status(404).send("Not found"); return; }
  await streamDoc(docId, res);
});

async function streamDoc(docId: number, res: import("express").Response) {
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, docId)).limit(1);
  if (!doc?.url?.startsWith("/api/uploads/")) { res.status(404).send("No file"); return; }

  const filename = doc.url.replace("/api/uploads/", "");
  // Defence-in-depth against path traversal — uploads land with sanitised
  // multer filenames, but we double-check the resolved path stays inside.
  const filePath = path.join(uploadsDir, filename);
  if (!filePath.startsWith(uploadsDir + path.sep) && filePath !== uploadsDir) {
    res.status(400).send("Bad request"); return;
  }
  if (!fs.existsSync(filePath)) { res.status(404).send("File missing"); return; }

  const ext = path.extname(filename).toLowerCase();
  const mime = MIME[ext] ?? "application/octet-stream";
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Disposition", `inline; filename="${path.basename(filename)}"`);
  fs.createReadStream(filePath).pipe(res);
}

function formatMilestone(m: typeof milestonesTable.$inferSelect) {
  return {
    id: m.id, projectId: m.projectId, name: m.name,
    description: m.description ?? undefined,
    dueDate: m.dueDate ?? undefined,
    status: m.status, color: m.color ?? undefined,
  };
}
function formatProject(s: typeof projectsTable.$inferSelect) {
  // NB: `budget` is intentionally omitted from public payloads — anyone with
  // the link should see scope/status/dates, but not financials.
  return {
    id: s.id, name: s.name, description: s.description ?? undefined,
    location: s.location ?? undefined, status: s.status, phase: s.phase ?? undefined,
    startDate: s.startDate ?? undefined, targetDate: s.targetDate ?? undefined,
    completedDate: s.completedDate ?? undefined,
  };
}
function formatTask(t: typeof tasksTable.$inferSelect) {
  return {
    id: t.id, projectId: t.projectId, milestoneId: t.milestoneId ?? undefined,
    assigneeId: t.assigneeId ?? undefined, title: t.title, description: t.description ?? undefined,
    status: t.status, priority: t.priority, category: t.category,
    dueDate: t.dueDate ?? undefined,
    completedAt: t.completedAt ? t.completedAt.toISOString() : undefined,
    createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
  };
}
function formatFolder(f: typeof documentFoldersTable.$inferSelect) {
  return {
    id: f.id, projectId: f.projectId ?? undefined, parentId: f.parentId ?? undefined,
    taskId: f.taskId ?? undefined,
    name: f.name,
    createdAt: f.createdAt.toISOString(), updatedAt: f.updatedAt.toISOString(),
  };
}
function formatDocument(d: typeof documentsTable.$inferSelect) {
  // `uploadedBy` (internal member name) is intentionally omitted — public
  // viewers don't need to know who in the team uploaded the file.
  return {
    id: d.id, projectId: d.projectId ?? undefined, folderId: d.folderId ?? undefined,
    taskId: d.taskId ?? undefined,
    title: d.title, description: d.description ?? undefined, url: d.url ?? undefined,
    notes: d.notes ?? undefined, category: d.category,
    version: d.version ?? undefined,
    createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
  };
}

export default router;
