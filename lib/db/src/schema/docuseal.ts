import { pgTable, serial, integer, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { releasesTable } from "./releases";

export type SigningPerson = { role: string; name: string; email: string; status?: string };
export const releaseTemplatesTable = pgTable("release_templates", {
  id: serial("id").primaryKey(),
  remoteId: integer("remote_id").notNull(),
  name: text("name").notNull(),
  version: text("version").notNull(),
  guestRole: text("guest_role").notNull(),
  roles: jsonb("roles").$type<string[]>().notNull(),
  fingerprint: text("fingerprint").notNull(),
  active: boolean("active").notNull().default(true),
  approvedBy: integer("approved_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const releaseSigningTable = pgTable("release_signing", {
  releaseId: integer("release_id").primaryKey().references(() => releasesTable.id, { onDelete: "restrict" }),
  templateId: integer("template_id").notNull().references(() => releaseTemplatesTable.id),
  requestKey: text("request_key").notNull().unique(),
  submissionId: integer("submission_id").unique(),
  state: text("state").notNull().default("sending"),
  signers: jsonb("signers").$type<SigningPerson[]>().notNull(),
  lastError: text("last_error"),
  nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull().defaultNow(),
  lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
  reminderCount: integer("reminder_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
