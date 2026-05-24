import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

// Email verification tokens minted by Cue when an OIDC sign-in lands
// with `email_verified: false` (typical for Authentik, which has no
// verify-on-signup flow). We email the user a one-time link; clicking
// it sets `verified_at`. The next OIDC callback for the same address
// looks up this table and proceeds past the IdP's missing claim.
//
// Rows are kept (not deleted) after use so we have an audit trail of
// who verified and when. Tokens are random 32-byte hex strings (see
// auth.ts) and expire 24h after issuance. The `email` column stores
// the lowercase form; `lower(email)` is what we always query by.
export const emailVerificationsTable = pgTable(
  "email_verifications",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    verifiedAt: timestamp("verified_at"),
  },
  (t) => [index("IDX_email_verifications_email").on(t.email)],
);
