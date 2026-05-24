import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectMembersTable = pgTable("project_members", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  memberId: integer("member_id").notNull(),
  projectRole: text("project_role"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("project_members_unique_idx").on(t.projectId, t.memberId),
}));

export const insertProjectMemberSchema = createInsertSchema(projectMembersTable).omit({
  id: true, createdAt: true,
});
export type InsertProjectMember = z.infer<typeof insertProjectMemberSchema>;
export type ProjectMember = typeof projectMembersTable.$inferSelect;
