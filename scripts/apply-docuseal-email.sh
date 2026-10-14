#!/usr/bin/env bash
# Never echo Compose's rendered configuration: it contains credentials.
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-apply}"
if [[ "$mode" != "apply" && "$mode" != "--check" && "$mode" != "--test-email" ]]; then
  echo "Usage: bash scripts/apply-docuseal-email.sh [--check | --test-email]"
  exit 2
fi
recipient=""
if [[ "$mode" == "--test-email" ]]; then
  read -r -p "Send one DocuSeal delivery test to your email address: " recipient
  if [[ ! "$recipient" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
    echo "Enter one valid email address. No message was sent."
    exit 2
  fi
fi
if [[ "$mode" == "apply" ]]; then
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
else
  echo "Verification only: existing DocuSeal container will not be restarted."
fi
echo "Waiting up to 90 seconds for DocuSeal HTTP readiness..."
ready=false
for attempt in $(seq 1 18); do
  if docker compose exec -T -w /app docuseal ruby -rnet/http -rtimeout -e \
    'begin; Timeout.timeout(3) { r = Net::HTTP.get_response(URI("http://127.0.0.1:3000/")); exit(r.code.to_i < 500 ? 0 : 1) }; rescue StandardError; exit 1; end' \
    >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
if [[ "$ready" != "true" ]]; then
  echo "DocuSeal did not become ready. No further restart was attempted."
  echo "After it starts, retry verification only: bash scripts/apply-docuseal-email.sh --check"
  exit 1
fi
echo "Checking DocuSeal SMTP configuration and SendGrid authentication..."
# Capture framework output rather than exposing settings or server error text.
result="$(docker compose exec -T -w /app docuseal bundle exec rails runner - "$recipient" 2>&1 <<'RUBY'
require 'net/smtp'
begin
  unless ENV['SMTP_PASSWORD'].to_s.strip.length > 0 && ENV['SMTP_FROM'].to_s.strip.length > 0
    puts 'CUE_SMTP_FAILED: SendGrid password or sender is missing in the running container. Run the apply command without --check.'
    exit 1
  end
  raise 'not_smtp' unless Rails.application.config.action_mailer.delivery_method == :smtp
  settings = ActionMailer::Base.smtp_settings
  smtp = Net::SMTP.new(settings.fetch(:address), settings.fetch(:port).to_i)
  smtp.open_timeout = 15
  smtp.read_timeout = 25
  smtp.enable_starttls
  recipient = ARGV.first.to_s
  # Use the real running container's From address and SMTP settings. This is
  # a transport diagnostic, not a new release or a signature invitation.
  smtp.start('sign.obtv.io', settings.fetch(:user_name), settings.fetch(:password), :plain) do |session|
    unless recipient.empty?
      require 'mail'
      message = Mail.new(
        from: ENV.fetch('SMTP_FROM'), to: recipient,
        subject: 'Cue / DocuSeal email delivery test',
        body: 'This is one requested email delivery test from the DocuSeal container. No release or signing request was created.',
        date: Time.now
      )
      raise 'invalid_sender' unless message.from&.length == 1
      session.send_message(message.to_s, message.from.first, recipient)
    end
  end
  if recipient.empty?
    puts 'CUE_SMTP_OK: SendGrid accepted SMTP authentication over STARTTLS. No email was sent.'
  else
    puts 'CUE_SMTP_OK: SendGrid accepted the test message for delivery. Subject: Cue / DocuSeal email delivery test'
    puts 'CUE_SMTP_NEXT: If absent from your inbox, check SendGrid Email Activity for this recipient and subject (delivered, deferred, bounced, blocked or dropped).'
  end
rescue StandardError => e
  puts "CUE_SMTP_FAILED: #{e.class.name}. SMTP verification failed; delivery is not confirmed."
  status = e.respond_to?(:response) ? e.response&.status.to_s : ''
  puts "CUE_SMTP_STATUS: #{status}" if status.match?(/\A[245]\d{2}\z/)
  # Classify provider errors without printing addresses, tokens or raw responses.
  detail = e.message.to_s.downcase
  if detail.include?('verified sender') || detail.include?('sender identity')
    puts 'CUE_SMTP_REASON: SendGrid rejected the From address. Verify the configured EMAIL_FROM or its domain in SendGrid Sender Authentication.'
  elsif e.is_a?(Net::SMTPAuthenticationError)
    puts 'CUE_SMTP_REASON: SendGrid rejected authentication. Check the key and its Mail Send permission.'
  elsif detail.include?('invalid_sender')
    puts 'CUE_SMTP_REASON: The running container must have exactly one valid SMTP_FROM sender.'
  else
    puts 'CUE_SMTP_REASON: Check SendGrid Email Activity and account sending restrictions for the rejection reason.'
  end
  exit 1
end
RUBY
)" || {
  printf '%s\n' "$result" | grep '^CUE_SMTP_' || echo "DocuSeal HTTP is ready, but the Rails SMTP check failed to run from /app. SMTP delivery is not confirmed."
  echo "Retry verification without restarting: bash scripts/apply-docuseal-email.sh --check"
  exit 1
}
printf '%s\n' "$result" | grep '^CUE_SMTP_OK:' || { echo "No SMTP verification result received."; exit 1; }
echo "After successful delivery, use Signing > Resend now as an admin to retry an existing request without the reminder wait."
echo "SMTP acceptance does not guarantee inbox delivery; check SendGrid Email Activity if it does not arrive."
