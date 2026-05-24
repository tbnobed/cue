# Authentik (OIDC) setup for Cue

Cue can delegate sign-in to a self-hosted [Authentik](https://goauthentik.io) instance via OpenID Connect. Local email/password accounts always work; Authentik is an **optional second login button** on `/login`.

Authentik users are **always non-admin** — admin rights are intentionally restricted to local accounts so a compromised IdP can't grant them. The first time an Authentik user signs in, Cue auto-creates a non-admin row for them.

---

## 1. In Authentik

### a. Create the Provider

**Applications → Providers → Create → OAuth2/OpenID Provider**

| Field | Value |
|---|---|
| Name | `Cue` |
| Authentication flow | `default-authentication-flow` (or your tenant default) |
| Authorization flow | `default-provider-authorization-explicit-consent` (or implicit if you prefer no consent screen) |
| **Client type** | **Confidential** |
| Client ID | *(auto-generated — copy this)* |
| Client Secret | *(auto-generated — copy this)* |
| **Redirect URIs** | `https://cue.your-domain.tld/api/auth/callback` |
| Signing Key | `authentik Self-signed Certificate` (default) |
| Scopes | `openid`, `profile`, `email` |
| Subject mode | `Based on the User's hashed ID` (default) |

The redirect URI **must match `PUBLIC_URL` + `/api/auth/callback` exactly** — including scheme (`https`), no trailing slash, and the same hostname your browser uses. `localhost` here is the #1 cause of `invalid redirect_uri` errors in production.

### b. Create the Application

**Applications → Applications → Create**

| Field | Value |
|---|---|
| Name | `Cue` |
| Slug | `cue` (or whatever — this becomes part of the issuer URL) |
| Provider | the provider you just made |
| Launch URL | `https://cue.your-domain.tld/` |

### c. Assign access

By default in Authentik, applications are visible to all users. To restrict:

**Applications → Applications → Cue → Policy / Group / User Bindings → Bind existing group**, e.g. bind a `cue-users` group.

### d. Copy the issuer URL

**Applications → Providers → Cue → OpenID Configuration URL** ends in `/.well-known/openid-configuration`. The **issuer** is everything before `.well-known/`:

```
https://auth.your-domain.tld/application/o/cue/
```

(Note the trailing slash — keep it.)

---

## 2. In Cue (`.env`)

Set all four — Authentik is enabled only when every variable is present:

```bash
PUBLIC_URL=https://cue.your-domain.tld
AUTHENTIK_ISSUER=https://auth.your-domain.tld/application/o/cue/
AUTHENTIK_CLIENT_ID=<from Authentik>
AUTHENTIK_CLIENT_SECRET=<from Authentik>
```

Then:

```bash
docker compose up -d --force-recreate app
```

`/login` now shows a **"Continue with Authentik"** button under the email/password form.

---

## 3. Verify

1. Open `https://cue.your-domain.tld/login` in a private window.
2. Click **Continue with Authentik** → you should land on Authentik's login page.
3. After signing in, you bounce back to Cue and land on the dashboard.
4. As an admin, open **/admin/users** — the new user appears in the **Authentik accounts** section with a globe icon. They can never be toggled to admin from this UI (the switch is disabled with an explanation).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `invalid redirect_uri` from Authentik | `PUBLIC_URL` mismatch | The redirect URI in Authentik must be character-for-character `PUBLIC_URL` + `/api/auth/callback`. Watch for `http` vs `https`, trailing slashes, and `localhost` vs your real hostname. |
| No "Continue with Authentik" button appears | One of the four env vars is missing or empty | `docker compose exec app env \| grep AUTHENTIK` — all three plus `PUBLIC_URL` must be set, then recreate the container. |
| `discovery failed` in app logs at startup | `AUTHENTIK_ISSUER` wrong, or the app container can't reach Authentik over the network | Ensure the issuer URL resolves from inside the container: `docker compose exec app wget -qO- $AUTHENTIK_ISSUER/.well-known/openid-configuration`. |
| User signs in, comes back, gets "Not authenticated" | Cookie was set on a different host than the browser sees | `PUBLIC_URL` host must match the URL the user typed. If you're behind a reverse proxy, make sure it forwards `Host` and `X-Forwarded-Proto`. |
| I want to promote an Authentik user to admin | Not allowed by design | Either give them a separate local admin account, or `UPDATE users SET is_admin=true WHERE id=…` directly in Postgres (and accept that the next OIDC sign-in won't reset it — admin status is sticky once set by SQL, but the UI still won't expose the toggle for OIDC rows). |

---

## How it works (for reference)

- `GET /api/auth/oidc/login?returnTo=…` — starts the PKCE+state flow, redirects to Authentik
- `GET /api/auth/callback` — Authentik posts back here; Cue verifies state, exchanges the code, upserts the user row keyed on `sub`, and creates a session
- `POST /api/auth/logout` — destroys the local session and returns Authentik's `end_session_endpoint` URL so the frontend can optionally log the user out of Authentik too
- The OIDC client is built once at startup using `openid-client` and the issuer's discovery document; if discovery fails the app still boots — only the OIDC button is hidden
