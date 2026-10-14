import { pgTable, serial, integer, text, timestamp, date, bigint, boolean } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

// Restrict project deletion: completed records must remain discoverable.
export const releasesTable = pgTable("releases", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "restrict" }),
  guestName: text("guest_name").notNull(),
  guestEmail: text("guest_email").notNull(),
  title: text("title").notNull(),
  templateVersion: text("template_version").notNull(),
  productionDate: date("production_date", { mode: "string" }),
  status: text("status").notNull().default("draft"),
  notes: text("notes").notNull().default(""),
  storageKey: text("storage_key"),
  fileName: text("file_name"),
  sha256: text("sha256"),
  fileSize: bigint("file_size", { mode: "number" }),
  createdBy: integer("created_by").notNull(),
  archivedBy: integer("archived_by"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectWrikeLinksTable = pgTable("project_wrike_links", {
  projectId: integer("project_id").primaryKey().references(() => projectsTable.id, { onDelete: "cascade" }),
  remoteId: text("remote_id").notNull().unique(),
  url: text("url").notNull(),
  remoteTitle: text("remote_title"),
  connectionId: integer("connection_id"),
  revision: text("revision").notNull().default("legacy"),
  nextSyncAt: timestamp("next_sync_at", { withTimezone: true }),
  autoSync: boolean("auto_sync").notNull().default(false),
  syncStatus: text("sync_status").notNull().default("idle"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastError: text("last_error"),
  lockToken: text("lock_token"),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedBy: integer("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const releaseEventsTable = pgTable("release_events", {
  id: serial("id").primaryKey(),
  releaseId: integer("release_id").notNull().references(() => releasesTable.id, { onDelete: "restrict" }),
  actorId: integer("actor_id").notNull(),
  action: text("action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
