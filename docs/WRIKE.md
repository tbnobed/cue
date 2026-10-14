# Direct Wrike integration for self-hosted Cue

## Configure your Docker host

In Wrike App Console, register **TBN Cue Integration** and set this exact
redirect URI:

`https://cue.obtv.io/api/integrations/wrike/callback`

In the host's protected `.env` set:

```dotenv
PUBLIC_URL=https://cue.obtv.io
WRIKE_CLIENT_ID=<your Wrike application's client ID>
WRIKE_CLIENT_SECRET=<your Wrike application's client secret>
WRIKE_TOKEN_KEY=<64 hexadecimal characters>
```

Generate the token key using `openssl rand -hex 32`. Keep it stable and back it
up separately and securely. Do not commit credentials or paste them into chat.
`/documents` is a page, not part of PUBLIC_URL. HTTPS and forwarded proxy
headers must be working so the app's secure session cookie survives OAuth.

## Upgrade

Back up PostgreSQL and uploads before upgrading. Use the normal Drizzle
migration service, or run these additive migrations on the host:

```sh
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < scripts/release-foundation.sql
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < scripts/wrike-integration.sql
docker compose build app
docker compose up -d app
```

The Compose configuration passes the three Wrike settings into the app.
No Replit services or OneDrive are involved.

## Connect and import

1. Sign in to Cue as an administrator and open **Admin → Integrations**.
2. Select **Connect Wrike**, authorize the intended TBN account, and return to Cue.
3. In a Cue project's **Overview → Project integrations**, choose a Wrike
   project or folder from the searchable, paginated picker. Select the parent
   containing the tasks, not an individual child project. Only admins can link remote
   data: the shared Wrike connection may see data ordinary Cue users cannot.
4. Review the project's Cue membership before importing: its members will see
   the imported tasks. No memberships are automatically created.
5. An owner or admin selects **Sync now** and confirms the import behavior.
6. Optionally enable automatic imports; the server checks every five minutes.
   Check last success, last error, and the latest 20 run records in the panel.

## Field ownership and safety

This is **one-way synchronization from Wrike to Cue**, not two-way sync.
It imports tasks from the selected project, descendant folders and subtasks.
Wrike owns imported title, description, status, priority, due date, and
assignee. Changes to those fields in Cue are overwritten on the next sync.
Task descriptions include the source link and original Wrike status.

Wrike Active and Deferred map to Cue To do, Completed to Done, and Cancelled
to Blocked with the source status retained in the description. Custom workflow
statuses are represented by their Wrike standard status group, not recreated.
High/Normal/Low importance maps to High/Medium/Low priority.

One Wrike assignee maps only when exactly one existing Cue project member
matches an email returned for that contact. Multiple/unmatched assignees leave
the Cue assignment empty with a note. This does not invite or provision users.
Subtasks are imported as individual tasks; hierarchy, dependencies, comments,
attachments, time entries, and custom fields are not copied.

Cue project metadata, memberships, Cue-only tasks, release records and files
are untouched. Existing imported tasks are matched by remote ID. Tasks removed
or moved out of Wrike are retained in Cue, never auto-deleted. Locally moved
tasks are skipped. Deleting an imported Cue task can cause it to be recreated
on the next import while it remains in Wrike.

Imports fetch all pages before a database transaction applies task changes.
A failed import does not apply a partial task batch. Rate limits and transient
server errors get bounded retries. A database lease prevents overlapping
imports; interrupted runs become retryable after five minutes. Very large
imports fail explicitly at the page/time safety limits; use a smaller scope.

Disconnect removes local encrypted tokens and disables auto-sync, while
preserving local data. Reconnecting also disables auto-sync so an administrator
can review the new account. Revoke Cue's authorization in Wrike separately if
you want provider-side revocation.

Tokens are encrypted with AES-256-GCM and refresh rotation is serialized in
PostgreSQL. The callback uses expiring session-bound, single-use OAuth state
and requires a logged-in Cue admin. API hosts are allowlisted to Wrike's
documented US/EU hosts; secrets are never returned to the browser.

## Verification boundary

Automated development tests can use simulated Wrike responses to verify
pagination, repeated imports, errors, and token handling. They do not prove
your organization's credentials, consent policy, live data, or reverse proxy
work. Confirm one pilot project after deployment before enabling automatic sync.
