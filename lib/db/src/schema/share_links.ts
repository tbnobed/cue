import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Public share links. A short opaque token grants read-only access to a
 * single project, task, or document without requiring a Cue account.
 *
 * - `token` is the random URL-safe identifier the public sees (lookup index).
 * - `resourceType` + `resourceId` identify what the link grants access to.
 *   Foreign keys are deliberately not enforced so a deleted resource simply
 *   yields a 404, instead of cascading and losing the link's audit trail.
 * - `expiresAt` / `revokedAt` are optional; either being in the past makes
 *   the link inactive.
 */
export const shareLinksTable = pgTable("share_links", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  resourceType: text("resource_type").notNull(),
  resourceId: integer("resource_id").notNull(),
  createdBy: integer("created_by"),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byResource: index("share_links_resource_idx").on(t.resourceType, t.resourceId),
}));

export const insertShareLinkSchema = createInsertSchema(shareLinksTable).omit({
  id: true, token: true, createdAt: true, revokedAt: true,
});
export type InsertShareLink = z.infer<typeof insertShareLinkSchema>;
export type ShareLink = typeof shareLinksTable.$inferSelect;
