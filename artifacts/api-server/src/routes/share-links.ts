import { Router } from "express";
import crypto from "node:crypto";
import { db, shareLinksTable, projectsTable, tasksTable, documentsTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { notifyShareLink, actorFromUserId } from "../lib/notifications.js";
import { isEmailEnabled } from "../lib/email.js";
import { requireProjectManage, resourceProjectId } from "../lib/access.js";

// ── Abuse controls for /share-links/:id/email ────────────────────────────
// The endpoint is reachable by any authenticated user and lets them dispatch
// emails containing tokenized share URLs to arbitrary recipients. Without
// limits this is a spam relay and a SendGrid-reputation/cost amplifier.
//
// Hard caps (intentionally conservative — real "send to my whole address book"
// flows belong outside this endpoint):
//   MAX_RECIPIENTS_PER_REQUEST  — refuse the whole request above this.
//   RATE_WINDOW_MS / RATE_MAX_* — sliding 10-min window per user covering both
//                                 number of send calls AND total recipients.
//
// We keep state in-process. In docker-compose there's a single `app` instance,
// so this is sufficient. For multi-replica deployments swap to a shared store.
const MAX_RECIPIENTS_PER_REQUEST = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_CALLS = 10;
const RATE_MAX_RECIPIENTS = 60;

interface RateEntry { ts: number; recipients: number }
const rateLog = new Map<number, RateEntry[]>();

function rateCheck(userId: number, recipientCount: number):
  | { ok: true }
  | { ok: false; reason: string; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const entries = (rateLog.get(userId) ?? []).filter((e) => e.ts >= cutoff);
  const calls = entries.length;
  const recents = entries.reduce((acc, e) => acc + e.recipients, 0);
  if (calls >= RATE_MAX_CALLS || recents + recipientCount > RATE_MAX_RECIPIENTS) {
    const oldest = entries[0]?.ts ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + RATE_WINDOW_MS - now) / 1000));
    const reason = calls >= RATE_MAX_CALLS
      ? `Too many share-link emails (limit ${RATE_MAX_CALLS} per ${RATE_WINDOW_MS / 60000} min).`
      : `Too many recipients in the last ${RATE_WINDOW_MS / 60000} min (limit ${RATE_MAX_RECIPIENTS}).`;
    return { ok: false, reason, retryAfterSec };
  }
  entries.push({ ts: now, recipients: recipientCount });
  rateLog.set(userId, entries);
  return { ok: true };
}

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
  // Listing links of a resource is a strong existence signal — gate the
  // same way as create/email/revoke: must be able to manage the project.
  const pid = await resourceProjectId(q.resourceType, q.resourceId);
  if (pid === null) {
    if (!req.authUser!.isAdmin) { res.status(404).json({ error: "Not found" }); return; }
  } else if (!(await requireProjectManage(req, res, pid))) {
    return;
  }
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
  // Gate: only project owners/admins may mint share links. Global docs
  // (no parent project) are admin-only.
  const pid = await resourceProjectId(body.resourceType, body.resourceId);
  if (pid === null) {
    if (!req.authUser!.isAdmin) { res.status(403).json({ error: "Only an admin can share global documents." }); return; }
  } else if (!(await requireProjectManage(req, res, pid))) {
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

const EmailBody = z.object({
  /** Comma-separated or array of email addresses. */
  recipients: z.union([z.string(), z.array(z.string())]),
  message: z.string().max(2000).optional(),
});

router.post("/share-links/:id/email", async (req, res): Promise<void> => {
  const userId = (req.session as { userId?: number } | undefined)?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { id } = IdParam.parse(req.params);
  const body = EmailBody.parse(req.body);

  const [link] = await db.select().from(shareLinksTable).where(eq(shareLinksTable.id, id));
  if (!link) { res.status(404).json({ error: "Share link not found" }); return; }
  if (!isActive(link)) { res.status(400).json({ error: "Share link is revoked or expired" }); return; }
  // Gate: emailing a share link is a privileged broadcast — owners/admins only.
  const pid = await resourceProjectId(link.resourceType as "project" | "task" | "document", link.resourceId);
  if (pid === null) {
    if (!req.authUser!.isAdmin) { res.status(403).json({ error: "Only an admin can email links for global documents." }); return; }
  } else if (!(await requireProjectManage(req, res, pid))) {
    return;
  }

  const raw = Array.isArray(body.recipients)
    ? body.recipients
    : body.recipients.split(/[,;\s]+/);
  // Dedupe + lightweight format validation. We want a hard reject (not silent
  // filtering) on per-request volume so a runaway client UI can't quietly send
  // to thousands.
  const recipients = Array.from(new Set(
    raw.map((r) => r.trim().toLowerCase()).filter((r) => /.+@.+\..+/.test(r)),
  ));
  if (recipients.length === 0) {
    res.status(400).json({ error: "At least one valid recipient email is required" });
    return;
  }
  if (recipients.length > MAX_RECIPIENTS_PER_REQUEST) {
    res.status(400).json({
      error: `Too many recipients in one request (max ${MAX_RECIPIENTS_PER_REQUEST}). Send in smaller batches.`,
    });
    return;
  }

  const rate = rateCheck(userId, recipients.length);
  if (!rate.ok) {
    res.setHeader("Retry-After", String(rate.retryAfterSec));
    res.status(429).json({ error: rate.reason, retryAfterSec: rate.retryAfterSec });
    return;
  }

  if (!isEmailEnabled()) {
    res.status(503).json({ error: "Email is not configured on this server. Set SENDGRID_API_KEY and EMAIL_FROM." });
    return;
  }

  const title = await resourceTitle(link.resourceType, link.resourceId);
  const actor = await actorFromUserId(userId);
  const result = await notifyShareLink({
    url: publicUrl(link.token),
    resourceType: link.resourceType as "project" | "task" | "document",
    resourceTitle: title ?? `${link.resourceType} #${link.resourceId}`,
    recipients,
    message: body.message,
    expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
    actor,
  });

  // Audit trail: log every send so abuse is forensically attributable.
  // We log recipient *count* and the link id, not the addresses themselves,
  // to stay PII-light in logs while still enabling detection of unusual fan-out.
  req.log.info({
    actorUserId: userId,
    actorEmail: actor.email ?? null,
    shareLinkId: link.id,
    resourceType: link.resourceType,
    resourceId: link.resourceId,
    recipientCount: recipients.length,
    sent: result.sent,
    ok: result.ok,
  }, "share-link email dispatched");

  if (!result.ok) {
    res.status(502).json({ error: result.error ?? "Email send failed", sent: result.sent });
    return;
  }
  res.json({ sent: result.sent, recipients });
});

router.delete("/share-links/:id", async (req, res): Promise<void> => {
  const { id } = IdParam.parse(req.params);
  const [link] = await db.select().from(shareLinksTable).where(eq(shareLinksTable.id, id)).limit(1);
  if (!link) { res.status(204).send(); return; }
  const pid = await resourceProjectId(link.resourceType as "project" | "task" | "document", link.resourceId);
  if (pid === null) {
    if (!req.authUser!.isAdmin) { res.status(403).json({ error: "Only an admin can revoke links for global documents." }); return; }
  } else if (!(await requireProjectManage(req, res, pid))) {
    return;
  }
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

/** Fetch a display title for the share-link email subject/body. */
async function resourceTitle(type: string, id: number): Promise<string | null> {
  if (type === "project") {
    const [r] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, id)).limit(1);
    return r?.name ?? null;
  }
  if (type === "task") {
    const [r] = await db.select({ title: tasksTable.title }).from(tasksTable).where(eq(tasksTable.id, id)).limit(1);
    return r?.title ?? null;
  }
  if (type === "document") {
    const [r] = await db.select({ title: documentsTable.title }).from(documentsTable).where(eq(documentsTable.id, id)).limit(1);
    return r?.title ?? null;
  }
  return null;
}

export default router;
