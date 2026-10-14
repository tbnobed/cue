import { z } from "zod";
import { and, eq } from "drizzle-orm";
import {
  db, projectWrikeLinksTable, wrikeConnectionsTable, wrikeSyncRunsTable,
  wrikeTaskLinksTable, tasksTable, membersTable, projectMembersTable, usersTable, projectsTable,
} from "@workspace/db";
import { getWrikeFolder, wrikeGet } from "./wrike-client";
import { WrikeError, validWrikeUrl } from "./wrike-security";
import { checkWrikeSyncOwner } from "./wrike-policy";

const taskSchema = z.object({
  id: z.string().min(1), title: z.string(), description: z.string().optional(),
  status: z.enum(["Active", "Deferred", "Completed", "Cancelled"]),
  importance: z.enum(["High", "Low", "Normal"]),
  permalink: z.string(), responsibleIds: z.array(z.string()).optional(),
  dates: z.object({ due: z.string().optional() }).passthrough().optional(),
  completedDate: z.string().optional(),
});
const taskPage = z.object({ data: z.array(taskSchema), nextPageToken: z.string().nullish() });
const contactPage = z.object({ data: z.array(z.object({
  id: z.string(), profiles: z.array(z.object({ email: z.string().optional() })).optional(),
})) });

export function taskFields(task: z.infer<typeof taskSchema>, assigneeId: number | null) {
  const cleanDescription = (task.description ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]*>/g, "");
  const source = validWrikeUrl(task.permalink) ? task.permalink : `Wrike task ${task.id}`;
  const rawDue = task.dates?.due?.slice(0, 10);
  const dueDate = rawDue && /^\d{4}-\d{2}-\d{2}$/.test(rawDue) && !isNaN(Date.parse(rawDue)) ? rawDue : null;
  const completed = task.completedDate && !isNaN(Date.parse(task.completedDate)) ? new Date(task.completedDate) : null;
  return {
    title: task.title,
    description: `${cleanDescription}\n\nSource: ${source}\nWrike status: ${task.status}. Imported fields are managed in Wrike.${task.responsibleIds?.length && !assigneeId ? "\nWrike assignee(s) could not be mapped to one existing Cue project member." : ""}`,
    status: task.status === "Completed" ? "done" : task.status === "Cancelled" ? "blocked" : "todo",
    priority: task.importance === "High" ? "high" : task.importance === "Low" ? "low" : "medium",
    dueDate, completedAt: task.status === "Completed" ? completed : null, assigneeId,
  };
}

export async function executeWrikeImport(run: typeof wrikeSyncRunsTable.$inferSelect) {
    const projectId = run.projectId;
    const [link] = await db.select().from(projectWrikeLinksTable).where(eq(projectWrikeLinksTable.projectId, projectId));
    if (!link || !run.connectionId || link.connectionId !== run.connectionId || link.revision !== run.linkRevision) {
      throw new WrikeError("Project sync ownership changed. Queue a new import.", 409);
    }
    const connection = await checkWrikeSyncOwner(run.connectionId, projectId);
    const folder = await getWrikeFolder(connection.id, link.remoteId);
    const deadline = Date.now() + 120_000;
    const tasks = new Map<string, z.infer<typeof taskSchema>>();
    const seenTokens = new Set<string>();
    let token: string | undefined;
    let pages = 0;
    do {
      if (++pages > 100 || Date.now() > deadline) throw new WrikeError("Wrike import exceeded its safe limit. Use a smaller project and retry.");
      const query = new URLSearchParams({ descendants: "true", subTasks: "true", pageSize: "1000", fields: '["description","responsibleIds"]' });
      if (token) query.set("nextPageToken", token);
      const page = await wrikeGet(connection.id, `/folders/${encodeURIComponent(link.remoteId)}/tasks?${query}`, taskPage);
      for (const task of page.data) tasks.set(task.id, task);
      token = page.nextPageToken || undefined;
      if (token && seenTokens.has(token)) throw new WrikeError("Wrike pagination repeated. Import stopped without changing tasks.");
      if (token) seenTokens.add(token);
    } while (token);

    const ids = [...new Set([...tasks.values()].flatMap(t => t.responsibleIds ?? []))];
    const emails = new Map<string, Set<string>>();
    for (let start = 0; start < ids.length; start += 100) {
      if (Date.now() > deadline) throw new WrikeError("Wrike import timed out before completion. Retry or use a smaller project.");
      const contacts = await wrikeGet(connection.id, `/contacts/${ids.slice(start, start + 100).map(encodeURIComponent).join(",")}`, contactPage);
      for (const c of contacts.data) emails.set(c.id, new Set((c.profiles ?? []).flatMap(p => p.email ? [p.email.toLowerCase()] : [])));
    }
    const members = await db.select({ id: membersTable.id, email: membersTable.email })
      .from(membersTable).innerJoin(projectMembersTable, eq(projectMembersTable.memberId, membersTable.id))
      .where(eq(projectMembersTable.projectId, projectId));
    const result = await db.transaction(async tx => {
      // Recheck authorization at commit, not just when the job was queued.
      const [owner] = await tx.select().from(usersTable).where(eq(usersTable.id, connection.ownerUserId)).for("share");
      const [project] = await tx.select().from(projectsTable).where(eq(projectsTable.id, projectId)).for("share");
      if (!owner?.isActive || !project || (!owner.isAdmin && project.ownerUserId !== owner.id)) {
        throw new WrikeError("The sync owner no longer manages this project. Nothing was imported.", 409);
      }
      // Prevent disconnect/reconnect from racing the final import commit.
      const [currentConnection] = await tx.select().from(wrikeConnectionsTable).where(eq(wrikeConnectionsTable.id, connection.id)).for("share");
      if (currentConnection?.generation !== connection.generation) throw new WrikeError("Wrike connection changed during import. Retry with the current connection.", 409);
      const [currentLink] = await tx.select().from(projectWrikeLinksTable).where(eq(projectWrikeLinksTable.projectId, projectId)).for("update");
      if (!currentLink || currentLink.connectionId !== connection.id || currentLink.revision !== run.linkRevision) {
        throw new WrikeError("Wrike sync lease expired or the link changed. Retry.", 409);
      }
      const [currentJob] = await tx.select().from(wrikeSyncRunsTable).where(eq(wrikeSyncRunsTable.id, run.id)).for("update");
      if (currentJob?.status !== "running" || currentJob.leaseToken !== run.leaseToken || !currentJob.leaseUntil || currentJob.leaseUntil.getTime() < Date.now()) {
        throw new WrikeError("Wrike job was cancelled or its lease expired. Nothing was imported.", 409);
      }
      const mappings = await tx.select().from(wrikeTaskLinksTable).where(eq(wrikeTaskLinksTable.projectId, projectId));
      const byId = new Map(mappings.map(m => [m.remoteId, m]));
      let created = 0, updated = 0, skipped = 0;
      for (const task of tasks.values()) {
        const assignees = task.responsibleIds ?? [];
        const matches = assignees.length === 1 ? members.filter(m => m.email && emails.get(assignees[0])?.has(m.email.toLowerCase())) : [];
        const fields = taskFields(task, matches.length === 1 ? matches[0].id : null);
        const mapping = byId.get(task.id);
        let taskId: number;
        if (mapping) {
          const [saved] = await tx.update(tasksTable).set({ ...fields, updatedAt: new Date() })
            .where(and(eq(tasksTable.id, mapping.taskId), eq(tasksTable.projectId, projectId))).returning({ id: tasksTable.id });
          if (!saved) { skipped++; continue; } // Locally moved tasks are not hijacked.
          taskId = saved.id; updated++;
        } else {
          const [saved] = await tx.insert(tasksTable).values({ projectId, ...fields }).returning({ id: tasksTable.id });
          taskId = saved.id; created++;
        }
        await tx.insert(wrikeTaskLinksTable).values({ projectId, remoteId: task.id, taskId, permalink: task.permalink, remoteStatus: task.status })
          .onConflictDoUpdate({ target: [wrikeTaskLinksTable.projectId, wrikeTaskLinksTable.remoteId], set: {
            permalink: task.permalink, remoteStatus: task.status, lastSyncedAt: new Date(),
          } });
      }
      // Wrike-deleted/moved tasks are retained locally; never interpret absence as deletion.
      skipped += mappings.filter(m => !tasks.has(m.remoteId)).length;
      await tx.update(projectWrikeLinksTable).set({
        remoteTitle: folder.title, url: validWrikeUrl(folder.permalink) ? folder.permalink : link.url,
        syncStatus: "success", lastSyncedAt: new Date(), lastError: null, lockToken: null, lockedUntil: null,
        nextSyncAt: new Date(Date.now() + 5 * 60_000),
      }).where(eq(projectWrikeLinksTable.projectId, projectId));
      const [finished] = await tx.update(wrikeSyncRunsTable).set({
        status: "success", created, updated, skipped, finishedAt: new Date(), leaseToken: null, leaseUntil: null, error: null,
      }).where(eq(wrikeSyncRunsTable.id, run.id)).returning();
      return finished;
    });
    return result;
}
