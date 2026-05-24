import { pgTable, serial, text, integer, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const documentFoldersTable = pgTable("document_folders", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id"),
  taskId: integer("task_id"),
  parentId: integer("parent_id").references((): AnyPgColumn => documentFoldersTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertDocumentFolderSchema = createInsertSchema(documentFoldersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDocumentFolder = z.infer<typeof insertDocumentFolderSchema>;
export type DocumentFolder = typeof documentFoldersTable.$inferSelect;
