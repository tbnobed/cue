import { db, membersTable, projectMembersTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { sendEmail, renderEmailShell, escapeHtml, appUrl, isEmailEnabled } from "./email.js";
import { logger } from "./logger.js";

/**
 * High-level notification fan-out for project/task lifecycle events and
 * share-link emails. Every public function in this module is fire-and-forget
 * safe — callers may `void` the returned promise without try/catch. All errors
 * are swallowed and logged so route handlers never fail because email failed.
 *
 * Recipient policy (v1):
 *   - Project events  → every member assigned to the project who has an email
 *                       and `email_notifications = true`, minus the actor.
 *   - Task events     → same set, plus the task's assignee if they're outside
 *                       the project member list.
 *   - Share-link send → caller-supplied address list; no member lookup.
 */

export interface NotifyActor {
  /** Display name shown in the email body, e.g. "Jordan". */
  name: string;
  /** Optional email used as Reply-To and to suppress self-notifications. */
  email?: string | null;
}

interface ProjectShape {
  id: number;
  name: string;
}

interface TaskShape {
  id: number;
  projectId: number;
  title: string;
  status: string;
  priority?: string | null;
  assigneeId?: number | null;
  dueDate?: string | null;
}

/** Look up the email addresses of project members who opted in. */
async function projectMemberEmails(projectId: number): Promise<string[]> {
  const rows = await db
    .select({
      email: membersTable.email,
      enabled: membersTable.emailNotifications,
    })
    .from(projectMembersTable)
    .innerJoin(membersTable, eq(projectMembersTable.memberId, membersTable.id))
    .where(eq(projectMembersTable.projectId, projectId));
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.enabled) continue;
    const e = r.email?.trim().toLowerCase();
    if (e) seen.add(e);
  }
  return Array.from(seen);
}

/** Look up the email of a single member, respecting the opt-in flag. */
async function memberEmail(memberId: number): Promise<string | null> {
  const [m] = await db
    .select({ email: membersTable.email, enabled: membersTable.emailNotifications })
    .from(membersTable)
    .where(eq(membersTable.id, memberId));
  if (!m || !m.enabled) return null;
  return m.email?.trim() || null;
}

function dropActor(recipients: string[], actorEmail?: string | null): string[] {
  if (!actorEmail) return recipients;
  const a = actorEmail.trim().toLowerCase();
  return recipients.filter((r) => r.toLowerCase() !== a);
}

// ── Project events ─────────────────────────────────────────────────────────

export type ProjectEventKind = "created" | "updated" | "deleted";

export async function notifyProjectEvent(
  kind: ProjectEventKind,
  project: ProjectShape,
  actor: NotifyActor,
  changes?: Record<string, { from: unknown; to: unknown }>,
): Promise<void> {
  if (!isEmailEnabled()) return;
  try {
    const recipients = dropActor(await projectMemberEmails(project.id), actor.email);
    if (recipients.length === 0) return;

    const verb = kind === "created" ? "created" : kind === "updated" ? "updated" : "deleted";
    const subject = `[Cue] Project ${verb}: ${project.name}`;
    const url = appUrl(`/projects/${project.id}`);

    const changeRows = changes
      ? Object.entries(changes)
          .map(([k, v]) =>
            `<tr><td style="padding:4px 12px 4px 0;color:#94a3b8;font-family:ui-monospace,Menlo,monospace;font-size:12px">${escapeHtml(k)}</td><td style="padding:4px 0;color:#e2e8f0;font-size:13px">${escapeHtml(formatVal(v.from))} → <span style="color:#a78bfa">${escapeHtml(formatVal(v.to))}</span></td></tr>`,
          )
          .join("")
      : "";

    const bodyHtml = `
      <p style="margin:0 0 12px"><strong style="color:#f8fafc">${escapeHtml(actor.name)}</strong> ${verb} the project <strong style="color:#f8fafc">${escapeHtml(project.name)}</strong>.</p>
      ${changeRows ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px">${changeRows}</table>` : ""}
    `;

    await sendEmail({
      to: recipients,
      subject,
      text: `${actor.name} ${verb} the project "${project.name}".\n\n${kind !== "deleted" ? `View it: ${url}` : ""}`,
      html: renderEmailShell({
        preheader: `${actor.name} ${verb} ${project.name}`,
        heading: `Project ${verb}`,
        bodyHtml,
        ctaText: kind !== "deleted" ? "Open project" : undefined,
        ctaUrl: kind !== "deleted" ? url : undefined,
        footerNote: "You're receiving this because you're a member of this project in Cue.",
      }),
      replyTo: actor.email || undefined,
    });
  } catch (err) {
    logger.error({ err: String(err), projectId: project.id, kind }, "notifyProjectEvent failed");
  }
}

// ── Task events ────────────────────────────────────────────────────────────

export type TaskEventKind = "created" | "updated" | "deleted";

export async function notifyTaskEvent(
  kind: TaskEventKind,
  task: TaskShape,
  project: ProjectShape,
  actor: NotifyActor,
  changes?: Record<string, { from: unknown; to: unknown }>,
): Promise<void> {
  if (!isEmailEnabled()) return;
  try {
    const set = new Set(await projectMemberEmails(project.id));
    if (task.assigneeId) {
      const a = await memberEmail(task.assigneeId);
      if (a) set.add(a.toLowerCase());
    }
    const recipients = dropActor(Array.from(set), actor.email);
    if (recipients.length === 0) return;

    const verb = kind === "created" ? "created" : kind === "updated" ? "updated" : "deleted";
    const subject = `[Cue] Task ${verb}: ${task.title}`;
    const url = appUrl(`/projects/${project.id}/tasks/${task.id}`);

    const meta: string[] = [];
    if (task.status) meta.push(`Status: ${task.status}`);
    if (task.priority) meta.push(`Priority: ${task.priority}`);
    if (task.dueDate) meta.push(`Due: ${task.dueDate}`);

    const changeRows = changes
      ? Object.entries(changes)
          .map(([k, v]) =>
            `<tr><td style="padding:4px 12px 4px 0;color:#94a3b8;font-family:ui-monospace,Menlo,monospace;font-size:12px">${escapeHtml(k)}</td><td style="padding:4px 0;color:#e2e8f0;font-size:13px">${escapeHtml(formatVal(v.from))} → <span style="color:#a78bfa">${escapeHtml(formatVal(v.to))}</span></td></tr>`,
          )
          .join("")
      : "";

    const bodyHtml = `
      <p style="margin:0 0 6px"><strong style="color:#f8fafc">${escapeHtml(actor.name)}</strong> ${verb} a task in <strong style="color:#f8fafc">${escapeHtml(project.name)}</strong>:</p>
      <p style="margin:0 0 12px;font-size:15px;color:#f8fafc"><strong>${escapeHtml(task.title)}</strong></p>
      ${meta.length ? `<p style="margin:0 0 12px;font-size:12px;color:#94a3b8;font-family:ui-monospace,Menlo,monospace">${escapeHtml(meta.join(" · "))}</p>` : ""}
      ${changeRows ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px">${changeRows}</table>` : ""}
    `;

    await sendEmail({
      to: recipients,
      subject,
      text: `${actor.name} ${verb} the task "${task.title}" in ${project.name}.\n${meta.join(" · ")}\n\n${kind !== "deleted" ? `Open: ${url}` : ""}`,
      html: renderEmailShell({
        preheader: `${actor.name} ${verb} ${task.title}`,
        heading: `Task ${verb}`,
        bodyHtml,
        ctaText: kind !== "deleted" ? "Open task" : undefined,
        ctaUrl: kind !== "deleted" ? url : undefined,
        footerNote: "You're receiving this because you're on the project or assigned to the task.",
      }),
      replyTo: actor.email || undefined,
    });
  } catch (err) {
    logger.error({ err: String(err), taskId: task.id, kind }, "notifyTaskEvent failed");
  }
}

// ── Share-link emails ──────────────────────────────────────────────────────

export interface NotifyShareLinkInput {
  url: string;
  resourceType: "project" | "task" | "document";
  resourceTitle: string;
  recipients: string[];
  message?: string;
  expiresAt?: string | null;
  actor: NotifyActor;
}

export async function notifyShareLink(
  input: NotifyShareLinkInput,
): Promise<{ ok: boolean; skipped?: boolean; sent: number; error?: string }> {
  const cleaned = input.recipients
    .map((r) => r.trim())
    .filter((r) => /.+@.+\..+/.test(r));
  if (cleaned.length === 0) return { ok: false, sent: 0, error: "no valid recipients" };
  if (!isEmailEnabled()) {
    logger.info({ to: cleaned }, "share-link email skipped — email not configured");
    return { ok: false, skipped: true, sent: 0 };
  }

  const subject = `[Cue] ${input.actor.name} shared a ${input.resourceType}: ${input.resourceTitle}`;
  const bodyHtml = `
    <p style="margin:0 0 12px"><strong style="color:#f8fafc">${escapeHtml(input.actor.name)}</strong> shared a ${escapeHtml(input.resourceType)} with you:</p>
    <p style="margin:0 0 12px;font-size:15px;color:#f8fafc"><strong>${escapeHtml(input.resourceTitle)}</strong></p>
    ${input.message
      ? `<blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #7c3aed;background:#0f1320;color:#cbd5e1;font-style:italic">${escapeHtml(input.message).replace(/\n/g, "<br>")}</blockquote>`
      : ""}
    <p style="margin:12px 0 0;font-size:12px;color:#94a3b8">This link is read-only. ${input.expiresAt ? `It expires ${escapeHtml(new Date(input.expiresAt).toLocaleString())}.` : "It does not expire."}</p>
  `;
  const text = [
    `${input.actor.name} shared a ${input.resourceType} with you: "${input.resourceTitle}"`,
    input.message ? `\n${input.message}\n` : "",
    `\nOpen: ${input.url}`,
    input.expiresAt ? `\nExpires: ${new Date(input.expiresAt).toLocaleString()}` : "",
  ].join("");

  const result = await sendEmail({
    to: cleaned,
    subject,
    text,
    html: renderEmailShell({
      preheader: `${input.actor.name} shared ${input.resourceTitle}`,
      heading: `A ${input.resourceType} was shared with you`,
      bodyHtml,
      ctaText: "Open shared link",
      ctaUrl: input.url,
      footerNote: "If you weren't expecting this email, you can safely ignore it. The link is read-only and can be revoked at any time.",
    }),
    replyTo: input.actor.email || undefined,
  });

  return { ok: result.ok, skipped: result.skipped, sent: result.ok ? cleaned.length : 0, error: result.error };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

/** Convenience: best-effort lookup of an actor description from the session userId. */
export async function actorFromUserId(userId: number | undefined | null): Promise<NotifyActor> {
  if (!userId) return { name: "Someone" };
  try {
    const [u] = await db
      .select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    return { name: u?.name?.trim() || u?.email || "Someone", email: u?.email || null };
  } catch {
    return { name: "Someone" };
  }
}

// inArray imported but kept for any future batched lookups; reference to silence lint.
void inArray;
