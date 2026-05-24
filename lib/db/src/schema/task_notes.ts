import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tasksTable } from "./tasks";

export const taskNotesTable = pgTable("task_notes", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  authorId: integer("author_id"),
  authorName: text("author_name"),
  body: text("body").notNull(),
  statusBefore: text("status_before"),
  statusAfter: text("status_after"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTaskNoteSchema = createInsertSchema(taskNotesTable).omit({ id: true, createdAt: true });
export type InsertTaskNote = z.infer<typeof insertTaskNoteSchema>;
export type TaskNote = typeof taskNotesTable.$inferSelect;
