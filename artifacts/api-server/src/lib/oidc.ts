import { Issuer, generators, type Client } from "openid-client";
import { logger } from "./logger";

export type OidcConfig = {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
};

export function readOidcConfig(): OidcConfig | null {
  const issuerUrl = process.env.AUTHENTIK_ISSUER;
  const clientId = process.env.AUTHENTIK_CLIENT_ID;
  const clientSecret = process.env.AUTHENTIK_CLIENT_SECRET;
  const publicUrl = process.env.PUBLIC_URL;
  if (!issuerUrl || !clientId || !clientSecret || !publicUrl) return null;
  return {
    issuerUrl,
    clientId,
    clientSecret,
    redirectUri: `${publicUrl.replace(/\/$/, "")}/api/auth/callback`,
    postLogoutRedirectUri: publicUrl.replace(/\/$/, "") + "/",
  };
}

let cachedClient: Promise<Client> | null = null;

export function getOidcClient(): Promise<Client> {
  if (cachedClient) return cachedClient;
  const cfg = readOidcConfig();
  if (!cfg) {
    return Promise.reject(new Error("Authentik OIDC is not configured (missing AUTHENTIK_* or PUBLIC_URL)"));
  }
  cachedClient = (async () => {
    logger.info({ issuer: cfg.issuerUrl }, "Discovering Authentik OIDC issuer");
    const issuer = await Issuer.discover(cfg.issuerUrl);
    const client = new issuer.Client({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uris: [cfg.redirectUri],
      response_types: ["code"],
    });
    logger.info("Authentik OIDC client ready");
    return client;
  })().catch((err) => {
    cachedClient = null; // allow retry on next request
    throw err;
  });
  return cachedClient;
}

export function isAuthConfigured(): boolean {
  return readOidcConfig() !== null;
}

export { generators };
