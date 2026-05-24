// Project-level access control.
//
// ─── Model ────────────────────────────────────────────────────────────────
// Three role tiers, no per-task ACL, no custom roles. See `replit.md`.
//
//   admin                 — users.is_admin = true. Sees everything.
//   project owner         — projects.owner_user_id = user.id. Manages project.
//   project member        — users.id linked to a members row that's assigned
//                           to the project via project_members. Read+edit
//                           tasks/docs/comments, no project-metadata edits.
//
// ─── How users map to projects ────────────────────────────────────────────
// `users` and `members` are different tables (members is a roster, including
// no-login contractors). The link is `members.user_id` — set on signup,
// login, and member create/update by `linkUserToMembersByEmail()`. A user
// can be linked to 0..N members (one per email-match); access is the union.
//
// ─── Helpers ──────────────────────────────────────────────────────────────
//   visibleProjectIds(user)  — for SQL filtering on list endpoints.
//                              Returns "all" for admin (caller skips filter).
//   canAccessProject(...)    — read-or-edit gate for project/tasks/docs/etc.
//   canManageProject(...)    — project-metadata / share-link / transfer gate.
//   linkUserToMembersByEmail — email-match auto-linker. Idempotent. Only
//                              overwrites NULL user_id (never steals a link).

import type { Request, Response } from "express";
import { db, membersTable, projectsTable, projectMembersTable, tasksTable, documentsTable, usersTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";

export interface AuthUser {
  id: number;
  isAdmin: boolean;
}

/**
 * Per-request memoization of project-access decisions. requireAuth runs
 * before every request and replaces this Map, so cross-request state can
 * never leak. We use it because some list endpoints (dashboard, tasks)
 * call canAccessProject in a loop over the same handful of project ids.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      aclCache?: {
        access: Map<number, boolean>;
        manage: Map<number, boolean>;
        visible?: number[] | "all";
      };
    }
  }
}

function aclCacheFor(req: Request) {
  if (!req.aclCache) req.aclCache = { access: new Map(), manage: new Map() };
  return req.aclCache;
}

/**
 * Project ids the user can see. Returns the literal string `"all"` for
 * admins (callers must skip filtering — do NOT translate to an empty list).
 *
 * For non-admins, returns the union of:
 *   • projects owned by the user
 *   • projects assigned to any member row linked to the user
 */
export async function visibleProjectIds(user: AuthUser): Promise<number[] | "all"> {
  if (user.isAdmin) return "all";

  // Single SQL union — cheaper than two round-trips.
  const rows = await db.execute<{ id: number }>(sql`
    SELECT id FROM ${projectsTable} WHERE owner_user_id = ${user.id}
    UNION
    SELECT pm.project_id AS id
      FROM ${projectMembersTable} pm
      JOIN ${membersTable} m ON m.id = pm.member_id
     WHERE m.user_id = ${user.id}
  `);
  // drizzle's pg execute returns either `{ rows: [...] }` or an array;
  // normalize both shapes.
  const list = Array.isArray(rows) ? rows : (rows as { rows?: { id: number }[] }).rows ?? [];
  return list.map((r) => Number(r.id));
}

/**
 * Cached version of visibleProjectIds() for the current request.
 * Multiple list endpoints (dashboard, tasks, documents…) ask for the same
 * answer — compute once per request.
 */
export async function visibleProjectIdsCached(req: Request): Promise<number[] | "all"> {
  const cache = aclCacheFor(req);
  if (cache.visible !== undefined) return cache.visible;
  const v = await visibleProjectIds(req.authUser!);
  cache.visible = v;
  return v;
}

/**
 * True if the user may read/edit content under the given project
 * (project metadata read, its tasks, docs, comments, milestones, etc.).
 */
export async function canAccessProject(user: AuthUser, projectId: number): Promise<boolean> {
  if (user.isAdmin) return true;
  const [owned] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.ownerUserId, user.id)))
    .limit(1);
  if (owned) return true;
  const [assigned] = await db
    .select({ id: projectMembersTable.id })
    .from(projectMembersTable)
    .innerJoin(membersTable, eq(membersTable.id, projectMembersTable.memberId))
    .where(and(eq(projectMembersTable.projectId, projectId), eq(membersTable.userId, user.id)))
    .limit(1);
  return Boolean(assigned);
}

/**
 * True if the user may MANAGE the project (edit metadata, manage members,
 * create/email/revoke share links, transfer ownership, delete). Admin OR
 * owner — being a project member is not enough.
 */
export async function canManageProject(user: AuthUser, projectId: number): Promise<boolean> {
  if (user.isAdmin) return true;
  const [owned] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.ownerUserId, user.id)))
    .limit(1);
  return Boolean(owned);
}

/**
 * Auto-link a user to every existing roster entry that matches their email
 * (case-insensitive) and is not already linked to someone. Idempotent —
 * never overwrites an existing user_id (so two users with the same email
 * can't fight over a member row, and a manual admin link can't be clobbered
 * by a re-login).
 *
 * Call on:
 *   • POST /auth/signup        — admin creates a local account
 *   • POST /auth/login         — local login (links a member added BEFORE the user existed)
 *   • GET  /auth/callback      — OIDC first login or every login (idempotent)
 *   • POST /members            — admin creates a roster entry with an email
 *   • PATCH /members/:id       — admin sets/changes a member email
 *
 * Returns the number of member rows linked (for logging / tests).
 */
export async function linkUserToMembersByEmail(userId: number, email: string | null | undefined): Promise<number> {
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized) return 0;
  const updated = await db
    .update(membersTable)
    .set({ userId })
    .where(and(
      eq(sql`lower(${membersTable.email})`, normalized),
      isNull(membersTable.userId),
    ))
    .returning({ id: membersTable.id });
  return updated.length;
}

/**
 * Reverse direction — when a NEW member is created with an email, link it
 * to the existing user with that email if one exists. Same idempotency rule:
 * never overwrites if member is already linked.
 */
export async function linkMemberToUserByEmail(memberId: number, email: string | null | undefined): Promise<boolean> {
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized) return false;
  const [member] = await db.select({ id: membersTable.id, userId: membersTable.userId }).from(membersTable).where(eq(membersTable.id, memberId)).limit(1);
  if (!member || member.userId) return false;
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(sql`lower(${usersTable.email})`, normalized))
    .limit(1);
  if (!user) return false;
  // Atomic guard: only set user_id if still NULL. Prevents a concurrent
  // admin link or parallel auto-link from being clobbered between the
  // read above and the write here.
  const updated = await db.update(membersTable)
    .set({ userId: user.id })
    .where(and(eq(membersTable.id, memberId), isNull(membersTable.userId)))
    .returning({ id: membersTable.id });
  return updated.length > 0;
}

// ─── Express guards ─────────────────────────────────────────────────────
// Why these are functions called from handlers rather than middlewares:
// the project id is sourced differently per route — req.params.projectId,
// req.body.projectId, or via a lookup on a task/doc/share-link. A blanket
// middleware can't know. Call these at the top of each handler instead.
//
// On failure they always respond 404 (never 403). Returning 403 would leak
// the existence of a project the caller cannot see. The trade-off is that
// a user-supplied invalid id is also "not found" — fine for a UI that only
// ever links to projects you can see anyway.

/**
 * Guard: require the caller can READ this project's content. Writes a 404
 * and returns false if not — handler should `return` immediately.
 */
export async function requireProjectAccess(req: Request, res: Response, projectId: number): Promise<boolean> {
  if (!req.authUser) { res.status(401).json({ error: "Not authenticated" }); return false; }
  const cache = aclCacheFor(req);
  let ok = cache.access.get(projectId);
  if (ok === undefined) {
    ok = await canAccessProject(req.authUser, projectId);
    cache.access.set(projectId, ok);
  }
  if (!ok) { res.status(404).json({ error: "Not found" }); return false; }
  return true;
}

/**
 * Guard: require the caller can MANAGE this project (admin or owner).
 * Writes a 404 if the caller can't even see the project, 403 if they can
 * see it but aren't allowed to manage — distinguishing these is safe
 * because the caller already proved they know the project exists.
 */
export async function requireProjectManage(req: Request, res: Response, projectId: number): Promise<boolean> {
  if (!req.authUser) { res.status(401).json({ error: "Not authenticated" }); return false; }
  const cache = aclCacheFor(req);
  let manageOk = cache.manage.get(projectId);
  if (manageOk === undefined) {
    manageOk = await canManageProject(req.authUser, projectId);
    cache.manage.set(projectId, manageOk);
  }
  if (manageOk) return true;
  // Not a manager. Distinguish "can't see it" (404) from "can see but can't manage" (403).
  let accessOk = cache.access.get(projectId);
  if (accessOk === undefined) {
    accessOk = await canAccessProject(req.authUser, projectId);
    cache.access.set(projectId, accessOk);
  }
  if (!accessOk) { res.status(404).json({ error: "Not found" }); return false; }
  res.status(403).json({ error: "Only the project owner or an admin can do that." });
  return false;
}

/**
 * Resolve a share-link / public resource reference to its containing
 * project id. Used by share-links.ts to gate create/email/revoke calls
 * (the gate is "you must be able to manage the underlying project").
 *
 * Returns null if the resource (or its parent task for documents) is
 * missing — callers should treat that as 404.
 */
export async function resourceProjectId(
  type: "project" | "task" | "document",
  id: number,
): Promise<number | null> {
  if (type === "project") {
    const [r] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, id)).limit(1);
    return r?.id ?? null;
  }
  if (type === "task") {
    const [r] = await db.select({ projectId: tasksTable.projectId }).from(tasksTable).where(eq(tasksTable.id, id)).limit(1);
    return r?.projectId ?? null;
  }
  // document — may be project-scoped, task-scoped, or global. Global docs
  // (both projectId and taskId NULL) have no parent project to gate against;
  // we report null and the caller treats that as "no project gate applies".
  const [d] = await db.select({
    projectId: documentsTable.projectId,
    taskId: documentsTable.taskId,
  }).from(documentsTable).where(eq(documentsTable.id, id)).limit(1);
  if (!d) return null;
  if (d.projectId) return d.projectId;
  if (d.taskId) {
    const [t] = await db.select({ projectId: tasksTable.projectId }).from(tasksTable).where(eq(tasksTable.id, d.taskId)).limit(1);
    return t?.projectId ?? null;
  }
  return null; // global doc — no project gate
}
