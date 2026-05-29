import { Router } from "express";
import { db, crewInvitesTable, callSheetsTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  GetPublicCrewInviteParams,
  RespondCrewInviteParams,
  RespondCrewInviteBody,
} from "@workspace/api-zod";

/**
 * Public, no-login crew availability reply. Resolved by the opaque token
 * emailed to the invitee. Mirrors the public-shares pattern: anonymous,
 * gated only by the unguessable token, read + a single constrained write.
 */
const router: Router = Router();

type CrewRow = typeof crewInvitesTable.$inferSelect;
type SheetRow = typeof callSheetsTable.$inferSelect;

function fmtPublic(crew: CrewRow, sheet: SheetRow, projectName: string) {
  return {
    position: crew.position,
    name: crew.name,
    rateType: crew.rateType as "full" | "half",
    dayRate: crew.dayRate ?? null,
    status: crew.status as "pending" | "invited" | "available" | "unavailable" | "confirmed",
    responseNote: crew.responseNote ?? null,
    projectName,
    title: sheet.title ?? null,
    date: sheet.date,
    callTime: sheet.callTime ?? null,
    wrapTime: sheet.wrapTime ?? null,
    location: sheet.location ?? null,
  };
}

async function resolveByToken(token: string): Promise<{ crew: CrewRow; sheet: SheetRow; projectName: string } | null> {
  const [crew] = await db.select().from(crewInvitesTable).where(eq(crewInvitesTable.token, token)).limit(1);
  if (!crew) return null;
  const [sheet] = await db.select().from(callSheetsTable).where(eq(callSheetsTable.id, crew.callSheetId)).limit(1);
  if (!sheet) return null;
  const [project] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, sheet.projectId)).limit(1);
  return { crew, sheet, projectName: project?.name ?? "Project" };
}

router.get("/crew/respond/:token", async (req, res): Promise<void> => {
  const { token } = GetPublicCrewInviteParams.parse(req.params);
  const found = await resolveByToken(token);
  if (!found) { res.status(404).json({ error: "Invalid or expired link" }); return; }
  res.json(fmtPublic(found.crew, found.sheet, found.projectName));
});

router.post("/crew/respond/:token", async (req, res): Promise<void> => {
  const { token } = RespondCrewInviteParams.parse(req.params);
  const parsed = RespondCrewInviteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const found = await resolveByToken(token);
  if (!found) { res.status(404).json({ error: "Invalid or expired link" }); return; }

  // Once a producer has confirmed the booking, the public link can no longer
  // flip the status — otherwise anyone holding the token could silently
  // downgrade a locked-in crew member. The invitee can still see the sheet
  // (GET), they just can't overwrite a confirmation.
  if (found.crew.status === "confirmed") {
    req.log.info({ crewInviteId: found.crew.id }, "public crew response ignored — already confirmed");
    res.status(409).json({ error: "This booking has already been confirmed. Contact the producer to make changes." });
    return;
  }

  const status = parsed.data.answer === "available" ? "available" : "unavailable";
  const [updated] = await db.update(crewInvitesTable)
    .set({
      status,
      responseNote: parsed.data.note?.trim() || null,
      respondedAt: new Date(),
    })
    .where(eq(crewInvitesTable.id, found.crew.id))
    .returning();
  req.log.info({ crewInviteId: found.crew.id, status }, "public crew availability response recorded");
  res.json(fmtPublic(updated, found.sheet, found.projectName));
});

export default router;
