---
name: Dev DB schema drift (drizzle push blocked)
description: This dev Postgres has drifted from the Drizzle schema; `drizzle-kit push` fails, so new columns/tables must be applied by hand.
---

`pnpm --filter @workspace/db run push` does NOT cleanly apply against the dev DB — it
trips on a pre-existing `share_links_token_unique` constraint drift and bails before
applying anything. Net effect: schema columns that were added in earlier sessions can
be present in `lib/db/src/schema/*` but **missing from the actual dev DB**.

**Symptom:** API routes 500 with Postgres `column "<x>" does not exist` even though the
column is in the Drizzle schema and TypeScript is happy (e.g. `pre_approved` on `members`
was in schema but never in the dev DB; `/api/members` and `/api/tasks` both 500'd).

**How to apply schema changes here:** run targeted, idempotent raw SQL via
`psql "$DATABASE_URL"` (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`,
`CREATE TABLE IF NOT EXISTS ...`). After adding columns, verify with an
`information_schema.columns` query, then re-hit the route through `localhost:80`.

**Why not just fix push:** the drift is pre-existing and unrelated to feature work;
fixing it risks touching `share_links`. Production applies schema via the docker
`migrate` service (drizzle-kit push against a clean DB), so dev hand-patches don't
need to be mirrored into a migration file — but DO keep the Drizzle schema as the
source of truth so prod stays correct.
