#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Building DocuSeal with the TBN signing header (existing service stays running)..."
docker compose --profile signing build docuseal
echo "Replacing only DocuSeal; its existing data volume and SMTP settings are retained..."
docker compose --profile signing up -d --no-deps docuseal
echo "Waiting up to 90 seconds for DocuSeal and checking the logo/source files..."
for attempt in $(seq 1 45); do
  if docker compose exec -T -w /app docuseal ruby -rnet/http -e '
    %w[/cue-branding/tbn-logo.png /cue-branding/docuseal-source.tar.gz].each do |path|
      request = Net::HTTP::Head.new(path)
      request["Host"] = ENV.fetch("FORCE_SSL", "localhost")
      request["X-Forwarded-Proto"] = "https"
      response = Net::HTTP.start("127.0.0.1", 3000, open_timeout: 2, read_timeout: 3) { |http| http.request(request) }
      abort unless response.code == "200"
    end
  ' >/dev/null 2>&1; then
    echo "TBN logo and modified-source download are available. Refresh a guest signing page."
    exit 0
  fi
  sleep 2
done
echo "DocuSeal did not pass the branding readiness check. Inspect: docker compose logs --tail=80 docuseal" >&2
exit 1
