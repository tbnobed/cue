import { pgTable, serial, integer, text, timestamp, date, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { releasesTable } from "./releases";
import { releaseTemplatesTable, type SigningPerson } from "./docuseal";

export const releaseLinksTable = pgTable("release_links", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "restrict" }),
  templateId: integer("template_id").notNull().references(() => releaseTemplatesTable.id),
  title: text("title").notNull(),
  signingMode: text("signing_mode").$type<"email" | "immediate">().notNull().default("email"),
  productionDate: date("production_date", { mode: "string" }),
  signers: jsonb("signers").$type<SigningPerson[]>().notNull(),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const releaseEnrollmentsTable = pgTable("release_enrollments", {
  id: serial("id").primaryKey(),
  linkId: integer("link_id").notNull().references(() => releaseLinksTable.id),
  email: text("email").notNull(),
  receiptHash: text("receipt_hash"),
  releaseId: integer("release_id").notNull().references(() => releasesTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("release_enrollments_link_email").on(table.linkId, table.email)]);
