import { pgTable, integer, text, timestamp, serial, uniqueIndex } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { tasksTable } from "./tasks";

// Single organization-level connection; credentials are AES-GCM ciphertext.
export const wrikeConnectionsTable = pgTable("wrike_connections", {
  id: integer("id").primaryKey(),
  generation: text("generation").notNull(),
  host: text("host").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  connectedBy: integer("connected_by").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
});

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
});
