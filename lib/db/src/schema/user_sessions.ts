import { pgTable, varchar, json, timestamp, index } from "drizzle-orm/pg-core";

// Session store table for `connect-pg-simple` (express-session backend).
//
// We define it here — instead of relying on connect-pg-simple's
// `createTableIfMissing: true` — because esbuild does not bundle the
// upstream `table.sql` asset that auto-creation depends on (it crashes
// with ENOENT at runtime). Putting the table in the Drizzle schema means
// `drizzle-kit push` (run by the docker-compose `migrate` service)
// creates it on first boot. Without this table, every successful login
// 500s when express-session tries to INSERT into it.
//
// Column shape MUST match what connect-pg-simple expects — do NOT add
// `notNull`/extra columns or rename anything. The table name is also
// hard-coded in `artifacts/api-server/src/lib/session.ts` as
// `user_sessions`; keep them in sync.
export const userSessionsTable = pgTable(
  "user_sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6, mode: "date" }).notNull(),
  },
  (t) => [index("IDX_user_sessions_expire").on(t.expire)],
);
