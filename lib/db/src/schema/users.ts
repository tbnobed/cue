import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    // OIDC subject — stable per-IdP user identifier
    sub: text("sub").notNull(),
    email: text("email"),
    name: text("name"),
    picture: text("picture"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastLoginAt: timestamp("last_login_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("users_sub_unique").on(t.sub)],
);

export type User = typeof usersTable.$inferSelect;
