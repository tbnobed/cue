import { pgTable, serial, text, numeric, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  location: text("location"),
  status: text("status").notNull().default("planning"),
  phase: text("phase"),
  startDate: text("start_date"),
  targetDate: text("target_date"),
  completedDate: text("completed_date"),
  budget: numeric("budget"),
  // The user who owns / manages this project. Set to the creator on
  // POST /projects (whoever called the endpoint); transferable by the
  // current owner or an admin via POST /projects/:id/transfer. NULLABLE
  // because admins can clear it when needed (no orphan-prevention; admins
  // see everything anyway). ON DELETE SET NULL so deleting the owner user
  // doesn't cascade-delete the project — admin can reassign after.
  ownerUserId: integer("owner_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
