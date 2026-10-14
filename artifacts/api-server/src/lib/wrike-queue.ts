import { randomUUID, randomInt } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, projectWrikeLinksTable as links, wrikeSyncRunsTable as jobs } from "@workspace/db";
import { checkWrikeSyncOwner } from "./wrike-policy";
import { executeWrikeImport } from "./wrike-sync";
import { safeWrikeError } from "./wrike-client";
import { WrikeError, requireWrikeConfig, wrikeConfig } from "./wrike-security";
import { logger } from "./logger";

export const activeWrikeStates = ["queued", "running", "retry_wait"];
export async function enqueueWrikeSync(projectId: number, actorId: number | null, automatic = false) {
  requireWrikeConfig();
  return db.transaction(async tx => {
    const [link] = await tx.select().from(links).where(eq(links.projectId, projectId)).for("update");
    if (!link?.connectionId) throw new WrikeError("Link a personal Wrike connection before importing.", 409);
    if (automatic && (!link.autoSync || (link.nextSyncAt && link.nextSyncAt.getTime() > Date.now()))) return null;
    await checkWrikeSyncOwner(link.connectionId, projectId, tx);
    const [existing] = await tx.select().from(jobs).where(and(eq(jobs.projectId, projectId), inArray(jobs.status, activeWrikeStates)));
    if (existing) {
      // A long queue must not let the same due projects monopolize every
      // scheduler batch while other users are waiting to be enqueued.
      if (automatic) await tx.update(links).set({ nextSyncAt: new Date(Date.now() + 300_000) }).where(eq(links.projectId, projectId));
      return existing;
    }
    const [job] = await tx.insert(jobs).values({
      projectId, actorId, connectionId: link.connectionId, linkRevision: link.revision, status: "queued",
    }).returning();
    await tx.update(links).set({ syncStatus: "queued", lastError: null, nextSyncAt: new Date(Date.now() + 300_000) }).where(eq(links.projectId, projectId));
    return job;
  });
}

export async function claimWrikeJob() {
  return db.transaction(async tx => {
    // Global admission lock makes the four-worker cap true across replicas.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(61975, 0)`);
    const leaseToken = randomUUID();
    const result = await tx.execute(sql`
      UPDATE wrike_sync_runs SET status = 'running', attempts = attempts + 1,
        lease_token = ${leaseToken}, lease_until = now() + interval '5 minutes'
      WHERE id = (
        SELECT j.id FROM wrike_sync_runs j
        WHERE j.status IN ('queued','retry_wait') AND j.available_at <= now()
          AND (SELECT count(*) FROM wrike_sync_runs WHERE status = 'running' AND lease_until > now()) < 4
          AND NOT EXISTS (SELECT 1 FROM wrike_sync_runs busy
            WHERE busy.connection_id = j.connection_id AND busy.status = 'running' AND busy.lease_until > now())
        ORDER BY j.available_at, j.id FOR UPDATE SKIP LOCKED LIMIT 1
      ) RETURNING id`);
    const id = (result.rows[0] as { id: number } | undefined)?.id;
    if (!id) return null;
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, id));
    return job;
  });
}

export async function settleWrikeFailure(job: typeof jobs.$inferSelect, error: unknown) {
  const message = safeWrikeError(error);
  const code = error instanceof WrikeError ? error.status : 502;
  const retry = [429, 502, 503, 504].includes(code) && job.attempts < 5;
  const delay = Math.max(error instanceof WrikeError ? error.retryAfterMs : 0, Math.min(900_000, 30_000 * 2 ** Math.max(0, job.attempts - 1)) + randomInt(5000));
  await db.transaction(async tx => {
    // Consistent link -> job ordering with import commit/cancellation.
    const [link] = await tx.select().from(links).where(eq(links.projectId, job.projectId)).for("update");
    const [saved] = await tx.update(jobs).set({
      status: retry ? "retry_wait" : "error", error: message,
      availableAt: new Date(Date.now() + delay), finishedAt: retry ? null : new Date(),
      leaseToken: null, leaseUntil: null,
    }).where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.leaseToken, job.leaseToken!))).returning();
    if (!saved || !link || link.revision !== job.linkRevision) return;
    const permanent = ![429, 502, 503, 504].includes(code);
    await tx.update(links).set({
      syncStatus: retry ? "retry_wait" : permanent ? "paused" : "error", lastError: message,
      ...(permanent ? { autoSync: false } : {}),
      nextSyncAt: new Date(Date.now() + 900_000),
    }).where(eq(links.projectId, job.projectId));
  });
}

export async function processWrikeJob(job: typeof jobs.$inferSelect) {
  const heartbeat = setInterval(() => {
    db.update(jobs).set({ leaseUntil: new Date(Date.now() + 300_000) })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.leaseToken, job.leaseToken!)))
      .catch(() => logger.warn({ jobId: job.id }, "Wrike lease renewal failed"));
  }, 30_000);
  heartbeat.unref();
  try {
    await db.update(links).set({ syncStatus: "running", lastAttemptAt: new Date() })
      .where(and(eq(links.projectId, job.projectId), eq(links.revision, job.linkRevision!)));
    await executeWrikeImport(job);
  } catch (error) {
    await settleWrikeFailure(job, error);
    logger.warn({ jobId: job.id, projectId: job.projectId, message: safeWrikeError(error) }, "Wrike import did not complete");
  } finally { clearInterval(heartbeat); }
}

export async function recoverWrikeJobs() {
  const expired = await db.select().from(jobs).where(and(eq(jobs.status, "running"), sql`${jobs.leaseUntil} < now()`)).limit(100);
  for (const job of expired) {
    // Failure settlement checks the token; heartbeat recovery races must not
    // revoke a lease that was already renewed.
    await db.transaction(async tx => {
      await tx.select().from(links).where(eq(links.projectId, job.projectId)).for("update");
      const rows = await tx.update(jobs).set({
        status: job.attempts < 5 ? "retry_wait" : "error",
        error: "Worker interrupted; import will retry safely unless its attempt limit was reached.",
        availableAt: new Date(), leaseToken: null, leaseUntil: null,
        finishedAt: job.attempts < 5 ? null : new Date(),
      }).where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.leaseToken, job.leaseToken!), sql`${jobs.leaseUntil} < now()`)).returning();
      if (rows.length) await tx.update(links).set({
        syncStatus: job.attempts < 5 ? "retry_wait" : "error", lastError: "Previous worker was interrupted.",
      }).where(and(eq(links.projectId, job.projectId), eq(links.revision, job.linkRevision!)));
    });
  }
}

export function startWrikeScheduler() {
  let polling = false, scheduling = false, localActive = 0;
  const poll = setInterval(async () => {
    if (polling || localActive >= 4 || !wrikeConfig().configured) return;
    polling = true;
    try {
      while (localActive < 4) {
        const job = await claimWrikeJob();
        if (!job) break;
        localActive++;
        void processWrikeJob(job).catch(() => logger.error({ jobId: job.id }, "Wrike worker failed; lease recovery will retry"))
          .finally(() => { localActive--; });
      }
    } catch { logger.error("Wrike queue poll failed; check migrations/database"); }
    finally { polling = false; }
  }, 2000);
  const schedule = setInterval(async () => {
    if (scheduling || !wrikeConfig().configured) return;
    scheduling = true;
    try {
      await recoverWrikeJobs();
      const due = await db.select().from(links).where(and(eq(links.autoSync, true), sql`(${links.nextSyncAt} IS NULL OR ${links.nextSyncAt} <= now())`)).limit(100);
      for (const link of due) {
        try { await enqueueWrikeSync(link.projectId, null, true); }
        catch (error) {
          const permanent = error instanceof WrikeError && [401, 403, 404, 409].includes(error.status);
          await db.update(links).set({
            syncStatus: permanent ? "paused" : "error", lastError: safeWrikeError(error),
            nextSyncAt: new Date(Date.now() + 300_000), ...(permanent ? { autoSync: false } : {}),
          }).where(and(eq(links.projectId, link.projectId), eq(links.revision, link.revision)));
        }
      }
    } catch { logger.error("Wrike scheduler failed; check migrations/database"); }
    finally { scheduling = false; }
  }, 15_000);
  poll.unref(); schedule.unref();
  return () => { clearInterval(poll); clearInterval(schedule); };
}
