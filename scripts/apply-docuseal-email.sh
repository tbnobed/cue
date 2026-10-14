#!/usr/bin/env bash
# Never echo Compose's rendered configuration: it contains credentials.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import json, subprocess, sys
result = subprocess.run(["docker", "compose", "--profile", "signing", "config", "--format", "json"], capture_output=True, text=True)
if result.returncode:
    sys.exit("Could not validate Docker Compose configuration. No services were changed.")
try:
    env = json.loads(result.stdout)["services"]["docuseal"]["environment"]
    if not env.get("SMTP_PASSWORD", "").strip() or not env.get("SMTP_FROM", "").strip():
        sys.exit("Existing SENDGRID_API_KEY or EMAIL_FROM is missing from the server's Compose environment. No services were changed. Do not paste credentials in chat.")
    if env.get("SMTP_ADDRESS") != "smtp.sendgrid.net" or env.get("SMTP_USERNAME") != "apikey":
        sys.exit("Sync the updated docker-compose.yml before running this command. No services were changed.")
except (KeyError, ValueError, TypeError):
    sys.exit("Could not validate DocuSeal email configuration. No services were changed.")
print("SendGrid key and sender present. Recreating only DocuSeal...")
PY
docker compose --profile signing up -d --no-deps --force-recreate docuseal
echo "Checking DocuSeal SMTP configuration and SendGrid authentication..."
# Capture framework output rather than exposing settings or server error text.
result="$(docker compose exec -T docuseal bundle exec rails runner - 2>&1 <<'RUBY'
require 'net/smtp'
begin
  raise 'not_smtp' unless Rails.application.config.action_mailer.delivery_method == :smtp
  settings = ActionMailer::Base.smtp_settings
  smtp = Net::SMTP.new(settings.fetch(:address), settings.fetch(:port).to_i)
  smtp.open_timeout = 15
  smtp.read_timeout = 25
  smtp.enable_starttls
  smtp.start('sign.obtv.io', settings.fetch(:user_name), settings.fetch(:password), :plain) {}
  puts 'CUE_SMTP_OK: SendGrid accepted SMTP authentication over STARTTLS. No email was sent.'
rescue StandardError => e
  puts "CUE_SMTP_FAILED: #{e.class.name}. SMTP verification failed; delivery is not confirmed."
  exit 1
end
RUBY
)" || {
  printf '%s\n' "$result" | grep '^CUE_SMTP_' || echo "DocuSeal SMTP check could not start. Run this command again after DocuSeal finishes starting."
  exit 1
}
printf '%s\n' "$result" | grep '^CUE_SMTP_OK:' || { echo "No SMTP verification result received."; exit 1; }
echo "Use Remind on an existing outstanding release to retry its signing email."
echo "SMTP acceptance does not guarantee inbox delivery; check SendGrid Email Activity if it does not arrive."
