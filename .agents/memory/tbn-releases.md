---
name: TBN release workflow
description: Business context for the proposed guest release workflow
---

TBN produces specials throughout the year and lacks a consistent shared filing and backup process for completed releases. Other teams use DocuShare for Praise and Takeaways, and DocuSign with a shared OneDrive archive for Better Together.

**Why:** The user wants to learn from existing teams and connect existing tools rather than duplicate their processes.

**How to apply:** The proposed flow should cover producer project selection and guest intake, the current approved release, all required signatures, automatic naming and archiving, producer confirmation, authorized status/archive visibility, reminders, and filing-failure follow-up. Guests need a phone-friendly experience, clear show information, minimal repeated typing, and a signed copy.

The user does not want OneDrive storage: they want all documents stored in this application and want to evaluate it as the whole project management tool and document holding place.

**Why:** The user explicitly replaced the proposed OneDrive archive with this application.

**How to apply:** Use app-owned document storage and project tracking. Wrike must remain in use through its API until TBN is ready to migrate away; the user has authorized building the foundations. Keep backup infrastructure separate from the producer-facing archive.

Keep Releases navigation separate from Wrike integration controls.

**Why:** The user explicitly objected to combining unrelated production and integration functionality under a "Releases and Wrike" tab.

**How to apply:** Label production navigation by its purpose (Releases); keep provider-specific setup in project integrations, not inside the release workflow.

The user expects approximately 500 users to sync their own Wrike projects,
not depend on a single administrator's Wrike account.

**Why:** The user explicitly rejected the shared-account assumption and approved personal connections and queued synchronization.

**How to apply:** Preserve personal authorization boundaries and designated project sync ownership in future integrations; do not revert to organization-wide credential sharing.

DocuSeal is the main signing engine for all release forms and runs on the same
self-hosted server alongside Cue.

**Why:** The user explicitly selected DocuSeal and same-server hosting.

**How to apply:** Use the self-hosted DocuSeal API, keep completed documents in Cue,
and do not substitute a cloud signing provider or Replit hosting/integrations.

Nginx Proxy Manager (NPM) handles HTTPS for Cue from a different server.
The user approved `sign.obtv.io` as the DocuSeal hostname, on the same server
as Cue. Cue remains at `cue.obtv.io`.

**Why:** The user explicitly identified their existing HTTPS proxy.

**How to apply:** Use the existing NPM setup, not host Nginx/Certbot installation
commands. Do not invent or treat a suggested signing hostname as approved.

Fix this project's Docker configuration in the codebase rather than asking the
user to manually edit the Docker files.

**Why:** The user explicitly and repeatedly rejected doing those edits themselves.

**How to apply:** Make deployment configuration fixes directly; give only the
necessary server update/apply commands afterward. NPM's existing signing
forwarding configuration is already set and should not be reconfigured.
