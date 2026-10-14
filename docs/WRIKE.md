# Personal Wrike connections and queued imports

Cue is self-hosted at `https://cue.obtv.io`. No Replit connector, Replit-hosted
storage, or OneDrive is required. One Wrike OAuth application serves all Cue
users; each user authorizes their own Wrike account.

## Server configuration

Register this exact redirect URL in the Wrike API application:

`https://cue.obtv.io/api/integrations/wrike/callback`

Keep these on the Docker host in its protected `.env`:

```dotenv
PUBLIC_URL=https://cue.obtv.io
WRIKE_CLIENT_ID=<Wrike application client ID>
WRIKE_CLIENT_SECRET=<Wrike application client secret>
WRIKE_TOKEN_KEY=<64 hexadecimal characters>
```

Generate the encryption key with `openssl rand -hex 32`. Preserve and back it
up securely. Users do not need client secrets or permanent access tokens.
The callback is unchanged from the shared-connection version. `/documents`
is a page, not part of PUBLIC_URL. HTTPS/proxy cookie handling must work.

## Upgrade from the shared connection

Back up PostgreSQL, uploads, and the encryption key first. Pull the updated
code using your normal release process, then from the Docker host's Cue directory:

```sh
docker compose stop app
docker compose build migrate app
docker compose run --rm migrate
docker compose up -d app
```

Do not start the new app if migration fails. Do not run the old app against
the upgraded schema. Stopping it first prevents its old singleton scheduler
from importing during the ownership transition.

The migrate service now runs `lib/db/migrate-wrike.cjs` before Drizzle push.
Existing installations apply the idempotent `scripts/wrike-personal.sql`
backfill; fresh installations get the complete new schema through Drizzle.
No manual SQL command is needed in the normal Docker upgrade.

The original encrypted connection and connection ID are preserved and assigned
to the Cue user recorded as having authorized it. Existing links retain that
connection; imported tasks, history and release documents remain intact.
Automatic sync is paused once for review. Owners/admins can take over with
their own connection without deleting imported tasks. If the original user
record is missing, the migration fails rather than guessing an owner.

## Each user's workflow

1. Open **Integrations** (`/integrations`) and choose **Connect my Wrike**.
2. Approve access in Wrike. Tokens are encrypted separately for this Cue user.
3. Open a Cue project you own (admins may also manage projects), then
   **Overview → Project integrations**.
4. Select a Wrike project or folder visible to **your own** Wrike account.
   Select the parent containing the tasks, not an individual child project.
5. Review the listed Cue audience and sharing warning and explicitly confirm.
6. Select **Sync now**. This queues a durable job and immediately returns; it
   does not claim the import is complete. The panel polls progress and results.
7. Optionally enable automatic imports. Scheduling is staggered; next due time
   is displayed and actual execution depends on queue load/rate limits.

All Cue admins, the project owner, and project members can see imported data.
Existing Cue share links can expose their scoped project/task content too.
Wrike permissions are **not** copied and Cue membership is never auto-created.
Project members can read status but cannot link, take over or start imports.
Do not import private Wrike data into a broadly shared Cue project.

## Ownership and duplicate rules

Each Cue project has one designated sync connection. A project owner/admin can
request an import through that deliberately delegated connection, even if their
own personal Wrike account is disconnected. They cannot browse that owner's
other Wrike projects, read their tokens, or select arbitrary users' connections.

**Take over with my Wrike** verifies the replacement manager's own access to
the same remote location, requires audience confirmation, preserves local data
and disables auto-sync until re-enabled. Takeover cancels the old owner's active
jobs; stale workers cannot commit after transfer. A disconnected/deactivated owner or an owner who no longer
manages the Cue project causes imports to pause. Changing project ownership does
not silently transfer Wrike authorization.

One remote Wrike location can be linked to only one Cue project. A duplicate
gets a generic conflict without revealing the private destination. Imported
tasks are deduplicated by remote ID within the destination; overlapping parent
and child scopes in different Cue projects can still yield separate local copies.

Disconnect destroys only that user's stored credentials, cancels their active
jobs and pauses their linked projects. A credential-free record retains owner
identity. Other users are unaffected. Reconnect rotates only that user's
connection and pauses their auto-sync for review. Provider-side revocation is
separate: remove Cue's access in Wrike if desired.

## Queue, retries and administration

PostgreSQL is the durable queue; no Redis installation is required. Workers run
inside the API service. All replicas share a global maximum of **four** active
imports and at most **one per connection**. Admission uses a database advisory
lock and `FOR UPDATE SKIP LOCKED`; a partial unique index prevents duplicate
active jobs for the same Cue project.

Workers poll every two seconds; the scheduler checks due projects every
15 seconds. Enabling auto-sync staggers the first due time over five minutes;
successful imports schedule the next one five minutes later. This is a target
interval, not a guaranteed completion SLA.

Requests are paced per connection. Provider HTTP 429 responses persist their
Retry-After cooldown. Retryable failures use exponential backoff with jitter,
up to five attempts; authorization/access failures pause auto-sync instead.
Five-minute leases are renewed every 30 seconds; expired jobs are recovered.
Generation/revision/lease checks prevent stale jobs from committing after
disconnect, takeover or cancellation. Authorization is checked again at commit.

Admins use **Integration health** (`/admin/integrations`) to see connection
owners/health, queue counts, and recent failed/retrying jobs. Tokens are never
returned by health endpoints. No administrator can impersonate another user's
Wrike connection in the project picker.

## Import scope

One-way **Wrike → Cue**, no writeback. Tasks from the location, descendants and
subtasks are imported. Wrike owns imported title, description, standard status,
priority, due date and single matching assignee; Cue edits to those fields are
overwritten next time. Active/Deferred map to To do, Completed to Done,
Cancelled to Blocked, with the original status in the description.

One Wrike assignee maps only when exactly one existing Cue project member
matches an email returned for that contact. Multiple/unmatched assignees remain
unassigned with a note. No users or memberships are provisioned.

Cue-only tasks, project metadata, memberships, release records and files are
untouched. Deleted/moved remote tasks are retained; locally moved tasks are
skipped. Deleting an imported Cue task can recreate it on the next import.
Hierarchy, dependencies, comments, attachments, time entries and custom fields
are not copied. Subtasks become individual Cue tasks.

All remote pages are fetched before an atomic task update transaction. Safety
limits stop oversized/slow imports explicitly rather than partially importing.
An empty remote location produces a zero-task result, not an API failure.

## Verification boundary

The development suite exercises 500 synthetic owners/jobs, concurrency limits,
token isolation, pagination, repeated imports, rate-limit retries, inactive
owners, stale revisions and interrupted-worker recovery with simulated Wrike
responses. Browser tests cover user-facing controls and access boundaries.
This is not a 500-user live-provider performance certification. Pilot several
real accounts after deployment, verify Wrike scopes and monitor queue lag
before enabling organization-wide automatic imports.
