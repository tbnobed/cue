import "express-session";
import type { ProviderId } from "../lib/oidc";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    oidc?: {
      // Which IdP this in-flight handshake is talking to. Pinned at /login
      // so the callback can pick the right client + reject cross-provider
      // tampering (you can't start an Authentik flow and finish it via the
      // Google callback URL).
      provider?: ProviderId;
      state?: string;
      codeVerifier?: string;
      nonce?: string;
      returnTo?: string;
    };
  }
}
