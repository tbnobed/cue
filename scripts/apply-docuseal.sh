#!/usr/bin/env bash
# Apply the confirmed Cue / remote-NPM deployment. Never print secrets.
set -Eeuo pipefail
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")/.."

trap 'printf "\nStopped at line %s. No volumes were deleted. Fix the reported error before retrying.\n" "$LINENO" >&2' ERR

command -v docker >/dev/null
command -v curl >/dev/null
command -v ip >/dev/null
test -f .env
test -f docker-compose.yml

# These are the user's confirmed deployment addresses, not example defaults.
export DOCUSEAL_HOST=sign.obtv.io
export DOCUSEAL_PUBLIC_URL=https://sign.obtv.io
export DOCUSEAL_API_URL=http://docuseal:3000
export DOCUSEAL_BIND=192.168.100.65
export DOCUSEAL_PORT=3001
export DOCUSEAL_VERSION=3.2.1

if ! ip -4 -o addr show | grep -Fq " $DOCUSEAL_BIND/"; then
  printf 'This host does not own %s. Run this script on the Cue server.\n' "$DOCUSEAL_BIND" >&2
  exit 1
fi
if ! grep -Fq '${DOCUSEAL_BIND:-127.0.0.1}:${DOCUSEAL_PORT:-3001}:3000' docker-compose.yml; then
  echo 'docker-compose.yml is outdated. Update the project files before retrying.' >&2
  exit 1
fi

backup="$HOME/cue-config-backups/$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$backup"
cp -p .env docker-compose.yml "$backup/"
echo "Private configuration backup: $backup"

# Persist only these non-secret deployment settings. Preserve all credentials,
# Cue's PUBLIC_URL, Wrike settings and unrelated environment entries.
set_setting() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '\n%s=%s\n' "$key" "$value" >> .env
  fi
}
for key in DOCUSEAL_HOST DOCUSEAL_PUBLIC_URL DOCUSEAL_API_URL DOCUSEAL_BIND DOCUSEAL_PORT DOCUSEAL_VERSION; do
  set_setting "$key" "${!key}"
done
chmod 600 .env

# --quiet avoids printing the resolved configuration, which contains secrets.
docker compose --profile signing config --quiet
docker compose --profile signing up -d --no-deps --force-recreate docuseal

container="$(docker compose --profile signing ps -q docuseal)"
test -n "$container"
binding="$(docker port "$container" 3000/tcp)"
if [[ "$binding" != "$DOCUSEAL_BIND:$DOCUSEAL_PORT" ]]; then
  printf 'Unexpected binding: %s. Expected %s:%s.\n' "$binding" "$DOCUSEAL_BIND" "$DOCUSEAL_PORT" >&2
  exit 1
fi
echo "Verified DocuSeal binding: $binding"

ready=false
for attempt in {1..60}; do
  status="$(curl -s --max-time 3 -o /dev/null -w '%{http_code}' \
    -H "Host: $DOCUSEAL_HOST" "http://$DOCUSEAL_BIND:$DOCUSEAL_PORT/" || true)"
  case "$status" in
    200|301|302|303|307|308) ready=true; break ;;
  esac
  sleep 2
done
if [[ "$ready" != true ]]; then
  echo 'DocuSeal has not become ready. Inspect: docker compose --profile signing logs --tail=80 docuseal' >&2
  exit 1
fi
echo 'DocuSeal responds on the Cue private interface.'

# Apply changed environment settings to the existing Cue image. No rebuild,
# migration, database restart or volume replacement is needed for this fix.
docker compose up -d --no-deps app
docker compose --profile signing ps

cat <<'NEXT'

NPM must have this Proxy Host (on your OTHER server):
  Domain:           sign.obtv.io
  Scheme:           http
  Forward IP:       192.168.100.65
  Forward port:     3001
  Websockets:       enabled
  SSL certificate:  sign.obtv.io
  Force SSL:        enabled

DNS for sign.obtv.io must point at NPM's public address.
Permit port 3001 from NPM only; do not expose it publicly.
Leave cue.obtv.io unchanged.

Open https://sign.obtv.io to finish administrator, SMTP and API-key setup.
Store DOCUSEAL_API_KEY in Cue's .env, then run:
  docker compose up -d --no-deps app

The private-interface check above does not verify NPM, DNS, email delivery,
or the API key. Those are separate from container startup.
NEXT
