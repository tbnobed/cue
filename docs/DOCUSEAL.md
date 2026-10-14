# DocuSeal signing on the Cue server

Cue uses a self-hosted DocuSeal instance for guest releases. There is no
Replit connector, OneDrive archive, or DocuSeal Cloud requirement.
DocuSeal handles signing, invitation/completion email and signature evidence.
Cue controls approved templates, production data, project permissions, status,
reminders and its own immutable signed-PDF archive.

## Server setup

1. Back up the Cue database, uploads volume and server configuration first.
2. Use the approved signing hostname `sign.obtv.io`. Point its DNS at the
   public address serving Nginx Proxy Manager. NPM runs on a different server:
   configure its proxy host to forward to the Cue server's private IP,
   scheme `http`, port `3001`, with Websockets Support enabled. Terminate HTTPS
   in NPM. Leave the `cue.obtv.io` proxy host unchanged.
3. Set these values in the self-hosted server's `.env`, not in browser code:

   ```dotenv
   DOCUSEAL_HOST=sign.obtv.io
   DOCUSEAL_PUBLIC_URL=https://sign.obtv.io
   DOCUSEAL_API_URL=http://docuseal:3000
   DOCUSEAL_PORT=3001
   DOCUSEAL_BIND=<Cue-server-private-IP>
   DOCUSEAL_VERSION=3.2.1
   ```

   **Remote Nginx Proxy Manager:** Set `DOCUSEAL_BIND` to the Cue server's
   private interface IP rather than loopback. In NPM use that IP, scheme
   `http`, and port `3001`; terminate HTTPS in NPM. Point the signing hostname's
   DNS at NPM, not directly at Cue. Permit port 3001 only from the NPM server
   using your network firewall or Docker-aware firewall rules. Do not publish
   port 3001 to the internet or assume UFW alone filters Docker-published ports.

4. Start DocuSeal:

   ```sh
   docker compose --profile signing up -d docuseal
   ```

   The optional `signing` profile avoids starting an unconfigured service during
   unrelated upgrades. The named `docuseal_data` volume persists both its default
   SQLite database and documents at `/data/docuseal`. This is a single-instance
   deployment; do not scale this SQLite container horizontally.

5. Open the public signing URL, create the initial administrator account, and
   configure SMTP in DocuSeal's email settings. Confirm its Application URL is
   the public HTTPS origin. Complete initial setup before making it available
   to guests. Restrict administrative access and disable unwanted registration
   using the settings supported by your installed version.
6. Create an API key in the **self-hosted DocuSeal** settings. Add it to the same
   server `.env` as `DOCUSEAL_API_KEY`. Do not paste keys into Cue forms or chat.
   Use an account that can access the release templates. Keys from DocuSeal Cloud
   are not credentials for this local server.
7. Deploy the updated Cue code and migrate while the app is stopped:

   ```sh
   docker compose stop app &&
   docker compose build migrate app &&
   docker compose run --rm migrate &&
   docker compose --profile signing up -d app docuseal
   ```

   Stop if any command fails. Existing Wrike configuration is unchanged.
   Normal production Drizzle migration creates the additive release template
   and signing tables. No existing release records or archives are deleted.

8. In Cue, open **Admin → Integrations → DocuSeal**. "Configured" only confirms
   environment settings exist; successfully fetching a template tests the API.
   Run a real test with addresses you control before sending guest releases:
   invitation delivery, both signatures, signed copies, reminders and archived
   PDF download. Local development tests simulate DocuSeal; they do not
   certify your live SMTP, reverse proxy, provider version or legal template.

The Compose image is pinned rather than automatically following `latest`.
Review DocuSeal release notes and test upgrades before changing its tag.
API access and features depend on the installed DocuSeal edition/license.
Cue uses existing templates and the REST API, not Pro embedded builders.
Cue schedules its own reminders; DocuSeal's built-in automated reminders are
listed as a Pro feature and are not required by this implementation.

## Approved templates

Upload your legally approved release PDF in DocuSeal and create the signer roles
(for example `Guest` and `Producer`). Every role must have a **required signature
field**. Prepare separate templates for each release type. Cue does not supply
or legally approve the release text.

To prefill production details, use these exact field names:

| Field | Cue value |
|---|---|
| `GuestName` | Release guest name |
| `GuestEmail` | Release guest email |
| `ProjectName` | Cue project/show name |
| `ReleaseTitle` | Release title |
| `ProductionDate` | Production date, `YYYY-MM-DD` |

Use text fields for these values. Cue fills matching fields for their assigned
roles and makes them read-only. Other fields remain for the signer to fill.
Do not put an automatic value on a signature field. Make the production date
optional in the template if releases may omit it.

In Cue's DocuSeal admin section enter the numeric template ID, a version label
and the exact guest role name; select **Fetch & approve**. Approval captures the
template version and structure. Editing the template in DocuSeal requires a new
approval; Cue rejects sending a changed template. A new approval retires the
previous approval of that template. Retiring templates never removes existing
signing records or signed documents.

## Producer and guest workflow

1. Create a draft release under the Cue project with guest information.
2. Open **Sign**, select an approved template, and fill every additional role.
   Cue fills the guest role from the release and records the approved version.
3. Cue creates one DocuSeal submission and requests email invitations to all roles
   simultaneously. Guests sign using DocuSeal's mobile-friendly page; no Cue
   account is needed. Enable/test signed-copy delivery in DocuSeal.
   The initiating producer is BCC'd on DocuSeal's completion email.
4. Cue polls DocuSeal in the background, normally within about a minute, including
   after app restarts. There is no inbound webhook to expose or configure.
5. Only after **every expected signer** has completed does Cue fetch the combined
   signed PDF with its audit certificate, validate it, save it to Cue's persistent
   uploads volume, hash it, and mark the release archived. The name includes
   date, project ID, guest and release ID.
6. Project members can see signing status and download the protected archive.
   Cue also records completion in project activity. Owners/admins can recheck
   status and retry filing.

Document download URLs must stay on the configured DocuSeal origins, including
redirects. Files over 40 MB or invalid PDFs are rejected and shown as filing
failures. This setup assumes DocuSeal local disk storage; configuring a separate
object-store/CDN origin requires a deliberate allowlist change.

Outstanding signers receive an automatic reminder after three days, up to three
automatic reminders total at three-day intervals. A producer can request a manual
reminder, with at least one hour between successful reminder batches. Completed
and declined signers are excluded. SMTP/provider failures appear in signing
status; retries do not claim successful delivery.

## Recovery and safety

- Cue commits a send intent before calling DocuSeal. A timeout or interrupted send
  becomes **Needs review**, never an automatic duplicate send. Check DocuSeal and
  enter the existing submission ID. Cue verifies every signer plus a secret-free
  correlation ID before linking it. If no submission exists, an administrator
  must verify that before a producer creates a replacement draft.
- Filing failures remain visible and are retried automatically after five minutes;
  **Retry filing** performs an immediate check. No partial result is marked archived.
- Once a release has a DocuSeal signing record, manual editing/status changes and
  manual PDF replacement are blocked. Corrections require a new release; cancel
  or expire the old submission in DocuSeal to prevent signing an obsolete request.
- Legacy manual records and PDF downloads are retained for documents signed
  outside DocuSeal. They are separate from provider-verified signing.
- Wrike project synchronization is unchanged. Release status is shown in Cue;
  this change does **not** write release status or document links back to Wrike.
- Polling and file storage failures are operationally visible in Cue and server
  logs; external alerting/escalation is not configured.

## Backup and restore

Back up **all** of: Cue PostgreSQL, Cue uploads, `docuseal_data`, `.env` and reverse
proxy configuration. DocuSeal contains the originals, audit evidence and API
configuration; Cue contains its own verified completed copies and associations.
Never run `docker compose down -v` unless intentionally deleting these volumes.
For a consistent SQLite backup, stop DocuSeal before snapshotting its volume (or
use a supported SQLite backup procedure); copy all volume contents, not just PDFs.
Store encrypted backups separately from this server and test a full restore.
This implementation adds persistent volumes, not a scheduled off-server backup.

References:
- https://github.com/docusealco/docuseal
- https://www.docuseal.com/docs/api
- https://console.docuseal.com/openapi.yml
