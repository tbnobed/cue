import { pgTable, serial, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const membersTable = pgTable("members", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  role: text("role").notNull().default("engineer"),
  department: text("department"),
  avatarUrl: text("avatar_url"),
  // Extended contact info
  title: text("title"),
  phone: text("phone"),
  mobilePhone: text("mobile_phone"),
  location: text("location"),
  company: text("company"),
  notes: text("notes"),
  // If false, this member's email is never used for project/task notifications.
  // Defaults to true so existing rows opt in automatically after `pnpm run push`.
  emailNotifications: boolean("email_notifications").notNull().default(true),
  // Link to the auth user this roster entry represents. NULLABLE because
  // contractors/external crew can exist as roster entries with no login.
  // Auto-populated by lowercase-email match in `linkUserToMembersByEmail()`
  // on signup, login, and member create/update — admins can also set it
  // directly. ON DELETE SET NULL so deleting the user keeps the roster row
  // intact (the person still existed; we just unbind their auth identity).
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMemberSchema = createInsertSchema(membersTable).omit({ id: true, createdAt: true });
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type Member = typeof membersTable.$inferSelect;
