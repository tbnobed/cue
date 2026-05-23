import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    oidc?: {
      state?: string;
      codeVerifier?: string;
      nonce?: string;
      returnTo?: string;
    };
  }
}
