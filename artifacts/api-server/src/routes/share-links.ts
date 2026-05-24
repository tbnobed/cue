import { Router } from "express";
import crypto from "node:crypto";
import { db, shareLinksTable, projectsTable, tasksTable, documentsTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod/v4";

const router: Router = Router();

const ResourceType = z.enum(["project", "task", "document"]);

const ListQuery = z.object({
  resourceType: ResourceType,
  resourceId: z.coerce.number().int().positive(),
});

const CreateBody = z.object({
  resourceType: ResourceType,
  resourceId: z.number().int().positive(),
  expiresAt: z.string().datetime().optional(),
});

const IdParam = z.object({ id: z.coerce.number().int().positive() });

/**
 * Build the absolute URL the public sees. We prefer PUBLIC_URL when set
 * (production self-hosted behind a known domain), and fall back to the first
 * Replit dev domain in development. The path is `/s/:token`, served by the
 * frontend's `PublicShare` page (no auth wrapper).
 */
function publicUrl(token: string): string {
  const base = process.env.PUBLIC_URL
    || (process.env.REPLIT_DOMAINS?.split(",")[0] ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}` : "");
  return `${base.replace(/\/$/, "")}/s/${token}`;
}

function isActive(link: typeof shareLinksTable.$inferSelect): boolean {
  if (link.revokedAt) return false;
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return false;
  return true;
}

function formatLink(link: typeof shareLinksTable.$inferSelect) {
  return {
    id: link.id,
    token: link.token,
    resourceType: link.resourceType as "project" | "task" | "document",
    resourceId: link.resourceId,
    url: publicUrl(link.token),
    createdBy: link.createdBy ?? undefined,
    createdAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt ? link.expiresAt.toISOString() : undefined,
    revokedAt: link.revokedAt ? link.revokedAt.toISOString() : undefined,
    active: isActive(link),
  };
}

router.get("/share-links", async (req, res): Promise<void> => {
  const q = ListQuery.parse(req.query);
  const rows = await db
    .select()
    .from(shareLinksTable)
    .where(and(
      eq(shareLinksTable.resourceType, q.resourceType),
      eq(shareLinksTable.resourceId, q.resourceId),
    ))
    .orderBy(desc(shareLinksTable.createdAt));
  res.json(rows.map(formatLink));
});

router.post("/share-links", async (req, res): Promise<void> => {
  const body = CreateBody.parse(req.body);

  // Verify the target resource exists so we don't issue dangling links.
  const exists = await resourceExists(body.resourceType, body.resourceId);
  if (!exists) {
    res.status(404).json({ error: `${body.resourceType} ${body.resourceId} not found` });
    return;
  }

  // Dedupe: if the caller didn't ask for a custom expiry and an active link
  // already exists for this resource, return it instead of minting a duplicate.
  // Clicking "Create new link" twice should not pile up identical share URLs.
  if (!body.expiresAt) {
    const existing = await db
      .select()
      .from(shareLinksTable)
      .where(and(
        eq(shareLinksTable.resourceType, body.resourceType),
        eq(shareLinksTable.resourceId, body.resourceId),
      ))
      .orderBy(desc(shareLinksTable.createdAt));
    const reusable = existing.find(l => isActive(l) && l.expiresAt == null);
    if (reusable) { res.status(200).json(formatLink(reusable)); return; }
  }

  const token = crypto.randomBytes(24).toString("base64url");
  const userId = (req.session as { userId?: number } | undefined)?.userId ?? null;
  const [row] = await db.insert(shareLinksTable).values({
    token,
    resourceType: body.resourceType,
    resourceId: body.resourceId,
    createdBy: userId,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
  }).returning();
  res.status(201).json(formatLink(row));
});

router.delete("/share-links/:id", async (req, res): Promise<void> => {
  const { id } = IdParam.parse(req.params);
  await db.update(shareLinksTable)
    .set({ revokedAt: new Date() })
    .where(eq(shareLinksTable.id, id));
  res.status(204).send();
});

async function resourceExists(type: string, id: number): Promise<boolean> {
  if (type === "project") {
    const [r] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, id)).limit(1);
    return !!r;
  }
  if (type === "task") {
    const [r] = await db.select({ id: tasksTable.id }).from(tasksTable).where(eq(tasksTable.id, id)).limit(1);
    return !!r;
  }
  if (type === "document") {
    const [r] = await db.select({ id: documentsTable.id }).from(documentsTable).where(eq(documentsTable.id, id)).limit(1);
    return !!r;
  }
  return false;
}

export default router;
