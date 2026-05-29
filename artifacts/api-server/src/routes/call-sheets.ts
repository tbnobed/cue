import { Router } from "express";
import crypto from "node:crypto";
import {
  db,
  callSheetsTable,
  crewInvitesTable,
  projectsTable,
  membersTable,
} from "@workspace/db";
import { and, eq, desc, asc } from "drizzle-orm";
import { z } from "zod/v4";
import {
  CreateCallSheetParams,
  CreateCallSheetBody,
  GetCallSheetParams,
  UpdateCallSheetParams,
  UpdateCallSheetBody,
  DeleteCallSheetParams,
  ListCallSheetsParams,
  SendCallSheetInvitesParams,
  AddCrewInviteParams,
  AddCrewInviteBody,
  UpdateCrewInviteParams,
  UpdateCrewInviteBody,
  DeleteCrewInviteParams,
  SendCrewInviteParams,
} from "@workspace/api-zod";
import { requireProjectAccess, requireProjectManage } from "../lib/access.js";
import { sendEmail, isEmailEnabled, renderEmailShell, escapeHtml, appUrl } from "../lib/email.js";

const router: Router = Router();

type CallSheetRow = typeof callSheetsTable.$inferSelect;
type CrewRow = typeof crewInvitesTable.$inferSelect;

/** Public reply URL the invitee clicks — served by the frontend `/crew/:token` page (no auth). */
function publicCrewUrl(token: string): string {
  const base = process.env.PUBLIC_URL
    || (process.env.REPLIT_DOMAINS?.split(",")[0] ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}` : "");
  return `${base.replace(/\/$/, "")}/crew/${token}`;
}

function fmtCrew(c: CrewRow) {
  return {
    id: c.id,
    callSheetId: c.callSheetId,
    position: c.position,
    memberId: c.memberId ?? null,
    name: c.name,
    email: c.email ?? null,
    rateType: c.rateType as "full" | "half",
    dayRate: c.dayRate ?? null,
    status: c.status as "pending" | "invited" | "available" | "unavailable" | "confirmed",
    responseNote: c.responseNote ?? null,
    invitedAt: c.invitedAt ? c.invitedAt.toISOString() : null,
    respondedAt: c.respondedAt ? c.respondedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  };
}

function fmtSheet(s: CallSheetRow, crew?: CrewRow[]) {
  return {
    id: s.id,
    projectId: s.projectId,
    title: s.title ?? null,
    date: s.date,
    callTime: s.callTime ?? null,
    wrapTime: s.wrapTime ?? null,
    location: s.location ?? null,
    billingNote: s.billingNote ?? null,
    notes: s.notes ?? null,
    status: s.status as "draft" | "sent" | "final",
    createdBy: s.createdBy ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    ...(crew ? { crew: crew.map(fmtCrew) } : {}),
  };
}

async function loadCrew(callSheetId: number): Promise<CrewRow[]> {
  return db.select().from(crewInvitesTable)
    .where(eq(crewInvitesTable.callSheetId, callSheetId))
    .orderBy(asc(crewInvitesTable.createdAt));
}

/** Resolve a call sheet id to its row (or null). */
async function getSheet(id: number): Promise<CallSheetRow | null> {
  const [s] = await db.select().from(callSheetsTable).where(eq(callSheetsTable.id, id)).limit(1);
  return s ?? null;
}

/** Resolve a crew line id to {crew, sheet} (or null). */
async function getCrewWithSheet(id: number): Promise<{ crew: CrewRow; sheet: CallSheetRow } | null> {
  const [c] = await db.select().from(crewInvitesTable).where(eq(crewInvitesTable.id, id)).limit(1);
  if (!c) return null;
  const sheet = await getSheet(c.callSheetId);
  if (!sheet) return null;
  return { crew: c, sheet };
}

// ── Call sheets ─────────────────────────────────────────────────────────────

router.get("/projects/:projectId/call-sheets", async (req, res): Promise<void> => {
  const { projectId } = ListCallSheetsParams.parse(req.params);
  if (!(await requireProjectAccess(req, res, projectId))) return;
  const rows = await db.select().from(callSheetsTable)
    .where(eq(callSheetsTable.projectId, projectId))
    .orderBy(desc(callSheetsTable.date), desc(callSheetsTable.createdAt));
  res.json(rows.map((s) => fmtSheet(s)));
});

router.post("/projects/:projectId/call-sheets", async (req, res): Promise<void> => {
  const { projectId } = CreateCallSheetParams.parse(req.params);
  const parsed = CreateCallSheetBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (!(await requireProjectManage(req, res, projectId))) return;

  const userId = req.session?.userId ?? null;
  const [row] = await db.insert(callSheetsTable).values({
    projectId,
    title: parsed.data.title,
    date: parsed.data.date,
    callTime: parsed.data.callTime,
    wrapTime: parsed.data.wrapTime,
    location: parsed.data.location,
    billingNote: parsed.data.billingNote,
    notes: parsed.data.notes,
    status: parsed.data.status ?? "draft",
    createdBy: userId,
  }).returning();
  res.status(201).json(fmtSheet(row, []));
});

router.get("/call-sheets/:id", async (req, res): Promise<void> => {
  const { id } = GetCallSheetParams.parse(req.params);
  const sheet = await getSheet(id);
  if (!sheet) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await requireProjectAccess(req, res, sheet.projectId))) return;
  const crew = await loadCrew(id);
  res.json(fmtSheet(sheet, crew));
});

router.patch("/call-sheets/:id", async (req, res): Promise<void> => {
  const { id } = UpdateCallSheetParams.parse(req.params);
  const parsed = UpdateCallSheetBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const sheet = await getSheet(id);
  if (!sheet) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await requireProjectManage(req, res, sheet.projectId))) return;

  const [row] = await db.update(callSheetsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(callSheetsTable.id, id))
    .returning();
  const crew = await loadCrew(id);
  res.json(fmtSheet(row, crew));
});

router.delete("/call-sheets/:id", async (req, res): Promise<void> => {
  const { id } = DeleteCallSheetParams.parse(req.params);
  const sheet = await getSheet(id);
  if (!sheet) { res.status(204).send(); return; }
  if (!(await requireProjectManage(req, res, sheet.projectId))) return;
  await db.delete(callSheetsTable).where(eq(callSheetsTable.id, id));
  res.status(204).send();
});

// ── Crew lines ──────────────────────────────────────────────────────────────

router.post("/call-sheets/:id/crew", async (req, res): Promise<void> => {
  const { id } = AddCrewInviteParams.parse(req.params);
  const parsed = AddCrewInviteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const sheet = await getSheet(id);
  if (!sheet) { res.status(404).json({ error: "Call sheet not found" }); return; }
  if (!(await requireProjectManage(req, res, sheet.projectId))) return;

  const input = parsed.data;
  // Snapshot name/email/rate from the linked roster member when not supplied,
  // so the call sheet is self-contained and the rate pre-fills from the member.
  let name = input.name?.trim();
  let email = input.email?.trim() || undefined;
  let dayRate = input.dayRate;
  const rateType = (input.rateType ?? "full") as "full" | "half";
  if (input.memberId) {
    const [m] = await db.select().from(membersTable).where(eq(membersTable.id, input.memberId)).limit(1);
    if (m) {
      if (!name) name = m.name;
      if (!email) email = m.email ?? undefined;
      if (dayRate == null) dayRate = rateType === "half" ? (m.halfDayRate ?? undefined) : (m.fullDayRate ?? undefined);
    }
  }
  if (!name) { res.status(400).json({ error: "A name is required (or pick a roster member)." }); return; }

  const [row] = await db.insert(crewInvitesTable).values({
    callSheetId: id,
    position: input.position,
    memberId: input.memberId ?? null,
    name,
    email: email ?? null,
    rateType,
    dayRate: dayRate ?? null,
    status: "pending",
  }).returning();
  res.status(201).json(fmtCrew(row));
});

router.patch("/crew/:id", async (req, res): Promise<void> => {
  const { id } = UpdateCrewInviteParams.parse(req.params);
  const parsed = UpdateCrewInviteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const found = await getCrewWithSheet(id);
  if (!found) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await requireProjectManage(req, res, found.sheet.projectId))) return;

  const [row] = await db.update(crewInvitesTable)
    .set(parsed.data)
    .where(eq(crewInvitesTable.id, id))
    .returning();
  res.json(fmtCrew(row));
});

router.delete("/crew/:id", async (req, res): Promise<void> => {
  const { id } = DeleteCrewInviteParams.parse(req.params);
  const found = await getCrewWithSheet(id);
  if (!found) { res.status(204).send(); return; }
  if (!(await requireProjectManage(req, res, found.sheet.projectId))) return;
  await db.delete(crewInvitesTable).where(eq(crewInvitesTable.id, id));
  res.status(204).send();
});

// ── Sending availability invites ──────────────────────────────────────────

/** Build the invite email for one crew line. */
async function dispatchInvite(crew: CrewRow, sheet: CallSheetRow, projectName: string): Promise<boolean> {
  if (!crew.email) return false;
  // Generate a token on first send; reuse the existing one on resend so old
  // links stay valid.
  let token = crew.token;
  if (!token) {
    token = crypto.randomBytes(24).toString("base64url");
  }
  const url = publicCrewUrl(token);
  const sheetTitle = sheet.title?.trim() || projectName;
  const greeting = escapeHtml(crew.name.split(/\s+/)[0] || crew.name);
  const position = escapeHtml(crew.position);
  const dateLine = escapeHtml(sheet.date);
  const rateLabel = crew.rateType === "half" ? "half day" : "full day";
  const rateStr = crew.dayRate != null ? ` at $${crew.dayRate.toLocaleString()} (${rateLabel})` : ` (${rateLabel})`;
  const details: string[] = [];
  if (sheet.callTime) details.push(`Call: ${escapeHtml(sheet.callTime)}`);
  if (sheet.wrapTime) details.push(`Wrap: ${escapeHtml(sheet.wrapTime)}`);
  if (sheet.location) details.push(`Location: ${escapeHtml(sheet.location)}`);
  const detailsHtml = details.length
    ? `<p style="margin:0 0 12px;color:#94a3b8">${details.join(" &nbsp;·&nbsp; ")}</p>`
    : "";

  const bodyHtml = `
    <p style="margin:0 0 12px">Hi ${greeting},</p>
    <p style="margin:0 0 12px">You're requested for <strong>${escapeHtml(sheetTitle)}</strong> on <strong>${dateLine}</strong> as <strong>${position}</strong>${escapeHtml(rateStr)}.</p>
    ${detailsHtml}
    <p style="margin:0 0 12px">Please let us know if you're available — it takes one click, no login required.</p>
  `;
  const text = `Hi ${crew.name.split(/\s+/)[0] || crew.name},

You're requested for ${sheetTitle} on ${sheet.date} as ${crew.position}${crew.dayRate != null ? ` at $${crew.dayRate} (${rateLabel})` : ` (${rateLabel})`}.
${sheet.callTime ? `Call: ${sheet.callTime}\n` : ""}${sheet.wrapTime ? `Wrap: ${sheet.wrapTime}\n` : ""}${sheet.location ? `Location: ${sheet.location}\n` : ""}
Reply with your availability here: ${url}

— Cue`;

  const result = await sendEmail({
    to: crew.email,
    subject: `[Cue] Are you available — ${sheetTitle} (${sheet.date})`,
    html: renderEmailShell({
      preheader: `Availability request for ${sheetTitle} on ${sheet.date}.`,
      heading: "Availability request",
      bodyHtml,
      ctaText: "Reply with availability",
      ctaUrl: url,
      footerNote: "If you weren't expecting this, you can ignore the email.",
    }),
    text,
  });

  if (result.ok) {
    await db.update(crewInvitesTable).set({
      token,
      status: crew.status === "pending" ? "invited" : crew.status,
      invitedAt: new Date(),
    }).where(eq(crewInvitesTable.id, crew.id));
  }
  return result.ok;
}

router.post("/call-sheets/:id/send", async (req, res): Promise<void> => {
  const { id } = SendCallSheetInvitesParams.parse(req.params);
  const sheet = await getSheet(id);
  if (!sheet) { res.status(404).json({ error: "Call sheet not found" }); return; }
  if (!(await requireProjectManage(req, res, sheet.projectId))) return;
  if (!isEmailEnabled()) {
    res.status(503).json({ error: "Email is not configured on this server. Set SENDGRID_API_KEY and EMAIL_FROM." });
    return;
  }
  const [project] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, sheet.projectId)).limit(1);
  const projectName = project?.name ?? "Project";

  // Eligible = has an email and hasn't already responded.
  const all = await loadCrew(id);
  const eligible = all.filter((c) => c.email && c.status !== "available" && c.status !== "unavailable" && c.status !== "confirmed");
  let sent = 0;
  for (const c of eligible) {
    if (await dispatchInvite(c, sheet, projectName)) sent++;
  }
  req.log.info({ callSheetId: id, eligible: eligible.length, sent }, "call sheet invites dispatched");
  res.json({ sent, total: eligible.length });
});

router.post("/crew/:id/send", async (req, res): Promise<void> => {
  const { id } = SendCrewInviteParams.parse(req.params);
  const found = await getCrewWithSheet(id);
  if (!found) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await requireProjectManage(req, res, found.sheet.projectId))) return;
  if (!found.crew.email) { res.status(400).json({ error: "This crew line has no email address." }); return; }
  if (!isEmailEnabled()) {
    res.status(503).json({ error: "Email is not configured on this server. Set SENDGRID_API_KEY and EMAIL_FROM." });
    return;
  }
  const [project] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, found.sheet.projectId)).limit(1);
  const ok = await dispatchInvite(found.crew, found.sheet, project?.name ?? "Project");
  req.log.info({ crewInviteId: id, sent: ok }, "single crew invite dispatched");
  res.json({ sent: ok ? 1 : 0, total: 1 });
});

export default router;
