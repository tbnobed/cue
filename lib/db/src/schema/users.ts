import { pgTable, serial, text, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";

export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    // OIDC subject — stable per-IdP user identifier. Null for local accounts.
    sub: text("sub"),
    email: text("email"),
    name: text("name"),
    picture: text("picture"),
    // bcrypt hash for local accounts (null for OIDC users).
    passwordHash: text("password_hash"),
    // Admin flag — only local accounts may be admins. Enforced in the auth routes.
    isAdmin: boolean("is_admin").notNull().default(false),
    // Gate: requireAuth rejects sessions where this is false. Local accounts
    // (admin-created) default to active. New OIDC sign-ins are forced inactive
    // and must be approved by an admin before they can use the app.
    // Default true so existing rows opt-in on column add — the inactive path
    // is opt-in per signup, not retroactive.
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastLoginAt: timestamp("last_login_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("users_sub_unique").on(t.sub)],
);

export type User = typeof usersTable.$inferSelect;
