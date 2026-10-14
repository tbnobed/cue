import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import {
  db, releasesTable as releases, releaseTemplatesTable as templates, releaseSigningTable as signing,
  releaseEventsTable as events, projectsTable, activityTable, usersTable,
  type SigningPerson,
} from "@workspace/db";
import {
  docuseal, getSubmission, remoteTemplateSchema, templateFingerprint, signingConfig,
  SigningError, signingError, downloadSignedPdf, type RemoteSubmission,
} from "./docuseal-client";
import { storeRelease, removeUncommittedRelease } from "./release-storage";
import { logger } from "./logger";
import { prefillReleaseFields } from "./docuseal-fields";

export function publicSigning(row: typeof signing.$inferSelect | undefined) {
  if (!row) return { state: "not_sent", signers: [] };
  const { requestKey: _, releaseId: _r, nextCheckAt: _n, createdAt: _c, ...safe } = row;
  return safe;
}
export async function readSigning(id: number) {
  const [row] = await db.select().from(signing).where(eq(signing.releaseId, id));
  return row;
}

export function verifySubmission(remote: RemoteSubmission, local: typeof signing.$inferSelect) {
  if (remote.submitters.length !== local.signers.length ||
      local.signers.some(person => !remote.submitters.some(s =>
        s.role === person.role && s.email.toLowerCase() === person.email.toLowerCase() &&
        s.external_id === local.requestKey))) {
    throw new SigningError("The DocuSeal submission does not match this release and its required signers. Filing blocked.", 409);
  }
}

export async function sendForSigning(id: number, templateId: number, additional: SigningPerson[], actorId: number) {
  const [approved] = await db.select().from(templates).where(and(eq(templates.id, templateId), eq(templates.active, true)));
  if (!approved) throw new SigningError("Select an active approved release template.", 400);
  const parsed = remoteTemplateSchema.safeParse(await docuseal(`/templates/${approved.remoteId}`));
  if (!parsed.success) throw new SigningError("DocuSeal returned invalid template details.");
  const remote = parsed.data;
  if (remote.archived_at || templateFingerprint(remote) !== approved.fingerprint) {
    throw new SigningError("This template changed in DocuSeal. An administrator must approve its current version before sending.", 409);
  }
  // Commit the intent BEFORE the external call. If delivery is uncertain, never
  // silently re-send and risk creating duplicate signature requests.
  const context = await db.transaction(async tx => {
    const [release] = await tx.select().from(releases).where(eq(releases.id, id)).for("update");
    if (!release || release.status !== "draft") throw new SigningError("Only a draft release can be sent.", 409);
    const [existing] = await tx.select().from(signing).where(eq(signing.releaseId, id));
    if (existing) throw new SigningError("This release already has a signing request. Refresh its status instead of sending again.", 409);
    const [active] = await tx.select().from(templates).where(eq(templates.id, templateId)).for("share");
    if (!active?.active) throw new SigningError("This template has been retired.", 409);
    const people = approved.roles.map(role => role === approved.guestRole ?
      { role, name: release.guestName, email: release.guestEmail } :
      additional.find(p => p.role === role));
    if (people.some(p => !p) || additional.some(p => !approved.roles.includes(p.role)) ||
        new Set(additional.map(p => p.role)).size !== additional.length) {
      throw new SigningError("Provide exactly one signer for every additional template role.", 400);
    }
    const signers = people as SigningPerson[];
    const [project] = await tx.select().from(projectsTable).where(eq(projectsTable.id, release.projectId));
    const [actor] = await tx.select().from(usersTable).where(eq(usersTable.id, actorId));
    const [job] = await tx.insert(signing).values({
      releaseId: id, templateId, requestKey: randomUUID(), signers,
      nextCheckAt: new Date(Date.now() + 120_000),
    }).returning();
    await tx.update(releases).set({ status: "awaiting_signatures", templateVersion: approved.version, updatedAt: new Date() }).where(eq(releases.id, id));
    await tx.insert(events).values({ releaseId: id, actorId, action: "docuseal:send-requested" });
    return { release, project, actor, job };
  });
  try {
    const values: Record<string, string> = {
      GuestName: context.release.guestName, GuestEmail: context.release.guestEmail,
      ProjectName: context.project.name, ReleaseTitle: context.release.title,
      ProductionDate: context.release.productionDate || "",
    };
    const result = await docuseal("/submissions", "POST", {
      template_id: approved.remoteId, send_email: true, order: "random",
      // DocuSeal sends its normal completion copy to all signers; also notify
      // the initiating producer using its own SMTP configuration.
      ...(context.actor.email ? { bcc_completed: context.actor.email } : {}),
      message: { subject: `${context.project.name}: ${context.release.title}`, body: `Please review and sign the release for ${context.project.name}: ${context.release.title}.\n\n{{submitter.link}}` },
      submitters: context.job.signers.map(person => {
        const uuid = remote.submitters.find(s => s.name === person.role)!.uuid;
        return {
          ...person, external_id: context.job.requestKey,
          fields: prefillReleaseFields(remote.fields, uuid,
            remote.submitters.find(s => s.name === approved.guestRole)!.uuid, values),
        };
      }),
    });
    const created = z.array(z.object({ submission_id: z.number().int().positive() })).min(1).parse(result);
    const submissionId = created[0].submission_id;
    if (created.some(s => s.submission_id !== submissionId)) throw new SigningError("DocuSeal returned inconsistent submission IDs.");
    await db.update(signing).set({
      submissionId, state: "awaiting_signatures", lastError: null,
      nextCheckAt: new Date(), updatedAt: new Date(),
    }).where(eq(signing.releaseId, id));
  } catch (error) {
    await db.update(signing).set({
      state: "needs_review", lastError: `${signingError(error)} Delivery may have occurred. Check DocuSeal and reconcile the submission; do not send a duplicate.`,
      updatedAt: new Date(),
    }).where(eq(signing.releaseId, id));
  }
  return publicSigning(await readSigning(id));
}

// Row locks are held while consulting DocuSeal so competing manual/background
// refreshes cannot archive twice or send duplicate reminders across replicas.
export async function refreshSigning(id: number, remind = false) {
  return db.transaction(async tx => {
    // Same lock order as release edits and send.
    const [release] = await tx.select().from(releases).where(eq(releases.id, id)).for("update");
    const [local] = await tx.select().from(signing).where(eq(signing.releaseId, id)).for("update");
    if (!release || !local) throw new SigningError("This release has not been sent to DocuSeal.", 404);
    if (local.state === "archived") return publicSigning(local);
    if (!local.submissionId) {
      if (local.state === "sending" && Date.now() - local.createdAt.getTime() > 120_000) {
        const [updated] = await tx.update(signing).set({
          state: "needs_review", lastError: "The send was interrupted. Check DocuSeal and reconcile its submission ID before taking further action.",
          updatedAt: new Date(),
        }).where(eq(signing.releaseId, id)).returning();
        return publicSigning(updated);
      }
      return publicSigning(local);
    }
    let stored: Awaited<ReturnType<typeof storeRelease>> | undefined;
    let completed = false;
    try {
      const remote = await getSubmission(local.submissionId);
      verifySubmission(remote, local);
      const signers = local.signers.map(p => ({ ...p, status: remote.submitters.find(s => s.role === p.role)!.status }));
      completed = remote.status === "completed" && !!remote.completed_at &&
        remote.submitters.every(s => s.status === "completed" && !!s.completed_at);
      let state = remote.status === "declined" ? "declined" : remote.status === "expired" ? "expired" : "awaiting_signatures";
      if (completed) {
        if (!remote.combined_document_url) throw new SigningError("Signed PDF with audit certificate is not ready in DocuSeal. Cue will retry filing.");
        const bytes = await downloadSignedPdf(remote.combined_document_url);
        stored = await storeRelease(bytes);
        const clean = (s: string) => s.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 70);
        const fileName = `${release.productionDate ?? new Date().toISOString().slice(0, 10)}_project-${release.projectId}_${clean(release.guestName)}_Release-${id}.pdf`;
        await tx.update(releases).set({
          status: "archived", storageKey: stored.key, sha256: stored.sha256, fileSize: bytes.length,
          fileName, archivedAt: new Date(), archivedBy: release.createdBy, updatedAt: new Date(),
        }).where(eq(releases.id, id));
        await tx.insert(events).values({ releaseId: id, actorId: release.createdBy, action: "docuseal:all-signers-completed-and-archived" });
        const [project] = await tx.select().from(projectsTable).where(eq(projectsTable.id, release.projectId));
        await tx.insert(activityTable).values({
          type: "release_archived", projectId: release.projectId, projectName: project.name,
          entityId: id, entityName: release.title, actorName: "DocuSeal",
          message: `Signed release for ${release.guestName} has been verified and archived in Cue.`,
        });
        state = "archived";
      }
      let lastReminderAt = local.lastReminderAt;
      let reminderCount = local.reminderCount;
      if (remind && !completed && state !== "awaiting_signatures") {
        throw new SigningError("Declined or expired submissions cannot receive reminders.", 409);
      }
      const due = Date.now() - (lastReminderAt ?? local.createdAt).getTime() >= 3 * 86400_000;
      if (!completed && state === "awaiting_signatures" && (remind || (due && reminderCount < 3))) {
        if (lastReminderAt && Date.now() - lastReminderAt.getTime() < 3600_000) {
          if (remind) throw new SigningError("Wait at least one hour between reminders.", 409);
        } else {
          // Reserve the batch even if a later recipient fails, so retries do not
          // repeatedly email the recipients whose requests already succeeded.
          lastReminderAt = new Date();
          reminderCount++;
          await tx.update(signing).set({ lastReminderAt, reminderCount }).where(eq(signing.releaseId, id));
          await tx.insert(events).values({ releaseId: id, actorId: release.createdBy, action: "docuseal:reminders-requested" });
          for (const person of remote.submitters.filter(s => s.status !== "completed" && s.status !== "declined")) {
            await docuseal(`/submitters/${person.id}`, "PUT", { send_email: true });
          }
        }
      }
      const [updated] = await tx.update(signing).set({
        state, signers, lastError: null, lastReminderAt, reminderCount,
        nextCheckAt: new Date(Date.now() + 60_000), updatedAt: new Date(),
      }).where(eq(signing.releaseId, id)).returning();
      return publicSigning(updated);
    } catch (error) {
      if (stored) {
        // A database failure must roll the transaction back. Do not commit
        // a release referencing a removed file.
        await removeUncommittedRelease(stored.key);
        throw error;
      }
      const [updated] = await tx.update(signing).set({
        state: completed ? "filing_failed" : local.state,
        lastError: signingError(error), nextCheckAt: new Date(Date.now() + 5 * 60_000), updatedAt: new Date(),
      }).where(eq(signing.releaseId, id)).returning();
      if (completed) await tx.update(releases).set({ status: "signed", updatedAt: new Date() }).where(eq(releases.id, id));
      return publicSigning(updated);
    }
  });
}

export async function reconcileSigning(id: number, submissionId: number) {
  const local = await readSigning(id);
  if (!local || local.state !== "needs_review" || local.submissionId) {
    throw new SigningError("Only an uncertain send can be reconciled.", 409);
  }
  const remote = await getSubmission(submissionId);
  verifySubmission(remote, local);
  await db.update(signing).set({
    submissionId, state: "awaiting_signatures", lastError: null, nextCheckAt: new Date(), updatedAt: new Date(),
  }).where(and(eq(signing.releaseId, id), eq(signing.state, "needs_review")));
  return refreshSigning(id);
}

let running = false;
export function startSigningScheduler() {
  if (!signingConfig().configured) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // Claim a bounded batch with SKIP LOCKED. nextCheckAt is a durable lease;
      // a stopped process is retried after five minutes, not lost.
      const ids = await db.transaction(async tx => {
        const rows = await tx.select({ id: signing.releaseId }).from(signing).where(and(
          inArray(signing.state, ["sending", "awaiting_signatures", "filing_failed"]),
          lte(signing.nextCheckAt, new Date()),
        )).orderBy(signing.nextCheckAt).limit(10).for("update", { skipLocked: true });
        if (rows.length) await tx.update(signing).set({ nextCheckAt: new Date(Date.now() + 5 * 60_000) }).where(inArray(signing.releaseId, rows.map(r => r.id)));
        return rows.map(r => r.id);
      });
      for (const id of ids) {
        try { await refreshSigning(id); }
        catch { logger.error({ releaseId: id }, "DocuSeal reconciliation failed; retry scheduled"); }
      }
    } catch { logger.error("DocuSeal scheduler failed; check database migrations"); }
    finally { running = false; }
  };
  setInterval(() => { void tick(); }, 15_000).unref();
  void tick();
}
