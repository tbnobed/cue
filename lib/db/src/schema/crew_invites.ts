import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { callSheetsTable } from "./call_sheets";
import { membersTable } from "./members";

/**
 * One crew position on a call sheet, plus the availability-invite state for the
 * person filling it. Invitees may be roster members (`memberId` set) or ad-hoc
 * freelancers identified only by name/email.
 *
 * The `token` is an opaque random identifier emailed to the invitee. They reply
 * "available" / "unavailable" via a public, no-login page resolved by this
 * token — so the list builds itself as responses come in.
 *
 * Status lifecycle:
 *   pending     — line added, invite not sent yet
 *   invited     — availability email sent, awaiting reply
 *   available   — invitee replied that they're available
 *   unavailable — invitee replied that they're not available
 *   confirmed   — producer booked them (final)
 *
 * ON DELETE CASCADE from call_sheets; memberId is SET NULL so deleting a
 * roster member leaves the historical booking intact (the name/email snapshot
 * stays on the row).
 */
export const crewInvitesTable = pgTable("crew_invites", {
  id: serial("id").primaryKey(),
  callSheetId: integer("call_sheet_id")
    .notNull()
    .references(() => callSheetsTable.id, { onDelete: "cascade" }),
  position: text("position").notNull(),
  memberId: integer("member_id").references(() => membersTable.id, { onDelete: "set null" }),
  // Display name + contact snapshot (copied from member at add time, or typed
  // for an ad-hoc invitee). Kept on the row so the call sheet is stable even if
  // the roster entry later changes or is deleted.
  name: text("name").notNull(),
  email: text("email"),
  // "full" | "half" — which rate applies for this booking.
  rateType: text("rate_type").notNull().default("full"),
  // Day rate in whole dollars for this booking (pre-filled from the member's
  // standard rate, overridable). Nullable when no rate is known yet.
  dayRate: integer("day_rate"),
  status: text("status").notNull().default("pending"),
  // Opaque token for the public availability-reply link. Nullable until the
  // invite is sent (generated at send time).
  token: text("token").unique(),
  // Optional free-text note the invitee can leave with their reply.
  responseNote: text("response_note"),
  invitedAt: timestamp("invited_at"),
  respondedAt: timestamp("responded_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  byCallSheet: index("crew_invites_call_sheet_idx").on(t.callSheetId),
  byToken: index("crew_invites_token_idx").on(t.token),
}));

export const insertCrewInviteSchema = createInsertSchema(crewInvitesTable).omit({
  id: true, token: true, invitedAt: true, respondedAt: true, createdAt: true,
});
export type InsertCrewInvite = z.infer<typeof insertCrewInviteSchema>;
export type CrewInvite = typeof crewInvitesTable.$inferSelect;
