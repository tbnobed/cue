import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

/**
 * A call sheet (crew list) for a single shoot day on a project. A project can
 * have many call sheets — one per date. The sheet holds the day's logistics
 * (call/wrap times, studio location, billing note, free-form notes) and is the
 * parent of the crew_invites rows that make up the actual roster for the day.
 *
 * ON DELETE CASCADE from projects: deleting a project removes its call sheets
 * (and, transitively, their crew invites).
 */
export const callSheetsTable = pgTable("call_sheets", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  // Optional override for the printed header; falls back to the project name.
  title: text("title"),
  // Shoot date as a plain YYYY-MM-DD string (matches projects.startDate style).
  date: text("date").notNull(),
  // Human-entered call/wrap times, e.g. "11:00am" / "12:00pm". Kept as free
  // text to match how producers write them on the existing Google-Doc sheet.
  callTime: text("call_time"),
  wrapTime: text("wrap_time"),
  // Studio(s), e.g. "The Plex Studios - STUDIO E + STUDIO Q".
  location: text("location"),
  // Billing banner, e.g. "BILLING IS A HALF DAY RATE FOR ALL CREW".
  billingNote: text("billing_note"),
  // Free-form notes section.
  notes: text("notes"),
  // draft → sent → final. Purely organizational; does not gate anything.
  status: text("status").notNull().default("draft"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  byProject: index("call_sheets_project_idx").on(t.projectId),
}));

export const insertCallSheetSchema = createInsertSchema(callSheetsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertCallSheet = z.infer<typeof insertCallSheetSchema>;
export type CallSheet = typeof callSheetsTable.$inferSelect;
