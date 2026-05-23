import { Router } from "express";
import { isCollaboraConfigured } from "../lib/wopi-token";
import { isAuthConfigured } from "../lib/oidc";
import { anyAdminExists } from "./auth";

const router = Router();

router.get("/config", async (_req, res): Promise<void> => {
  const needsBootstrap = !(await anyAdminExists());
  res.json({
    collaboraEnabled: isCollaboraConfigured(),
    // Local accounts are always available — keep authEnabled true for clients
    // that still inspect this flag.
    authEnabled: true,
    oidcEnabled: isAuthConfigured(),
    // True when no admin account exists yet — the login page shows the
    // first-run bootstrap form instead of the sign-in form.
    needsBootstrap,
  });
});

export default router;
