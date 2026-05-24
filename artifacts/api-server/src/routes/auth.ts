import { Router } from "express";
import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, membersTable } from "@workspace/db";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  generators,
  getOidcClient,
  isAuthConfigured,
  readOidcConfig,
  readProviderConfig,
  type ProviderId,
} from "../lib/oidc";
import { linkUserToMembersByEmail } from "../lib/access";

const router = Router();

// Precomputed at startup so that bcrypt.compare against it takes the same time
// as a real password check. Used when the email doesn't exist to defeat
// account-enumeration via response timing.
const BCRYPT_COST = 12;
const FALLBACK_HASH = bcrypt.hashSync(
  // Random non-secret string; we never accept it as a real password.
  "__no_account_with_this_email__placeholder_for_timing_defense__",
  BCRYPT_COST,
);

// Promise-wrapper around express-session callbacks.
function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
}
// Rotate the session ID at auth boundaries to prevent session fixation.
function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
}

// ─── Local accounts (email + password) ────────────────────────────────────────
//
// Only LOCAL accounts may be admins. OIDC users are always non-admin.
// Signup is NEVER exposed publicly — every call requires an existing admin
// session. The first admin must be created from the server using the
// `pnpm create-admin` CLI (see scripts/src/create-admin.ts). This closes the
// "anyone-who-finds-the-URL-first-becomes-admin" window that an open
// bootstrap form would leave open between deploy and first sign-in.
//
// Local accounts default to `is_active = true` — the admin who creates them
// is implicitly approving them. Only OIDC sign-ins land in the pending state.

const SignupBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(120).optional(),
  isAdmin: z.boolean().optional(),
});

const LoginBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

function publicUser(u: {
  id: number;
  email: string | null;
  name: string | null;
  picture: string | null;
  isAdmin: boolean;
  isActive: boolean;
  sub: string | null;
  passwordHash: string | null;
}) {
  // `authProvider` lets the client know whether the user has a local password
  // (and can therefore self-serve a password change). OIDC users manage
  // credentials at their IdP.
  const authProvider: "local" | "oidc" = u.passwordHash ? "local" : (u.sub ? "oidc" : "local");
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    picture: u.picture,
    isAdmin: u.isAdmin,
    isActive: u.isActive,
    authProvider,
  };
}

async function getSessionUser(userId: number | undefined) {
  if (!userId) return null;
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return u ?? null;
}

// POST /api/auth/signup — admin-only account creation.
// First-run admin must be created via the `pnpm create-admin` CLI on the server
// — there is no public bootstrap form. This endpoint refuses everyone who is
// not already an admin (including all unauthenticated callers).
router.post("/auth/signup", async (req, res): Promise<void> => {
  const actor = await getSessionUser(req.session.userId);
  // Suspended admins lose all privileged access — including the ability to
  // mint new accounts. Otherwise deactivation is only a partial lockout.
  // Returning the active-account error code first lets the frontend surface
  // the pending banner consistently.
  if (actor && !actor.isActive) {
    res.status(403).json({ error: "Your account is not active.", code: "account_inactive" });
    return;
  }
  if (!actor?.isAdmin) {
    res.status(403).json({ error: "Only an admin can create new accounts." });
    return;
  }

  const parsed = SignupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const email = parsed.data.email.toLowerCase().trim();
  const name = parsed.data.name?.trim() || email.split("@")[0];
  const makeAdmin = parsed.data.isAdmin === true;

  const existing = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(sql`lower(${usersTable.email})`, email), isNotNull(usersTable.passwordHash)));
  if (existing.length > 0) {
    res.status(409).json({ error: "An account with that email already exists." });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_COST);
  const [user] = await db.insert(usersTable)
    .values({ email, name, passwordHash, isAdmin: makeAdmin, isActive: true, lastLoginAt: new Date() })
    .returning();

  // Auto-link the new user to any roster entry that was added before they
  // had an account (admin pre-creates a member row for someone, then later
  // creates their login). Idempotent — never overwrites existing links.
  try {
    const linked = await linkUserToMembersByEmail(user!.id, email);
    if (linked > 0) req.log.info({ userId: user!.id, linked }, "linked user to existing member(s) by email");
  } catch (err) {
    req.log.error({ err, userId: user!.id }, "linkUserToMembersByEmail failed (signup)");
  }

  // The new account is NOT signed in — we keep the admin's session intact.
  res.status(201).json(publicUser(user!));
});

// POST /api/auth/login — local email + password
router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }
  const email = parsed.data.email.toLowerCase().trim();
  const [user] = await db.select()
    .from(usersTable)
    .where(and(eq(sql`lower(${usersTable.email})`, email), isNotNull(usersTable.passwordHash)));

  // Always run bcrypt.compare against a real, same-cost hash even on miss, so
  // response timing doesn't reveal whether the email exists.
  const hash = user?.passwordHash ?? FALLBACK_HASH;
  const ok = await bcrypt.compare(parsed.data.password, hash);
  if (!user || !ok) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  // Block deactivated local accounts at the door (don't leak the reason in
  // the same response as the credential check, but it's fine here — they
  // already proved they own the account).
  if (!user.isActive) {
    res.status(403).json({
      error: "Your account is pending administrator approval.",
      code: "account_inactive",
    });
    return;
  }

  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
  // Re-link on every login (cheap & idempotent) so a roster entry added
  // between logins picks up the user_id without an admin action.
  try {
    await linkUserToMembersByEmail(user.id, user.email ?? email);
  } catch (err) {
    req.log.error({ err, userId: user.id }, "linkUserToMembersByEmail failed (login)");
  }
  await regenerateSession(req);
  req.session.userId = user.id;
  await saveSession(req);
  res.json(publicUser(user));
});

// ─── OIDC (Authentik + Google) ───────────────────────────────────────────────
//
// Two policy gates are enforced on every OIDC sign-in:
//
//   1. INVITE-ONLY — a new sign-in is only allowed if there's already a row
//      in `members` whose lowercase(email) matches. Admin pre-creates the
//      roster entry; only then can that person finish a Google flow. This
//      keeps the door closed against "anyone with a Google account" walk-up
//      signups even though our consent screen is public.
//
//   2. ADMIN ACTIVATION — even after an invited user completes the flow,
//      their `users.is_active` lands false. An admin must flip it true in
//      the admin UI before they can see anything. This is the second gate;
//      it also covers the case where an invite was issued in error.
//
// Existing sign-ins (we already have a `users` row with this `sub`) skip
// gate (1) — they were vouched for previously — but still get gated by
// (2) if an admin deactivated them after the fact.

async function memberExistsForEmail(email: string | null): Promise<boolean> {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const [row] = await db
    .select({ id: membersTable.id })
    .from(membersTable)
    .where(eq(sql`lower(${membersTable.email})`, normalized))
    .limit(1);
  return !!row;
}

// Encode error codes as querystring on the login page redirect. The login
// page reads `?error=…` and renders a friendly message. We deliberately
// collapse "no invite" and "invited but not yet approved" into the same
// `pending` code so the public callback can't be used to probe membership —
// both produce identical responses and identical user-visible copy.
function loginRedirect(res: Response, error?: string): void {
  const path = error ? `/login?error=${encodeURIComponent(error)}` : "/login";
  res.redirect(path);
}

// Defense against open-redirect attacks via the OIDC `returnTo`. We only
// accept same-origin relative paths.  `startsWith("/")` alone is NOT enough:
// `//evil.tld/path` and `/\evil.tld` are both protocol-relative URLs that
// browsers happily follow to a third-party origin. Reject anything that:
//   - doesn't start with `/`
//   - starts with `//` or `/\` (protocol-relative)
//   - contains a backslash anywhere (Windows-style separator some
//     browsers treat like `/`)
//   - is the literal `/login` (avoid redirect loops post-auth)
function safeReturnTo(value: string | undefined | null): string {
  if (!value || typeof value !== "string") return "/";
  if (value.length > 512) return "/";
  if (value[0] !== "/") return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value.includes("\\")) return "/";
  if (value === "/login" || value.startsWith("/login?") || value.startsWith("/login/")) return "/";
  return value;
}

async function startOidcFlow(provider: ProviderId, req: Request, res: Response): Promise<void> {
  if (!readProviderConfig(provider)) {
    res.status(503).json({ error: `${provider} sign-in is not configured on this server.` });
    return;
  }
  try {
    const client = await getOidcClient(provider);
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const state = generators.state();
    const nonce = generators.nonce();
    // Validate at storage time so a poisoned returnTo can't sit in a session
    // waiting to be used; also re-validate at use time below (defense in depth).
    const returnTo = safeReturnTo(typeof req.query.returnTo === "string" ? req.query.returnTo : "/");

    req.session.oidc = { provider, state, codeVerifier, nonce, returnTo };
    await saveSession(req);

    const authzParams: Record<string, string> = {
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    };
    // Google-only: if the operator restricted to a Workspace domain, hint
    // the IdP's account picker to that domain. We still re-verify the `hd`
    // claim server-side in the callback — `hd` on the auth request is just
    // UX, not a security control.
    const cfg = readProviderConfig(provider);
    if (provider === "google" && cfg?.hostedDomain) {
      authzParams.hd = cfg.hostedDomain;
    }

    const url = client.authorizationUrl(authzParams);
    res.redirect(url);
  } catch (err) {
    req.log.error({ err, provider }, "OIDC login failed");
    res.status(500).json({ error: "Failed to start sign-in" });
  }
}

async function handleOidcCallback(provider: ProviderId, req: Request, res: Response): Promise<void> {
  const cfg = readProviderConfig(provider);
  if (!cfg) { res.status(503).send("OIDC authentication not configured"); return; }

  const stored = req.session.oidc;
  if (!stored?.state || !stored.codeVerifier) {
    res.status(400).send("Sign-in session expired. Please try again.");
    return;
  }
  // Defense against cross-provider state injection: the session must have
  // been started by the same provider we're now handling a callback for.
  // Without this, an attacker who can plant a state value in the user's
  // session could swap providers mid-flow.
  if (stored.provider && stored.provider !== provider) {
    res.status(400).send("Sign-in session mismatch. Please try again.");
    return;
  }

  try {
    const client = await getOidcClient(provider);
    const params = client.callbackParams(req);
    const tokenSet = await client.callback(cfg.redirectUri, params, {
      state: stored.state,
      code_verifier: stored.codeVerifier,
      nonce: stored.nonce,
    });
    const claims = tokenSet.claims();
    const rawSub = String(claims.sub);
    const email = claims.email ? String(claims.email).toLowerCase().trim() : null;
    const emailVerifiedClaim = claims.email_verified !== false; // treat missing as verified (Authentik often omits)
    const name = claims.name ? String(claims.name) : (claims.preferred_username ? String(claims.preferred_username) : null);
    const picture = claims.picture ? String(claims.picture) : null;
    const hd = typeof claims.hd === "string" ? claims.hd : null;

    // Refuse unverified emails outright — an attacker could otherwise sign
    // up to a Google account using someone else's address (Google itself
    // blocks this for gmail.com but custom-domain emails can pass through
    // unverified in some edge cases).
    //
    // Escape hatch for self-hosted Authentik: Authentik has no built-in
    // "verify-on-signup" flow, so accounts created by an admin land with
    // `email_verified: false` (or omitted) and there is no UX to flip it
    // short of editing the user's YAML attributes by hand. When the operator
    // controls Authentik and enrollment is admin-only, the verification check
    // is redundant — the admin already vouched for the address when they
    // created the account. Set `OIDC_TRUST_UNVERIFIED_EMAIL=true` to skip
    // this gate. Per-provider override also accepted:
    // `AUTHENTIK_TRUST_UNVERIFIED_EMAIL=true` only skips for Authentik,
    // keeps Google strict (since Google's claim is reliable).
    const trustGlobal = process.env.OIDC_TRUST_UNVERIFIED_EMAIL === "true";
    const trustAuthentik = process.env.AUTHENTIK_TRUST_UNVERIFIED_EMAIL === "true";
    const skipVerifyCheck = trustGlobal || (provider === "authentik" && trustAuthentik);
    if (!emailVerifiedClaim && !skipVerifyCheck) {
      req.log.warn({ provider, sub: rawSub }, "OIDC sign-in rejected: email not verified");
      loginRedirect(res, "email_unverified");
      return;
    }
    if (!emailVerifiedClaim && skipVerifyCheck) {
      req.log.warn({ provider, sub: rawSub }, "Accepting unverified OIDC email per OIDC_TRUST_UNVERIFIED_EMAIL / AUTHENTIK_TRUST_UNVERIFIED_EMAIL");
    }

    // Google-only Workspace gate. The `hd` query param above is UX; this is
    // the actual enforcement.
    if (provider === "google" && cfg.hostedDomain && hd !== cfg.hostedDomain) {
      req.log.warn({ provider, email, hd, expected: cfg.hostedDomain }, "OIDC sign-in rejected: wrong hosted domain");
      loginRedirect(res, "wrong_domain");
      return;
    }

    // Prefix the sub with the provider so the same `sub` value from two
    // different IdPs (Google numeric vs Authentik UUID) can't collide on
    // the unique index, and so a user signing in via both Authentik AND
    // Google ends up as two distinct rows. Unification at the human level
    // happens via members.email -> users.email, not via the IdP sub.
    const sub = `${provider}:${rawSub}`;

    // Look up the existing user (if any). We deliberately do NOT use an
    // unconditional upsert here because the invite gate must run BEFORE
    // we create a new row — otherwise we'd pollute the users table with
    // every drive-by Google account that hits the callback.
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.sub, sub)).limit(1);

    const now = new Date();
    let userId: number;
    let userIsActive: boolean;

    if (existing) {
      // Returning user. Refresh their profile + lastLoginAt; never touch
      // isAdmin or isActive here (preserved across logins so admin
      // approvals stick).
      await db.update(usersTable)
        .set({ email, name, picture, lastLoginAt: now })
        .where(eq(usersTable.id, existing.id));
      userId = existing.id;
      userIsActive = existing.isActive;
    } else {
      // New user. Apply the invite gate.
      const invited = await memberExistsForEmail(email);
      if (!invited) {
        // Deliberately respond with the same `pending` code we use for invited-
        // but-not-yet-active users. The public callback would otherwise be a
        // membership oracle (try an email, watch which error code comes back).
        // The server log keeps the real reason for the operator.
        req.log.warn({ provider, email }, "OIDC sign-in rejected: no invite (no matching member row)");
        loginRedirect(res, "pending");
        return;
      }
      // Invited — create the user as INACTIVE. They cannot sign in until an
      // admin flips is_active. We still create the row so the admin sees a
      // pending-approval entry in /admin/users.
      const [row] = await db.insert(usersTable)
        .values({ sub, email, name, picture, isAdmin: false, isActive: false, lastLoginAt: now })
        .returning({ id: usersTable.id });
      userId = row!.id;
      userIsActive = false;
      try {
        const linked = await linkUserToMembersByEmail(userId, email);
        req.log.info({ userId, provider, email, linked }, "new OIDC user created (pending approval)");
      } catch (err) {
        req.log.error({ err, userId }, "linkUserToMembersByEmail failed (oidc new user)");
      }
    }

    if (!userIsActive) {
      // Don't create a session — they're locked out until an admin acts.
      loginRedirect(res, "pending");
      return;
    }

    // Re-link on every successful OIDC login. Authentik changing the user's
    // primary email also updates the link to whatever roster row matches
    // the new address.
    try {
      await linkUserToMembersByEmail(userId, email);
    } catch (err) {
      req.log.error({ err, userId }, "linkUserToMembersByEmail failed (oidc returning user)");
    }

    const returnTo = safeReturnTo(stored.returnTo);
    // Rotate the session id on the auth boundary (defends against fixation).
    await regenerateSession(req);
    req.session.userId = userId;
    await saveSession(req);
    res.redirect(returnTo);
  } catch (err) {
    req.log.error({ err, provider }, "OIDC callback failed");
    res.status(500).send("Sign-in failed. Please try again.");
  }
}

// Authentik — legacy paths preserved so existing IdP registrations keep working.
// GET /api/auth/oidc/login (start) + GET /api/auth/callback (return).
router.get("/auth/oidc/login", (req, res) => {
  if (!isAuthConfigured()) {
    res.status(503).json({ error: "OIDC authentication is not configured on this server." });
    return;
  }
  void startOidcFlow("authentik", req, res);
});
router.get("/auth/callback", (req, res) => {
  void handleOidcCallback("authentik", req, res);
});

// Google — new paths. Redirect URI registered in Google Cloud Console must be
// `${PUBLIC_URL}/api/auth/google/callback`.
router.get("/auth/google/login", (req, res) => {
  void startOidcFlow("google", req, res);
});
router.get("/auth/google/callback", (req, res) => {
  void handleOidcCallback("google", req, res);
});

// ─── Session ─────────────────────────────────────────────────────────────────

// GET /api/auth/me — current user. Returns the user even if inactive so the
// frontend can render the "pending approval" screen with their identity.
router.get("/auth/me", async (req, res): Promise<void> => {
  const id = req.session.userId;
  if (!id) { res.status(401).json({ error: "Not authenticated" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) {
    req.session.destroy(() => res.status(401).json({ error: "Not authenticated" }));
    return;
  }
  res.json(publicUser(user));
});

// Shared gate for authenticated /auth/* endpoints. We still need an active
// account to change a password or do anything privileged — the only
// authenticated endpoints exempt from this are `/auth/me` (the frontend
// needs the identity to render the "pending" screen) and `/auth/logout`
// (always allow the user to end their own session, even if suspended).
async function requireActiveSelf(req: Request, res: Response): Promise<typeof usersTable.$inferSelect | null> {
  const id = req.session.userId;
  if (!id) { res.status(401).json({ error: "Not authenticated" }); return null; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return null; }
  if (!user.isActive) {
    res.status(403).json({ error: "Your account is not active.", code: "account_inactive" });
    return null;
  }
  return user;
}

// POST /api/auth/change-password — local accounts only.
// Verifies the current password first (defeats lost-laptop-with-open-session
// attacks). OIDC accounts have no password to change — they manage credentials
// in the IdP.
const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});
router.post("/auth/change-password", async (req, res): Promise<void> => {
  const user = await requireActiveSelf(req, res);
  if (!user) return;
  const id = user.id;
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    // Surface the most user-relevant message instead of a blanket "password too short".
    const issues = parsed.error.issues;
    const newPwIssue = issues.find(i => i.path[0] === "newPassword");
    const currentPwIssue = issues.find(i => i.path[0] === "currentPassword");
    const msg = newPwIssue
      ? "New password must be at least 8 characters."
      : currentPwIssue
        ? "Current password is required."
        : "Invalid request.";
    res.status(400).json({ error: msg });
    return;
  }
  if (!user.passwordHash) {
    res.status(400).json({ error: "This account doesn't use a local password." });
    return;
  }
  const ok = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!ok) { res.status(401).json({ error: "Current password is incorrect." }); return; }
  const newHash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_COST);
  await db.update(usersTable).set({ passwordHash: newHash }).where(eq(usersTable.id, id));
  res.json({ ok: true });
});

// POST /api/auth/logout — destroy session, return Authentik end-session URL if available
router.post("/auth/logout", async (req, res): Promise<void> => {
  const sendLogout = async () => {
    let endSessionUrl: string | null = null;
    try {
      // Only Authentik exposes an end-session URL; Google's flow is fire-
      // and-forget on logout (no RP-initiated logout). If both are configured
      // we still prefer Authentik so multi-IdP installs get IdP-level logout
      // when they were on Authentik. (Best-effort — failures fall back to a
      // local-session-only logout.)
      const cfg = readOidcConfig();
      if (cfg && cfg.provider === "authentik") {
        const client = await getOidcClient("authentik");
        if (typeof client.endSessionUrl === "function") {
          endSessionUrl = client.endSessionUrl({
            post_logout_redirect_uri: cfg.postLogoutRedirectUri,
          });
        }
      }
    } catch {
      // If we can't reach the IdP, still clear the local session
    }
    res.json({ endSessionUrl });
  };
  if (!req.session) { await sendLogout(); return; }
  req.session.destroy((err) => {
    if (err) { req.log.error({ err }, "session destroy failed"); }
    res.clearCookie("studiopm.sid");
    void sendLogout();
  });
});

export default router;
