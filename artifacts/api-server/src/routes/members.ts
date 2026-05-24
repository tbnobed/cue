import { Router } from "express";
import { db } from "@workspace/db";
import { membersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  CreateMemberBody,
  UpdateMemberParams,
  UpdateMemberBody,
  DeleteMemberParams,
} from "@workspace/api-zod";
import { linkMemberToUserByEmail } from "../lib/access.js";
import { requireAdmin } from "../middlewares/require-auth.js";
import { sendEmail, isEmailEnabled, renderEmailShell, appUrl, escapeHtml } from "../lib/email.js";

// ── Abuse controls for /members/:id/invite ───────────────────────────────
// Invite emails are admin-only AND addressed to a known roster email (not
// an arbitrary input), so the spam surface is much smaller than share-link
// emails. Still rate-limit per admin so a runaway script can't blast the
// whole roster repeatedly.
const INVITE_WINDOW_MS = 10 * 60 * 1000;
const INVITE_MAX_PER_WINDOW = 30;
const inviteLog = new Map<number, number[]>();

function inviteRateCheck(userId: number):
  | { ok: true }
  | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - INVITE_WINDOW_MS;
  const entries = (inviteLog.get(userId) ?? []).filter((ts) => ts >= cutoff);
  if (entries.length >= INVITE_MAX_PER_WINDOW) {
    const oldest = entries[0];
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + INVITE_WINDOW_MS - now) / 1000)) };
  }
  entries.push(now);
  inviteLog.set(userId, entries);
  return { ok: true };
}

const InviteParams = z.object({ id: z.coerce.number().int().positive() });

const router = Router();

// The team directory is intentionally global to all authenticated users —
// project members need to discover one another (e.g. to assign a task).
// Per-project visibility lives on tasks/projects, not on the roster.
router.get("/members", async (_req, res): Promise<void> => {
  const members = await db.select().from(membersTable).orderBy(membersTable.name);
  res.json(members.map(fmt));
});

router.post("/members", async (req, res): Promise<void> => {
  const parsed = CreateMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [m] = await db.insert(membersTable).values(parsed.data).returning();
  // If the roster entry has an email and a matching user exists, bind them
  // now (so that user immediately sees projects this member is on, without
  // waiting for their next login).
  if (m.email) {
    try { await linkMemberToUserByEmail(m.id, m.email); }
    catch (err) { req.log.error({ err, memberId: m.id }, "linkMemberToUserByEmail failed (create)"); }
  }
  res.status(201).json(fmt(m));
});

router.patch("/members/:id", async (req, res): Promise<void> => {
  const { id } = UpdateMemberParams.parse(req.params);
  const parsed = UpdateMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [m] = await db.update(membersTable).set(parsed.data).where(eq(membersTable.id, id)).returning();
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  // Email changed → re-attempt link (only takes effect if user_id is NULL).
  if (parsed.data.email && m.email) {
    try { await linkMemberToUserByEmail(m.id, m.email); }
    catch (err) { req.log.error({ err, memberId: m.id }, "linkMemberToUserByEmail failed (update)"); }
  }
  res.json(fmt(m));
});

// Admin-only: email an invite to a roster member's address and pre-approve
// them in one step. Registered before `/members/:id` mutation routes; the
// requireAdmin gate is attached locally rather than via router.use(...) so
// the rest of /members (read/create/update/delete) stays open to all
// authenticated users (admin checks for member CRUD happen elsewhere).
router.post("/members/:id/invite", requireAdmin, async (req, res): Promise<void> => {
  const { id } = InviteParams.parse(req.params);
  const actorUserId = req.session?.userId;
  if (!actorUserId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const [member] = await db.select().from(membersTable).where(eq(membersTable.id, id)).limit(1);
  if (!member) { res.status(404).json({ error: "Member not found" }); return; }
  const email = member.email?.trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: "This member has no email address. Add one before sending an invite." });
    return;
  }

  if (!isEmailEnabled()) {
    res.status(503).json({ error: "Email is not configured on this server. Set SENDGRID_API_KEY and EMAIL_FROM." });
    return;
  }

  const rate = inviteRateCheck(actorUserId);
  if (!rate.ok) {
    res.setHeader("Retry-After", String(rate.retryAfterSec));
    res.status(429).json({
      error: `Too many invite emails (limit ${INVITE_MAX_PER_WINDOW} per ${INVITE_WINDOW_MS / 60000} min).`,
      retryAfterSec: rate.retryAfterSec,
    });
    return;
  }

  // Flip pre-approval ON before sending. Per the product decision, sending
  // an invite IS the approval — by the time the email lands, the member can
  // sign in and be active immediately. We do this before the send so a
  // double-click can't race; the DB write is idempotent.
  await db.update(membersTable).set({ preApproved: true }).where(eq(membersTable.id, id));

  const loginUrl = appUrl("/login");
  const greetingName = escapeHtml(member.name.split(/\s+/)[0] || member.name);
  const role = escapeHtml(member.role);
  const bodyHtml = `
    <p style="margin:0 0 12px">Hi ${greetingName},</p>
    <p style="margin:0 0 12px">You've been added to <strong>Cue</strong> as a ${role}. Sign in to start collaborating on projects, milestones, and tasks with your team.</p>
    <p style="margin:0 0 12px">You can sign in with Google, Authentik, or a local account if your administrator has set one up for you. Your access has been pre-approved — you'll land in the app immediately on first sign-in.</p>
  `;
  const text = `Hi ${member.name.split(/\s+/)[0] || member.name},

You've been added to Cue as a ${member.role}. Sign in to start collaborating on projects, milestones, and tasks with your team.

Sign in here: ${loginUrl}

Your access has been pre-approved — you'll land in the app immediately on first sign-in.

— Cue`;

  const result = await sendEmail({
    to: email,
    subject: "[Cue] You're invited to join the team",
    html: renderEmailShell({
      preheader: "Sign in to Cue to start collaborating with your team.",
      heading: "You're invited to Cue",
      bodyHtml,
      ctaText: "Sign in to Cue",
      ctaUrl: loginUrl,
      footerNote: "If you weren't expecting this, you can safely ignore the email — your address is on the roster but no account is created until you sign in.",
    }),
    text,
  });

  req.log.info({
    actorUserId,
    memberId: member.id,
    recipientEmail: email,
    sent: result.ok,
  }, "member invite email dispatched");

  if (!result.ok) {
    // We already flipped preApproved; that's fine — the admin can re-send,
    // or the user can sign in directly via PUBLIC_URL/login. Surface the
    // send failure honestly so the admin knows to try again.
    res.status(result.skipped ? 503 : 502).json({
      error: result.error ?? "Email send failed",
      preApproved: true,
    });
    return;
  }

  res.json({ sent: true, email, preApproved: true });
});

router.delete("/members/:id", async (req, res): Promise<void> => {
  const { id } = DeleteMemberParams.parse(req.params);
  await db.delete(membersTable).where(eq(membersTable.id, id));
  res.status(204).send();
});

function fmt(m: typeof membersTable.$inferSelect) {
  return {
    id: m.id,
    name: m.name,
    email: m.email ?? null,
    role: m.role,
    department: m.department ?? null,
    avatarUrl: m.avatarUrl ?? null,
    title: m.title ?? null,
    phone: m.phone ?? null,
    mobilePhone: m.mobilePhone ?? null,
    location: m.location ?? null,
    company: m.company ?? null,
    notes: m.notes ?? null,
    preApproved: m.preApproved,
    userId: m.userId ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

export default router;
