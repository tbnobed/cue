import { pgTable, integer, text, timestamp, serial, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { tasksTable } from "./tasks";

// One encrypted connection per Cue user. Existing connection IDs survive migration.
export const wrikeConnectionsTable = pgTable("wrike_connections", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  generation: text("generation").notNull(),
  host: text("host").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  connectedBy: integer("connected_by").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
  cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  nextRequestAt: timestamp("next_request_at", { withTimezone: true }),
}, t => [uniqueIndex("wrike_connection_owner_unique").on(t.ownerUserId)]);

export const wrikeTaskLinksTable = pgTable("wrike_task_links", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  remoteId: text("remote_id").notNull(),
  taskId: integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  permalink: text("permalink").notNull(),
  remoteStatus: text("remote_status").notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("wrike_task_project_remote_unique").on(t.projectId, t.remoteId)]);

export const wrikeSyncRunsTable = pgTable("wrike_sync_runs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("running"),
  created: integer("created").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  error: text("error"),
  actorId: integer("actor_id"),
  connectionId: integer("connection_id"),
  linkRevision: text("link_revision"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leaseToken: text("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
}, t => [
  index("wrike_jobs_due_idx").on(t.status, t.availableAt),
  uniqueIndex("wrike_one_active_job").on(t.projectId).where(sql`${t.status} IN ('queued', 'running', 'retry_wait')`),
]);
