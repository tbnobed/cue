import { Link } from "wouter";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import cueMark from "@assets/cue-mark_1779576125630.svg";

// Default privacy policy shipped with Cue. This is a TEMPLATE — self-hosting
// operators should review and edit it (or replace it entirely) to reflect
// their own deployment, jurisdiction, and data-handling practices. The page
// is public (mounted outside AuthedShell) so OAuth consent screens can link
// to it before a user has signed in.
//
// Effective-date is rendered from a constant below so each operator can
// update it in one place when they revise the copy.

const EFFECTIVE_DATE = "May 24, 2026";

export default function Privacy() {
  return (
    <div className="dark min-h-screen w-full text-foreground relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute -top-56 -right-40 h-[760px] w-[800px] rounded-full blur-[110px] opacity-40"
          style={{ background: "radial-gradient(closest-side, #5b3dff, transparent 70%)" }}
        />
        <div
          className="absolute -bottom-64 -left-40 h-[700px] w-[740px] rounded-full blur-[110px] opacity-30"
          style={{ background: "radial-gradient(closest-side, #0fb89e, transparent 70%)" }}
        />
        <div className="absolute inset-0 opacity-[0.05]"
          style={{ backgroundImage: "linear-gradient(hsl(0 0% 100%) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100%) 1px, transparent 1px)", backgroundSize: "44px 44px" }} />
      </div>

      <div className="max-w-3xl mx-auto px-6 py-12 md:py-16">
        <div className="flex items-center justify-between mb-10">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors"
            data-testid="link-back-to-login"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to sign in
          </Link>
          <div className="flex items-center gap-2.5">
            <img src={cueMark} alt="Cue" className="w-7 h-7" />
            <span className="font-display text-base font-bold tracking-tight text-aurora">Cue</span>
          </div>
        </div>

        <article className="glass-card glow-aurora rounded-2xl p-8 md:p-10 space-y-8" data-testid="privacy-policy">
          <header className="space-y-2 border-b border-border/60 pb-6">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
              <ShieldCheck className="w-3 h-3" />
              Privacy
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
            <p className="text-xs font-mono text-muted-foreground">
              Effective {EFFECTIVE_DATE}
            </p>
          </header>

          <Section title="Who runs this Cue install">
            <p>
              Cue is a self-hosted project management application. The instance you are using is operated by
              the organization that runs this server, not by the makers of the Cue software. If you have
              questions about how your data is handled here, contact the administrator who invited you.
              They can be reached at the support address provided to you at invitation time.
            </p>
          </Section>

          <Section title="What we collect">
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-foreground">Identity:</strong> when you sign in with an identity
                provider (Authentik or Google), we receive your name, email address, and (if you have one)
                profile picture from that provider. We do not receive your password.
              </li>
              <li>
                <strong className="text-foreground">Local accounts:</strong> if your administrator created
                a local account for you, we store your email and a bcrypt hash of your password. We never
                store the password itself.
              </li>
              <li>
                <strong className="text-foreground">Content you create:</strong> projects, milestones,
                tasks, comments, uploaded files, and any other data you enter into the app are stored in
                this server's database and on its file storage.
              </li>
              <li>
                <strong className="text-foreground">Activity log:</strong> we record actions you take
                inside the app (creating, editing, assigning, completing items) so teammates can see
                project history. Log entries include who took the action and when.
              </li>
              <li>
                <strong className="text-foreground">Technical logs:</strong> the server records request
                metadata (timestamps, IP addresses, user-agent strings, error traces) for operational
                debugging and security monitoring. These are kept on the server's local filesystem and
                rotated by the operator's retention policy.
              </li>
              <li>
                <strong className="text-foreground">Session cookie:</strong> a single signed cookie named
                <code className="mx-1 px-1.5 py-0.5 rounded bg-muted/40 font-mono text-[12px]">studiopm.sid</code>
                keeps you signed in. It is HTTP-only, restricted to this domain, and expires after 7 days
                of inactivity.
              </li>
            </ul>
          </Section>

          <Section title="What we do not collect">
            <ul className="list-disc pl-5 space-y-2">
              <li>No third-party analytics, advertising, or tracking pixels are loaded by the application.</li>
              <li>No data is sold or shared with advertisers.</li>
              <li>The application does not use your data to train machine-learning models.</li>
            </ul>
          </Section>

          <Section title="Where your data goes">
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-foreground">This server.</strong> Your account and all content live
                in the PostgreSQL database and file storage attached to this self-hosted deployment.
              </li>
              <li>
                <strong className="text-foreground">Your identity provider</strong> (Authentik or Google,
                if enabled). The OIDC handshake exchanges your name, email, and verified-email status.
                Google's handling of this data is governed by Google's own privacy policy.
              </li>
              <li>
                <strong className="text-foreground">SendGrid</strong> (optional). If the operator enabled
                email notifications, transactional emails about projects and tasks you're a member of are
                delivered through SendGrid. Email addresses of recipients and the email body are
                transmitted to SendGrid for delivery and are subject to SendGrid's privacy practices.
              </li>
              <li>
                <strong className="text-foreground">Collabora Online</strong> (optional). If document
                editing is enabled, opening a document streams its contents to the Collabora server
                configured by the operator (typically the same network as this app) so it can be rendered
                and edited in your browser.
              </li>
            </ul>
            <p>
              The application does not transmit your data to any other third party.
            </p>
          </Section>

          <Section title="Who can see your data inside the app">
            <ul className="list-disc pl-5 space-y-2">
              <li>Other signed-in members of this instance can see content in projects they are members of.</li>
              <li>Administrators can see the full list of accounts and can approve, suspend, or delete them.</li>
              <li>Anyone with a share link you create can see the specific item that link points to until the link expires or is revoked.</li>
              <li>The server operator has database-level access to all stored content and is responsible for safeguarding it.</li>
            </ul>
          </Section>

          <Section title="Retention and deletion">
            <p>
              Your account and the content you created persist until an administrator deletes them or the
              operator deletes the underlying database. Deleting your account removes your sign-in record
              and invalidates your sessions. Content you authored (projects, tasks, comments, files,
              activity log entries) is retained by default so collaborative history stays intact; ask an
              administrator if you need specific items removed.
            </p>
            <p>
              Backup copies maintained by the operator (database snapshots, file-system backups) may
              retain deleted data for the duration of their backup-retention window.
            </p>
          </Section>

          <Section title="Security">
            <ul className="list-disc pl-5 space-y-2">
              <li>Passwords are hashed with bcrypt. We never store or log plaintext passwords.</li>
              <li>OIDC sign-ins use PKCE and verify the issuer-signed ID token on every callback.</li>
              <li>Session cookies are HTTP-only and, in production, marked Secure.</li>
              <li>OIDC sign-ins are invite-only and require administrator approval before access is granted.</li>
              <li>Operators are expected to run this app behind TLS in production.</li>
            </ul>
          </Section>

          <Section title="Your choices">
            <ul className="list-disc pl-5 space-y-2">
              <li>You can sign out at any time from the sidebar; this destroys your server-side session.</li>
              <li>You can ask an administrator to deactivate your account (you'll be denied access immediately) or to delete it entirely.</li>
              <li>If you have a local password, you can rotate it from your account settings.</li>
              <li>To opt out of email notifications, ask an administrator to disable them on your member record.</li>
            </ul>
          </Section>

          <Section title="Changes to this policy">
            <p>
              The operator of this instance may update this policy at any time. The effective date at the
              top of the page indicates the most recent revision. Material changes will be communicated by
              the operator through their normal channels.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              For privacy questions specific to this Cue installation, contact the administrator who
              issued your invitation. They are the data controller for this instance.
            </p>
          </Section>

          <footer className="pt-6 border-t border-border/60 text-[11px] font-mono text-muted-foreground/70">
            This page is a template provided with the Cue software. The operator of this server is
            responsible for ensuring its contents accurately describe their data handling.
          </footer>
        </article>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <div className="text-[13.5px] leading-relaxed text-muted-foreground space-y-3">
        {children}
      </div>
    </section>
  );
}
