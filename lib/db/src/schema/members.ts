import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMemberSchema = createInsertSchema(membersTable).omit({ id: true, createdAt: true });
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type Member = typeof membersTable.$inferSelect;
