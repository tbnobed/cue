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
