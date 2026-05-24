import sgMail from "@sendgrid/mail";
import { logger } from "./logger.js";

/**
 * SendGrid wrapper. We deliberately treat email as best-effort:
 *   - When `SENDGRID_API_KEY` + `EMAIL_FROM` are not both set, every send is a
 *     logged no-op. This keeps local/Replit dev unblocked without secrets.
 *   - When configured, send errors are caught and logged but NEVER thrown to
 *     callers, so a SendGrid hiccup can't fail a user-facing mutation.
 *
 * In Docker, set `SENDGRID_API_KEY`, `EMAIL_FROM` (verified sender), and
 * optionally `EMAIL_FROM_NAME` in your `.env` and they will be passed through
 * via `docker-compose.yml`.
 */

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  const key = process.env.SENDGRID_API_KEY;
  if (!key || !process.env.EMAIL_FROM) return false;
  sgMail.setApiKey(key);
  configured = true;
  return true;
}

export function isEmailEnabled(): boolean {
  return !!(process.env.SENDGRID_API_KEY && process.env.EMAIL_FROM);
}

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /** Optional Reply-To header — useful for share-link emails where replies should go to the actor. */
  replyTo?: string;
}

export interface SendEmailResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const recipients = Array.isArray(input.to)
    ? input.to.filter((r) => r && r.trim().length > 0)
    : input.to && input.to.trim().length > 0
      ? [input.to]
      : [];
  if (recipients.length === 0) {
    return { ok: false, skipped: true, error: "no recipients" };
  }

  if (!ensureConfigured()) {
    logger.info(
      { to: recipients, subject: input.subject },
      "email skipped (SENDGRID_API_KEY / EMAIL_FROM not configured)",
    );
    return { ok: false, skipped: true };
  }

  const from = {
    email: process.env.EMAIL_FROM!,
    name: process.env.EMAIL_FROM_NAME || "Cue",
  };

  try {
    // SendGrid: when sending to multiple addresses with a single send() call,
    // each recipient sees the full To: list. We want one-per-recipient privacy,
    // so we fan out as individual sends. The list is short (project members)
    // and SendGrid v3 is happy with sequential POSTs here.
    await Promise.all(
      recipients.map((to) =>
        sgMail.send({
          to,
          from,
          subject: input.subject,
          text: input.text,
          html: input.html,
          ...(input.replyTo ? { replyTo: input.replyTo } : {}),
          // Disable click tracking — share-link URLs must stay verbatim so the
          // token isn't rewritten through sendgrid.net proxies.
          trackingSettings: {
            clickTracking: { enable: false, enableText: false },
          },
        }),
      ),
    );
    logger.info({ to: recipients, subject: input.subject }, "email sent");
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg, to: recipients, subject: input.subject }, "email send failed");
    return { ok: false, error: msg };
  }
}

/**
 * Renders a minimal, dark-mode-aware HTML email shell around `bodyHtml`.
 * All notifications share this chrome to keep the look consistent and to make
 * branding tweaks a one-file change.
 */
export function renderEmailShell(opts: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  ctaText?: string;
  ctaUrl?: string;
  footerNote?: string;
}): string {
  const cta = opts.ctaText && opts.ctaUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0"><tr><td bgcolor="#7c3aed" style="border-radius:8px"><a href="${escapeAttr(opts.ctaUrl)}" style="display:inline-block;padding:12px 22px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(opts.ctaText)}</a></td></tr></table>`
    : "";
  const footer = opts.footerNote
    ? `<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#94a3b8">${escapeHtml(opts.footerNote)}</p>`
    : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(opts.heading)}</title></head>
<body style="margin:0;padding:0;background:#0b0d12;color:#e2e8f0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${escapeHtml(opts.preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0b0d12;padding:32px 16px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#11141b;border:1px solid #1f2430;border-radius:14px;padding:28px">
      <tr><td>
        <div style="font-size:11px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#a78bfa;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">Cue</div>
        <h1 style="margin:8px 0 4px;font-size:18px;line-height:1.4;font-weight:600;color:#f8fafc">${escapeHtml(opts.heading)}</h1>
        <div style="margin-top:16px;font-size:14px;line-height:1.6;color:#cbd5e1">${opts.bodyHtml}</div>
        ${cta}
        ${footer}
      </td></tr>
    </table>
    <p style="margin:16px 0 0;font-size:11px;color:#64748b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0.08em">Cue · Production project command</p>
  </td></tr>
</table></body></html>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

/**
 * Best-effort absolute URL for an in-app path. Mirrors share-links.ts so the
 * notification CTA buttons resolve to the same host the operator browses.
 */
export function appUrl(path: string): string {
  const base = process.env.PUBLIC_URL
    || (process.env.REPLIT_DOMAINS?.split(",")[0]
      ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
      : "");
  if (!base) return path;
  return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}
