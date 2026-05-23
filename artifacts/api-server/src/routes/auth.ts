import { Router } from "express";
import type { Request } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { generators, getOidcClient, isAuthConfigured, readOidcConfig } from "../lib/oidc";

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
// First-run bootstrap: when the users table has no admin yet, anyone can call
// /auth/signup and they become the first admin. After that, only an existing
// admin may create new local accounts (via the same endpoint).

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

function publicUser(u: { id: number; email: string | null; name: string | null; picture: string | null; isAdmin: boolean }) {
  return { id: u.id, email: u.email, name: u.name, picture: u.picture, isAdmin: u.isAdmin };
}

async function anyAdminExists(): Promise<boolean> {
  const [row] = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.isAdmin, true))
    .limit(1);
  return !!row;
}

async function getSessionUser(userId: number | undefined) {
  if (!userId) return null;
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return u ?? null;
}

// Arbitrary fixed key for the Postgres advisory lock that serializes signup
// attempts. Prevents two concurrent first-run requests from both becoming admin.
const SIGNUP_ADVISORY_LOCK = 4242;

// POST /api/auth/signup
// - If no admin exists yet: open bootstrap — caller becomes the first admin.
// - Otherwise: requires an authenticated admin session. The new account is
//   admin only if the request explicitly asks for it.
router.post("/auth/signup", async (req, res): Promise<void> => {
  const parsed = SignupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const email = parsed.data.email.toLowerCase().trim();
  const name = parsed.data.name?.trim() || email.split("@")[0];

  // Hash up-front, outside the transaction (bcrypt is slow and we don't want
  // to hold a DB transaction open for ~300ms).
  const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_COST);

  // Pre-read actor admin state outside the lock to keep the critical section
  // small. We re-check `anyAdminExists` inside the locked transaction.
  const actorIsAdmin = !!(await getSessionUser(req.session.userId))?.isAdmin;

  let result:
    | { kind: "created"; user: { id: number; email: string | null; name: string | null; picture: string | null; isAdmin: boolean }; bootstrap: boolean }
    | { kind: "error"; status: number; error: string };

  try {
    result = await db.transaction(async (tx) => {
      // Serialize all signup attempts so the bootstrap check + insert is atomic.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${SIGNUP_ADVISORY_LOCK})`);

      const adminRows = await tx.select({ id: usersTable.id })
        .from(usersTable).where(eq(usersTable.isAdmin, true)).limit(1);
      const bootstrap = adminRows.length === 0;

      let makeAdmin: boolean;
      if (bootstrap) {
        makeAdmin = true;
      } else {
        if (!actorIsAdmin) {
          return { kind: "error" as const, status: 403, error: "Only an admin can create new accounts." };
        }
        makeAdmin = parsed.data.isAdmin === true;
      }

      const existing = await tx.select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(sql`lower(${usersTable.email})`, email), isNotNull(usersTable.passwordHash)));
      if (existing.length > 0) {
        return { kind: "error" as const, status: 409, error: "An account with that email already exists." };
      }

      const [user] = await tx.insert(usersTable)
        .values({ email, name, passwordHash, isAdmin: makeAdmin, lastLoginAt: new Date() })
        .returning({
          id: usersTable.id, email: usersTable.email, name: usersTable.name,
          picture: usersTable.picture, isAdmin: usersTable.isAdmin,
        });
      return { kind: "created" as const, user: user!, bootstrap };
    });
  } catch (err) {
    req.log.error({ err }, "signup transaction failed");
    res.status(500).json({ error: "Failed to create account" });
    return;
  }

  if (result.kind === "error") {
    res.status(result.status).json({ error: result.error });
    return;
  }

  // Bootstrap admin is auto-signed-in. Other admin-created accounts are NOT,
  // so the admin's session stays intact.
  if (result.bootstrap) {
    await regenerateSession(req);
    req.session.userId = result.user.id;
    await saveSession(req);
  }
  res.status(201).json(publicUser(result.user));
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

  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
  await regenerateSession(req);
  req.session.userId = user.id;
  await saveSession(req);
  res.json(publicUser(user));
});

// ─── OIDC (Authentik) ─────────────────────────────────────────────────────────

// GET /api/auth/oidc/login — start the OIDC flow
router.get("/auth/oidc/login", async (req, res): Promise<void> => {
  if (!isAuthConfigured()) {
    res.status(503).json({ error: "OIDC authentication is not configured on this server." });
    return;
  }
  try {
    const client = await getOidcClient();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const state = generators.state();
    const nonce = generators.nonce();
    const returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : "/";

    req.session.oidc = { state, codeVerifier, nonce, returnTo };
    await new Promise<void>((r, j) => req.session.save((e) => (e ? j(e) : r())));

    const url = client.authorizationUrl({
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    res.redirect(url);
  } catch (err) {
    req.log.error({ err }, "OIDC login failed");
    res.status(500).json({ error: "Failed to start sign-in" });
  }
});

// GET /api/auth/callback — handle the OIDC redirect back from Authentik.
// OIDC users are NEVER admins (admin rights are restricted to local accounts).
router.get("/auth/callback", async (req, res): Promise<void> => {
  const cfg = readOidcConfig();
  if (!cfg) { res.status(503).send("OIDC authentication not configured"); return; }
  const stored = req.session.oidc;
  if (!stored?.state || !stored.codeVerifier) {
    res.status(400).send("Sign-in session expired. Please try again.");
    return;
  }
  try {
    const client = await getOidcClient();
    const params = client.callbackParams(req);
    const tokenSet = await client.callback(cfg.redirectUri, params, {
      state: stored.state,
      code_verifier: stored.codeVerifier,
      nonce: stored.nonce,
    });
    const claims = tokenSet.claims();
    const sub = String(claims.sub);
    const email = claims.email ? String(claims.email) : null;
    const name = claims.name ? String(claims.name) : (claims.preferred_username ? String(claims.preferred_username) : null);
    const picture = claims.picture ? String(claims.picture) : null;

    // Atomic upsert by sub. We intentionally do NOT touch isAdmin here so an
    // OIDC user can never gain admin rights through a re-login.
    const now = new Date();
    const [row] = await db.insert(usersTable)
      .values({ sub, email, name, picture, isAdmin: false, lastLoginAt: now })
      .onConflictDoUpdate({
        target: usersTable.sub,
        set: { email, name, picture, lastLoginAt: now },
      })
      .returning({ id: usersTable.id });
    const userId = row!.id;

    const returnTo = stored.returnTo && stored.returnTo.startsWith("/") ? stored.returnTo : "/";
    // Rotate the session id on the auth boundary (defends against fixation).
    await regenerateSession(req);
    req.session.userId = userId;
    await saveSession(req);
    res.redirect(returnTo);
  } catch (err) {
    req.log.error({ err }, "OIDC callback failed");
    res.status(500).send("Sign-in failed. Please try again.");
  }
});

// ─── Session ─────────────────────────────────────────────────────────────────

// GET /api/auth/me — current user
router.get("/auth/me", async (req, res): Promise<void> => {
  const id = req.session.userId;
  if (!id) { res.status(401).json({ error: "Not authenticated" }); return; }
  const [user] = await db.select({
    id: usersTable.id,
    email: usersTable.email,
    name: usersTable.name,
    picture: usersTable.picture,
    isAdmin: usersTable.isAdmin,
  }).from(usersTable).where(eq(usersTable.id, id));
  if (!user) {
    req.session.destroy(() => res.status(401).json({ error: "Not authenticated" }));
    return;
  }
  res.json(publicUser(user));
});

// POST /api/auth/logout — destroy session, return Authentik end-session URL if available
router.post("/auth/logout", async (req, res): Promise<void> => {
  const sendLogout = async () => {
    let endSessionUrl: string | null = null;
    try {
      const cfg = readOidcConfig();
      if (cfg) {
        const client = await getOidcClient();
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

export { anyAdminExists };
export default router;
