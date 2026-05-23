# Studio Command

A self-hosted project management platform for Production TV studios. Used by producers, engineers, IT, and AV integrators to manage studio build-outs, track deadlines, and coordinate across departments.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/studio-pm run dev` — run the frontend (dynamic port)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

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
- `lib/db/src/schema/` — Drizzle table definitions (studios, milestones, tasks, members, comments, activity)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/studio-pm/src/` — React frontend
- `Dockerfile` + `docker-compose.yml` — self-hosting configuration

## Architecture decisions

- Contract-first API: OpenAPI spec gates codegen which gates the frontend — all types are derived from one source
- Dark-mode-first UI: broadcast professionals work long shifts in low-light environments
- Activity log table (not computed): activity feed is a dedicated table written to on events, not derived from state
- Enriched task responses: joined member/studio/milestone names returned server-side to avoid N+1 queries on the client
- Docker multi-stage build: builder stage compiles everything, runner stage is lean production image
- Document editing via Collabora Online (LibreOffice): all office files (csv/docx/xlsx/pptx/odt/ods/odp/txt/md/rtf) open in a real LibreOffice editor in a new browser window. Implemented as a WOPI host (`/api/wopi/files/:id` endpoints) with HMAC-signed access tokens (8h TTL, signed with `SESSION_SECRET`). When `COLLABORA_URL` + `WOPI_PUBLIC_URL` are unset (e.g. Replit dev), the Edit button falls back to the in-app custom editors. Images/PDFs still use the custom inline viewers regardless.

## Product

Studio Command is a command center for TV studio construction projects. Key capabilities:
- **Studios** — manage multiple studio build-out projects with status, phase tracking, and budget
- **Milestones** — set major project gates with due dates and color coding
- **Tasks** — full task lifecycle (todo → in_progress → blocked → review → done) with priority levels and categories (AV, IT, electrical, construction, acoustics, etc.)
- **Timeline** — visual cross-studio timeline showing milestones and deadlines
- **Team** — roster management for producers, engineers, IT, integrators, managers, and contractors
- **Dashboard** — live command center with studio health, upcoming deadlines, task breakdowns, and activity feed

## User preferences

- Self-hosted with Docker for production deployment
- Dark-mode-first design appropriate for broadcast/production environments

## Gotchas

- Run `pnpm --filter @workspace/api-spec run codegen` after any OpenAPI spec change before touching frontend code
- The `tasks/upcoming` endpoint uses `/tasks/upcoming` path — it must be registered BEFORE `/tasks/:id` in Express to avoid the path being captured by the param route
- Seed data timestamps are inserted at creation time — activity feed shows all seeds at the same time in dev
- Collabora can only call back to the app if it can resolve `WOPI_PUBLIC_URL` from inside its container. In docker-compose this is `http://app:5000`. If you run the app outside compose, set it to the URL Collabora can reach (not `localhost`).
- The `app` container mounts a named `uploads` volume at `/app/artifacts/api-server/uploads` — uploaded files are persisted across container restarts and are what Collabora reads/writes via WOPI.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
