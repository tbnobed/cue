---
name: DocuSeal self-hosted behavior
description: Integration details verified against DocuSeal source that are easy to miss in generic API documentation
---

Use the self-hosted API under `/api`, not the cloud host's root paths.
Configure DocuSeal's `APP_URL` explicitly: `FORCE_SSL` alone does not set the
canonical origin used for generated document/signing links.

**Why:** Self-hosted DocuSeal's default URL falls back to localhost without
APP_URL or the equivalent saved application setting; cloud examples hide this.

**How to apply:** Keep internal API transport separate from its public HTTPS
origin. Never broaden the signed-file download allowlist to accommodate a
misconfigured localhost or third-party URL.

Request `include=combined_document_url` when reading completed submissions.

**Why:** DocuSeal generates the combined PDF and audit evidence lazily; the field
can be null otherwise even after all signers finish.

**How to apply:** Preserve this include parameter in provider polling and treat
missing or invalid combined PDFs as retryable filing failures, not completion.

Do not treat completed invitation jobs as proof of email delivery.

**Why:** DocuSeal 3.2.1's mail interceptor switches to a test delivery method
when self-hosted SMTP is absent, so invitation jobs can finish without sending.

**How to apply:** Verify SMTP configuration and transport separately from the
API connection. Environment SMTP overrides saved settings; SMTP authentication
alone does not verify the From address or inbox delivery.

Run container-side Rails commands with the working directory explicitly set to `/app`.

**Why:** The DocuSeal image ends its Dockerfile with `WORKDIR /data/docuseal`;
plain `docker compose exec ... bundle exec rails` runs outside the Rails app.

**How to apply:** Use `exec -T -w /app docuseal ...`. Separate verification from
recreation, so retrying a diagnostic does not repeatedly restart signing.

Use TBN as the primary guest signing-page logo without enabling Pro features,
while retaining visible DocuSeal attribution and access to modified source.

**Why:** The user requested only their supplied logo, not Pro features;
DocuSeal 3.2.1's additional license terms require UI attribution.

**How to apply:** Preserve the attribution and source offer when revising
branding; review upstream compatibility before any DocuSeal upgrade.
