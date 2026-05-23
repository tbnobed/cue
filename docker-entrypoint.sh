#!/bin/sh
# Studio Command container entrypoint.
#
# When BOOTSTRAP_ADMIN_EMAIL + BOOTSTRAP_ADMIN_PASSWORD are set, seed (or
# rotate the password of) the bootstrap admin before the app starts. This is
# idempotent: re-running with the same email rotates that account's password
# and re-promotes it to admin. With the vars unset, this is a no-op and the
# operator must run `docker compose exec app node scripts/dist/create-admin.mjs`
# manually.
#
# We deliberately do NOT bake credentials into the image — they come from the
# runtime environment (your .env file), so build artifacts contain no secrets.
set -e

APP_DIR="${APP_DIR:-/app}"

if [ -n "$BOOTSTRAP_ADMIN_EMAIL" ] && [ -n "$BOOTSTRAP_ADMIN_PASSWORD" ]; then
  echo "[entrypoint] seeding bootstrap admin ($BOOTSTRAP_ADMIN_EMAIL)…"
  if ! node --enable-source-maps "$APP_DIR/scripts/dist/create-admin.mjs"; then
    echo "[entrypoint] FATAL: bootstrap admin seeding failed" >&2
    exit 1
  fi
elif [ -n "$BOOTSTRAP_ADMIN_EMAIL" ] || [ -n "$BOOTSTRAP_ADMIN_PASSWORD" ]; then
  # Half-configured: refuse to start. Silently skipping a misconfigured admin
  # is the worst outcome — the operator believes auth is provisioned and ships
  # an app with no admin account.
  echo "[entrypoint] FATAL: BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must both be set, or both be empty." >&2
  exit 1
else
  echo "[entrypoint] BOOTSTRAP_ADMIN_EMAIL/PASSWORD not set — skipping admin seed."
fi

exec "$@"
