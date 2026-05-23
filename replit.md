# Studio Command

A self-hosted project management platform for Production TV studios. Used by producers, engineers, IT, and AV integrators to manage studio build-outs, track deadlines, and coordinate across departments.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/studio-pm run dev` — run the frontend (dynamic port)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env (dev): `DATABASE_URL` — Postgres connection string
- Required env (auth, optional in dev): `AUTHENTIK_ISSUER`, `AUTHENTIK_CLIENT_ID`, `AUTHENTIK_CLIENT_SECRET`, `PUBLIC_URL` — when set, sign-in is enforced on every page. When unset, the app runs in "guest mode" so local development is unblocked.

## Self-Hosting with Docker

```bash
# Copy and configure env
cp .env.example .env
# Edit POSTGRES_PASSWORD, SESSION_SECRET, COLLABORA_ADMIN_PASSWORD

# Start everything (app + postgres + Collabora Online for document editing)
docker compose up -d

# First run: push DB schema
docker compose exec app sh -c "cd /app && pnpm --filter @workspace/db run push"
```

The app runs on port 5000 by default. Collabora runs on 9980. Set `APP_PORT` / `COLLABORA_PORT` in your `.env` to change them. Put a TLS reverse proxy (Caddy, Traefik, nginx) in front of both for production.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Tailwind CSS, Framer Motion, Recharts, Wouter
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle table definitions (projects, milestones, tasks, members, comments, activity)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/studio-pm/src/` — React frontend
- `Dockerfile` + `docker-compose.yml` — self-hosting configuration

## Authentication

Two auth methods, both available simultaneously:

1. **Local accounts (always on)** — email + password, bcrypt-hashed (`password_hash` column on `users`). Endpoints: `POST /api/auth/signup` (admin-only), `POST /api/auth/login`. **Only local accounts can be admins.**
   - **First-run bootstrap is server-side only.** There is no public bootstrap form — that would let whoever finds the URL first claim the admin account. Instead, the operator runs `pnpm --filter @workspace/scripts create-admin --email … --password …` (or sets `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` in env and runs the same command with no flags). In docker: `docker compose exec app pnpm --filter @workspace/scripts create-admin --email … --password …`. Rerunning the command with an existing email rotates that account's password and re-promotes it to admin (recovery path if you lose the password).
   - After bootstrap, additional accounts are created by an admin via `POST /api/auth/signup` (returns 403 otherwise) — currently no in-app admin UI yet, drive it via the API.
   - The login page does NOT advertise provisioning state — operator-facing setup instructions live in this file only. `/api/config` deliberately does not expose whether an admin exists, so the public sign-in page can't be used to fingerprint fresh installs.
2. **Authentik OIDC (optional)** — when `AUTHENTIK_ISSUER` / `AUTHENTIK_CLIENT_ID` / `AUTHENTIK_CLIENT_SECRET` / `PUBLIC_URL` are all set, the login page also shows a "Continue with Authentik" button. Authentik users are **always non-admin** (admin rights are intentionally restricted to local accounts so the IdP can't grant them). Endpoints: `GET /api/auth/oidc/login`, `GET /api/auth/callback`. Configure Authentik with a Confidential OAuth2/OpenID Provider, redirect URI `${PUBLIC_URL}/api/auth/callback`, scopes `openid profile email`.
- Sessions: `express-session` + `connect-pg-simple` storing in the `user_sessions` table. Cookie `studiopm.sid`, `httpOnly`, `sameSite=lax`, `secure` in production, 7-day TTL, signed with `SESSION_SECRET`. **The session table is NOT auto-created** (esbuild bundle drops the upstream `table.sql` asset) — `pnpm --filter @workspace/db run push` creates it via the Drizzle schema, or run the DDL in `src/lib/session.ts` comments manually.
- Members-only: every `/api/*` data route requires a session via `requireAuth` (gate lives in `routes/index.ts`). No more guest mode — local accounts make auth always-on. Unauthenticated allow-list: `/api/healthz`, `/api/config`, `/api/auth/*`, `/api/wopi/*` (Collabora authenticates via its own HMAC tokens).
- Privileged routes can use `requireAdmin` from `middlewares/require-auth.ts` (returns 403 for non-admin sessions).
- Frontend: `AuthProvider` (`src/hooks/use-auth.tsx`) exposes `signInLocal`, `signUp`, `signInOidc`, `signOut`. Unauthenticated requests redirect to `/login`. The sidebar shows an "Admin" badge for admin users and a sign-out button for everyone.
- TODO: the `/api/collab` WebSocket (Yjs collaboration) is currently only protected by reachability — add session validation on the WS upgrade handshake before exposing publicly.

## Architecture decisions

- Contract-first API: OpenAPI spec gates codegen which gates the frontend — all types are derived from one source
- Dark-mode-first UI: broadcast professionals work long shifts in low-light environments
- Activity log table (not computed): activity feed is a dedicated table written to on events, not derived from state
- Enriched task responses: joined member/studio/milestone names returned server-side to avoid N+1 queries on the client
- Docker multi-stage build: builder stage compiles everything, runner stage is lean production image
- Document editing via Collabora Online (LibreOffice): all office files (csv/docx/xlsx/pptx/odt/ods/odp/txt/md/rtf) open in a real LibreOffice editor in a new browser window. Implemented as a WOPI host (`/api/wopi/files/:id` endpoints) with HMAC-signed access tokens (8h TTL, signed with `SESSION_SECRET`). When `COLLABORA_URL` + `WOPI_PUBLIC_URL` are unset (e.g. Replit dev), the Edit button falls back to the in-app custom editors. Images/PDFs still use the custom inline viewers regardless.

## Product

Studio Command is a general-purpose project command center (originally built for TV studio build-outs; the domain entity was generalized to "Project"). Key capabilities:
- **Projects** — manage multiple projects with status, phase tracking, and budget. Create from the Projects page via the "New Project" dialog.
- **Milestones** — set major project gates with due dates and color coding
- **Tasks** — full task lifecycle (todo → in_progress → blocked → review → done) with priority levels and categories (AV, IT, electrical, construction, acoustics, etc.)
- **Timeline** — visual cross-project timeline showing milestones and deadlines
- **Team** — roster management for producers, engineers, IT, integrators, managers, and contractors
- **Dashboard** — live command center with project health, upcoming deadlines, task breakdowns, and activity feed

## User preferences

- Self-hosted with Docker for production deployment
- Dark-mode-first design appropriate for broadcast/production environments

## Gotchas

- Auth routes must be mounted BEFORE the `requireAuth`-wrapped routers in `routes/index.ts` — otherwise sign-in itself would 401.
- `connect-pg-simple`'s `createTableIfMissing: true` does NOT work in this build — esbuild doesn't bundle its `table.sql` asset, so it crashes with `ENOENT: dist/table.sql`. Keep `createTableIfMissing: false` and create `user_sessions` via `pnpm --filter @workspace/db run push`.
- OIDC users can NEVER gain admin rights, even by editing the `users` row in Postgres and re-logging in — the OIDC upsert path explicitly does not touch `is_admin`. To promote, switch the user to a local account or `UPDATE users SET is_admin=true WHERE id=…` directly.
- `PUBLIC_URL` (not `localhost`) must match what the browser sees and what Authentik has registered as the redirect URI — mismatches show up as `invalid redirect_uri` from Authentik.
- Run `pnpm --filter @workspace/api-spec run codegen` after any OpenAPI spec change before touching frontend code
- The `tasks/upcoming` endpoint uses `/tasks/upcoming` path — it must be registered BEFORE `/tasks/:id` in Express to avoid the path being captured by the param route
- Seed data timestamps are inserted at creation time — activity feed shows all seeds at the same time in dev
- Collabora can only call back to the app if it can resolve `WOPI_PUBLIC_URL` from inside its container. In docker-compose this is `http://app:5000`. If you run the app outside compose, set it to the URL Collabora can reach (not `localhost`).
- The `app` container mounts a named `uploads` volume at `/app/artifacts/api-server/uploads` — uploaded files are persisted across container restarts and are what Collabora reads/writes via WOPI.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
