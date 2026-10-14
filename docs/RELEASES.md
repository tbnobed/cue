# Self-hosted release foundation

This feature runs in the existing Docker-hosted application. It requires no
Replit connector, Replit storage service, OneDrive, or live Wrike credentials.

## Upgrade an existing installation

Back up the existing database and uploads volume first. The normal Compose
`migrate` service applies the Drizzle schema. For an additive SQL alternative,
from the repository root on your Docker host:

```sh
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < scripts/release-foundation.sql
docker compose build app
docker compose up -d app
```

Do not assume rebuilding the app automatically runs migrations on an already
running installation. Use the migration service or the explicit SQL step.

## Release records

Project owners and administrators create/edit release records and manually
track draft, awaiting-signatures, and signed states. Project members can read
records and download archives. "Signed" is producer-entered, not independently
verified by a signature provider.

Archive a signed record by uploading a PDF (maximum 20 MB) and explicitly
confirming all required signatures are complete. The server checks PDF framing,
writes the file exclusively, flushes and reads it back, computes SHA-256, and
atomically records the archive and an actor event in the database. These checks
detect storage corruption; they do not validate signatures or scan for malware.

Archived records cannot be changed or replaced through the application. There
is intentionally no release-delete endpoint. Projects containing any release
records cannot be deleted; use their completed status instead. Corrections
require a new release record; retain the original.

Files live under `uploads/release-archive/` on the existing persistent Docker
uploads volume. Only the authorized release download endpoint serves them:
they are not ordinary document records, editable via Collabora, or accessible
through public share links. Downloads recheck SHA-256 before serving.

This protects against ordinary app actions, not a server/database administrator
or physical storage loss. This is not regulatory WORM storage.

## Wrike coexistence

Each local project can be linked to one Wrike project/folder using its API ID
and HTTPS Wrike URL. A remote ID cannot be assigned to multiple local projects.
Unlinking changes only the local mapping; it does not delete anything in Wrike.

The interface deliberately says API sync is not configured. This foundation
does not send requests to Wrike, import tasks, or write back to Wrike. The next
integration stage must run server-side in this self-hosted app, authenticate
against TBN's Wrike account, and define field ownership, conflict handling,
pagination, retry behavior, and sync audit history. Never put credentials in
browser forms or repository files.

## Backup and recovery requirement

The uploads volume is persistence, not backup. Before relying on this as the
sole archive, IT must configure encrypted, monitored backups in a separate
failure domain and a retention policy. Back up both PostgreSQL and the full
uploads volume; restoring only one leaves missing files or missing records.

For a consistent maintenance-window backup:

1. Stop the app and other processes that write documents, including Collabora.
2. Export PostgreSQL with `pg_dump` and snapshot/copy the uploads volume.
3. Store both as one identified backup set, with checksums and restricted access.
4. Restart the services and verify health.
5. Restore the set to an isolated environment, sign in, and download a known
   archived release to verify access and checksum validation.

Agree recovery-time/recovery-point targets and run restore drills. There is no
automated backup job or retention purge in this release.

## Not yet implemented

Approved template administration, DocuSign sending/webhooks and completion
certificates, automated reminders, durable filing-retry jobs, cross-project
archive search, and live Wrike synchronization remain separate implementation
stages. No UI status should imply these automations have run.
