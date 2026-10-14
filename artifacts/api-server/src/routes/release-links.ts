import { Router, type Response } from "express";
import { randomBytes, createHash } from "node:crypto";
import { and, eq, desc, gte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db, releaseLinksTable as links, releaseEnrollmentsTable as enrollments,
  releaseTemplatesTable as templates, releasesTable as releases,
  releaseEventsTable as events, projectsTable, usersTable,
} from "@workspace/db";
import { requireProjectManage } from "../lib/access";
import { sendForSigning, readSigning, verifySubmission } from "../lib/docuseal-signing";
import { signingConfig, SigningError, signingError, docuseal, getSubmission, remoteTemplateSchema, templateFingerprint } from "../lib/docuseal-client";
import { logger } from "../lib/logger";

export const releaseLinksRouter = Router();
export const publicReleaseLinksRouter = Router();
const id = (value: unknown) => { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s =>
  !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s);
const input = z.object({
  title: z.string().trim().min(1).max(200), templateId: z.number().int().positive(),
  signingMode: z.enum(["email", "immediate"]).default("email"),
  productionDate: date.nullable().optional(),
  expiresAt: z.string().datetime().optional(),
  signers: z.array(z.object({
    role: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(200),
    email: z.string().trim().email().max(254),
  })).max(19).default([]),
});
function url(token: string) {
  const origin = process.env.PUBLIC_URL?.replace(/\/$/, "");
  if (!origin && process.env.NODE_ENV === "production") throw new SigningError("Configure Cue PUBLIC_URL before creating release links.", 503);
  return `${origin || ""}/release-sign/${token}`;
}
function view(row: typeof links.$inferSelect) {
  return { id: row.id, title: row.title, templateId: row.templateId, signingMode: row.signingMode,
    productionDate: row.productionDate, createdAt: row.createdAt, expiresAt: row.expiresAt,
    revokedAt: row.revokedAt, url: url(row.token) };
}
function fail(res: Response, error: unknown) {
  res.status(error instanceof SigningError ? error.status : 500).json({
    error: error instanceof SigningError ? error.message : "Unable to process this release link. Try again or contact the producer.",
  });
}
function active(link: typeof links.$inferSelect) {
  return !link.revokedAt && link.expiresAt.getTime() > Date.now();
}
async function validateTemplate(template: typeof templates.$inferSelect) {
  const remote = remoteTemplateSchema.safeParse(await docuseal(`/templates/${template.remoteId}`));
  if (!remote.success || remote.data.archived_at || templateFingerprint(remote.data) !== template.fingerprint) {
    throw new SigningError("The release template changed. Ask the producer to approve it again and create a new link.", 409);
  }
}
async function available(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new SigningError("This release link is unavailable or has expired.", 404);
  const [link] = await db.select().from(links).where(eq(links.token, token));
  if (!link || !active(link)) throw new SigningError("This release link is unavailable or has expired.", 404);
  const [template] = await db.select().from(templates).where(eq(templates.id, link.templateId));
  if (!template?.active) throw new SigningError("This release template is no longer available. Contact the producer for a new link.", 409);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, link.projectId));
  const [creator] = await db.select().from(usersTable).where(eq(usersTable.id, link.createdBy));
  // A link must not retain write permission after its creator loses management access.
  if (!creator?.isActive || (!creator.isAdmin && project.ownerUserId !== creator.id)) {
    throw new SigningError("This release link is unavailable. Contact the producer for a new link.", 404);
  }
  if (!signingConfig().configured) throw new SigningError("Signing is temporarily unavailable. Please contact the producer.", 503);
  return { link, template, project };
}

releaseLinksRouter.get("/projects/:projectId/release-links", async (req, res) => {
  const projectId = id(req.params.projectId);
  if (!projectId) { res.status(400).json({ error: "Invalid project." }); return; }
  if (!await requireProjectManage(req, res, projectId)) return;
  try {
    res.json((await db.select().from(links).where(eq(links.projectId, projectId)).orderBy(desc(links.createdAt))).map(view));
  } catch (e) { fail(res, e); }
});
releaseLinksRouter.post("/projects/:projectId/release-links", async (req, res) => {
  const projectId = id(req.params.projectId), parsed = input.safeParse(req.body);
  if (!projectId || !parsed.success) { res.status(400).json({ error: "Provide a title, approved template, valid production date and all countersigners." }); return; }
  if (!await requireProjectManage(req, res, projectId)) return;
  try {
    const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : new Date(Date.now() + 30 * 86400_000);
    if (expiresAt.getTime() <= Date.now() || expiresAt.getTime() > Date.now() + 366 * 86400_000) throw new SigningError("Choose an expiration within the next year.", 400);
    const [template] = await db.select().from(templates).where(and(eq(templates.id, parsed.data.templateId), eq(templates.active, true)));
    if (!template) throw new SigningError("Select an active approved template.", 400);
    const otherRoles = template.roles.filter(role => role !== template.guestRole);
    if (parsed.data.signers.length !== otherRoles.length ||
        new Set(parsed.data.signers.map(s => s.role)).size !== otherRoles.length ||
        parsed.data.signers.some(s => !otherRoles.includes(s.role))) throw new SigningError("Provide one countersigner for each additional template role.", 400);
    await validateTemplate(template);
    const token = randomBytes(32).toString("hex");
    url(token); // Reject missing production URL before writing.
    const [row] = await db.insert(links).values({
      ...parsed.data, token, projectId, expiresAt, createdBy: req.authUser!.id,
    }).returning();
    res.status(201).json(view(row));
  } catch (e) { fail(res, e); }
});
releaseLinksRouter.delete("/release-links/:id", async (req, res) => {
  const linkId = id(req.params.id);
  if (!linkId) { res.status(404).json({ error: "Link not found." }); return; }
  const [link] = await db.select().from(links).where(eq(links.id, linkId));
  if (!link) { res.status(404).json({ error: "Link not found." }); return; }
  if (!await requireProjectManage(req, res, link.projectId)) return;
  await db.update(links).set({ revokedAt: new Date() }).where(eq(links.id, linkId));
  res.sendStatus(204);
});

// Tokenized public pages and responses must not enter proxy/browser caches.
publicReleaseLinksRouter.use("/public/release-links", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
publicReleaseLinksRouter.get("/public/release-links/:token", async (req, res) => {
  try {
    const { link, template, project } = await available(String(req.params.token));
    res.json({ title: link.title, projectName: project.name, productionDate: link.productionDate, signingMode: link.signingMode,
      templateName: template.name, templateVersion: template.version, expiresAt: link.expiresAt });
  } catch (e) { fail(res, e); }
});
const registration = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254).transform(s => s.toLowerCase()),
  consent: z.literal(true),
  registrationKey: z.string().uuid().optional(),
});
const receipt = { message: "Check your email for your personal signing link. If you already registered, use the email previously sent. If it does not arrive, contact the producer." };
const hashReceipt = (key: string) => createHash("sha256").update(key).digest("hex");

async function registrationResponse(link: typeof links.$inferSelect, email: string, key?: string) {
  if (link.signingMode !== "immediate" || !key) return receipt;
  const [entry] = await db.select().from(enrollments).where(and(eq(enrollments.linkId, link.id), eq(enrollments.email, email)));
  // An email address is not proof of ownership. Only the browser that created
  // this registration may recover its private signing session.
  if (!entry?.receiptHash || entry.receiptHash !== hashReceipt(key)) return receipt;
  const local = await readSigning(entry.releaseId);
  if (!local?.submissionId) throw new SigningError("Your registration is saved, but the signing form is not ready. Retry from this browser, or contact the producer if the problem continues.", 503);
  const remote = await getSubmission(local.submissionId);
  verifySubmission(remote, local);
  const [template] = await db.select().from(templates).where(eq(templates.id, link.templateId));
  const guest = remote.submitters.find(s => s.role === template.guestRole && s.email.toLowerCase() === email);
  if (guest?.status === "completed") return { message: "You have already signed this release. A completed copy will be emailed after all required signatures are finished." };
  if (["completed", "declined", "expired", "archived"].includes(remote.status) || guest?.status === "declined") {
    throw new SigningError("This signing request is no longer open. Contact the producer.", 409);
  }
  if (!guest?.slug || !/^[a-zA-Z0-9_-]+$/.test(guest.slug)) {
    throw new SigningError("Your registration is saved, but DocuSeal did not return a signing link. Retry or contact the producer.", 503);
  }
  // Use our configured public origin, never a provider-supplied redirect URL.
  return { message: "Your release is ready to review and sign.", signingUrl: `${signingConfig().publicUrl}/s/${guest.slug}` };
}
publicReleaseLinksRouter.post("/public/release-links/:token/register", async (req, res) => {
  const parsed = registration.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter your name and email, and agree to receive your signing link." }); return; }
  try {
    const { link, template } = await available(String(req.params.token));
    if (link.signingMode === "immediate" && !parsed.data.registrationKey) {
      throw new SigningError("Reload this page before continuing to sign.", 400);
    }
    // Fast duplicate path does not re-send or reveal another person's signing URL.
    const [existing] = await db.select({ id: enrollments.id }).from(enrollments).where(and(eq(enrollments.linkId, link.id), eq(enrollments.email, parsed.data.email)));
    if (existing) { res.status(202).json(await registrationResponse(link, parsed.data.email, parsed.data.registrationKey)); return; }
    await validateTemplate(template);
    const releaseId = await db.transaction(async tx => {
      // Serialize same-link registrations with revoke; advisory email lock caps
      // messages across different links and across app replicas.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${parsed.data.email}))`);
      const [locked] = await tx.select().from(links).where(eq(links.id, link.id)).for("update");
      if (!locked || !active(locked)) throw new SigningError("This release link is unavailable or has expired.", 404);
      const [duplicate] = await tx.select({ id: enrollments.id }).from(enrollments).where(and(eq(enrollments.linkId, link.id), eq(enrollments.email, parsed.data.email)));
      if (duplicate) return null;
      const cutoff = new Date(Date.now() - 3600_000);
      const [emailCount] = await tx.select({ total: sql<number>`count(*)::int` }).from(enrollments).where(and(eq(enrollments.email, parsed.data.email), gte(enrollments.createdAt, cutoff)));
      const [linkCount] = await tx.select({ total: sql<number>`count(*)::int` }).from(enrollments).where(and(eq(enrollments.linkId, link.id), gte(enrollments.createdAt, cutoff)));
      if (emailCount.total >= 5 || linkCount.total >= 1000) throw new SigningError("Too many signing requests. Please try again later.", 429);
      const [release] = await tx.insert(releases).values({
        projectId: link.projectId, guestName: parsed.data.name, guestEmail: parsed.data.email,
        title: link.title, templateVersion: template.version, productionDate: link.productionDate,
        createdBy: link.createdBy, status: "draft",
        notes: "Self-registered through a production release link.",
      }).returning();
      await tx.insert(enrollments).values({
        linkId: link.id, email: parsed.data.email, releaseId: release.id,
        receiptHash: link.signingMode === "immediate" ? hashReceipt(parsed.data.registrationKey!) : null,
      });
      await tx.insert(events).values({ releaseId: release.id, actorId: link.createdBy,
        action: link.signingMode === "immediate" ? "release-link:self-registered-for-immediate-signing" : "release-link:self-registered-with-email-consent" });
      return release.id;
    });
    if (releaseId) {
      try {
        const result = await sendForSigning(releaseId, template.id, link.signers, link.createdBy);
        if (result.state === "needs_review") {
          throw new SigningError("Your registration was saved, but signing email delivery could not be confirmed. Contact the producer; please do not submit again.", 503);
        }
      } catch (error) {
        // Registration is durable even if provider fails; producer can see the
        // draft / needs-review record and recover without losing guest details.
        logger.warn({ releaseId, error: signingError(error) }, "Release-link signing needs producer follow-up");
        throw new SigningError("Your registration was saved, but signing email delivery could not be confirmed. Contact the producer; please do not submit again.", 503);
      }
    }
    res.status(202).json(await registrationResponse(link, parsed.data.email, parsed.data.registrationKey));
  } catch (e) { fail(res, e); }
});
