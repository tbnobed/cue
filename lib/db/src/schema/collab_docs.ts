import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const collabDocsTable = pgTable("collab_docs", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  docType: text("doc_type").notNull().default("text"),
  projectId: integer("project_id"),
  content: text("content"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCollabDocSchema = createInsertSchema(collabDocsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCollabDoc = z.infer<typeof insertCollabDocSchema>;
export type CollabDoc = typeof collabDocsTable.$inferSelect;
