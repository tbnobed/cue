#!/usr/bin/env bash
# Run from the updated Cue checkout on the self-hosted Docker server.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Building updated Cue (the running app stays up during the build)..."
docker compose build app
echo "Adding release link tables (existing records are unchanged)..."
docker compose exec -T db sh -c 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < scripts/release-links-schema.sql
echo "Restarting Cue with the updated image..."
docker compose up -d --no-deps app
echo "Done. Open a production in Cue, then Releases > Share links."
