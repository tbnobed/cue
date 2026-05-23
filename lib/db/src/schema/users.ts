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
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastLoginAt: timestamp("last_login_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("users_sub_unique").on(t.sub)],
);

export type User = typeof usersTable.$inferSelect;
