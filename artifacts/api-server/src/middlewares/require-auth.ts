import type { Request, Response, NextFunction } from "express";
import { isAuthConfigured } from "../lib/oidc";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Guest mode: when AUTHENTIK_* env vars are unset, the app runs without
  // authentication so local development is unblocked. The frontend renders
  // a synthetic guest user via /api/config; let server requests through too.
  if (!isAuthConfigured()) {
    next();
    return;
  }
  if (req.session?.userId) {
    next();
    return;
  }
  res.status(401).json({ error: "Authentication required" });
}
