import { Issuer, generators, type Client } from "openid-client";
import { logger } from "./logger";

// ─── Provider registry ────────────────────────────────────────────────────────
//
// Each provider is independently optional. A self-hoster can configure any
// combination (none, only Authentik, only Google, both). The login page
// renders one button per configured provider; `requireAuth` is provider-
// agnostic.
//
// IMPORTANT — redirect URI shapes:
//   • Authentik uses the legacy /api/auth/callback path because existing
//     self-hosted installs already have it registered in their Authentik
//     Application config. Changing it would force every operator to update
//     their IdP. Don't.
//   • Google (and any future provider) uses /api/auth/<provider>/callback.

export type ProviderId = "authentik" | "google";

export type OidcConfig = {
  provider: ProviderId;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  // Google-only: restrict to a single Workspace domain. When set, the
  // callback rejects any sign-in whose `hd` claim doesn't match.
  hostedDomain?: string | undefined;
};

function publicUrlOrNull(): string | null {
  const u = process.env.PUBLIC_URL;
  return u ? u.replace(/\/$/, "") : null;
}

function readAuthentik(): OidcConfig | null {
  const issuerUrl = process.env.AUTHENTIK_ISSUER;
  const clientId = process.env.AUTHENTIK_CLIENT_ID;
  const clientSecret = process.env.AUTHENTIK_CLIENT_SECRET;
  const publicUrl = publicUrlOrNull();
  if (!issuerUrl || !clientId || !clientSecret || !publicUrl) return null;
  return {
    provider: "authentik",
    issuerUrl,
    clientId,
    clientSecret,
    redirectUri: `${publicUrl}/api/auth/callback`,
    postLogoutRedirectUri: publicUrl + "/",
  };
}

function readGoogle(): OidcConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const publicUrl = publicUrlOrNull();
  if (!clientId || !clientSecret || !publicUrl) return null;
  return {
    provider: "google",
    // Google's well-known issuer — discovery handles all endpoints + keys.
    issuerUrl: "https://accounts.google.com",
    clientId,
    clientSecret,
    redirectUri: `${publicUrl}/api/auth/google/callback`,
    postLogoutRedirectUri: publicUrl + "/",
    hostedDomain: process.env.GOOGLE_HOSTED_DOMAIN || undefined,
  };
}

export function readProviderConfig(provider: ProviderId): OidcConfig | null {
  return provider === "authentik" ? readAuthentik() : readGoogle();
}

export function listConfiguredProviders(): ProviderId[] {
  const out: ProviderId[] = [];
  if (readAuthentik()) out.push("authentik");
  if (readGoogle()) out.push("google");
  return out;
}

// Back-compat shim used by the /auth/logout end-session URL builder.
// Returns whichever provider is currently in use by the active session, or
// just the first configured one. Caller only needs `postLogoutRedirectUri`
// and an end-session URL — both are provider-specific but harmless to mix.
export function readOidcConfig(): OidcConfig | null {
  return readAuthentik() ?? readGoogle();
}

export function isAuthConfigured(): boolean {
  return listConfiguredProviders().length > 0;
}

// ─── Client cache (per-provider) ──────────────────────────────────────────────

const clientCache: Partial<Record<ProviderId, Promise<Client>>> = {};

export function getOidcClient(provider: ProviderId): Promise<Client> {
  const cached = clientCache[provider];
  if (cached) return cached;
  const cfg = readProviderConfig(provider);
  if (!cfg) {
    return Promise.reject(new Error(`${provider} OIDC is not configured`));
  }
  const p = (async () => {
    logger.info({ provider, issuer: cfg.issuerUrl }, "Discovering OIDC issuer");
    const issuer = await Issuer.discover(cfg.issuerUrl);
    const client = new issuer.Client({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uris: [cfg.redirectUri],
      response_types: ["code"],
    });
    logger.info({ provider }, "OIDC client ready");
    return client;
  })().catch((err) => {
    // Allow retry on next request if discovery transiently failed.
    delete clientCache[provider];
    throw err;
  });
  clientCache[provider] = p;
  return p;
}

export { generators };
