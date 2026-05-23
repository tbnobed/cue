import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generators, getOidcClient, isAuthConfigured, readOidcConfig } from "../lib/oidc";

const router = Router();

// GET /api/auth/login — start the OIDC flow
router.get("/auth/login", async (req, res): Promise<void> => {
  if (!isAuthConfigured()) {
    res.status(503).json({ error: "Authentication is not configured on this server." });
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

// GET /api/auth/callback — handle the OIDC redirect back from Authentik
router.get("/auth/callback", async (req, res): Promise<void> => {
  const cfg = readOidcConfig();
  if (!cfg) { res.status(503).send("Authentication not configured"); return; }
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

    // Atomic upsert by sub — avoids unique-constraint races on concurrent first logins.
    const now = new Date();
    const [row] = await db.insert(usersTable)
      .values({ sub, email, name, picture, lastLoginAt: now })
      .onConflictDoUpdate({
        target: usersTable.sub,
        set: { email, name, picture, lastLoginAt: now },
      })
      .returning({ id: usersTable.id });
    const userId = row!.id;

    const returnTo = stored.returnTo && stored.returnTo.startsWith("/") ? stored.returnTo : "/";
    req.session.userId = userId;
    delete req.session.oidc;
    await new Promise<void>((r, j) => req.session.save((e) => (e ? j(e) : r())));
    res.redirect(returnTo);
  } catch (err) {
    req.log.error({ err }, "OIDC callback failed");
    res.status(500).send("Sign-in failed. Please try again.");
  }
});

// GET /api/auth/me — current user
router.get("/auth/me", async (req, res): Promise<void> => {
  const id = req.session.userId;
  if (!id) { res.status(401).json({ error: "Not authenticated" }); return; }
  const [user] = await db.select({
    id: usersTable.id,
    email: usersTable.email,
    name: usersTable.name,
    picture: usersTable.picture,
  }).from(usersTable).where(eq(usersTable.id, id));
  if (!user) {
    // Stale session — clear it
    req.session.destroy(() => res.status(401).json({ error: "Not authenticated" }));
    return;
  }
  res.json(user);
});

// POST /api/auth/logout — destroy session and redirect to Authentik end-session if available
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

export default router;
