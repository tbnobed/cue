import { Router } from "express";
import { isCollaboraConfigured } from "../lib/wopi-token";
import { isAuthConfigured } from "../lib/oidc";

const router = Router();

// /api/config is unauthenticated. Only return information the login page
// genuinely needs to render — never leak server provisioning state (e.g.
// "no admin exists yet") because that fingerprints fresh installs for
// attackers and tells them where to point a scanner.
router.get("/config", (_req, res) => {
  res.json({
    collaboraEnabled: isCollaboraConfigured(),
    authEnabled: true,
    oidcEnabled: isAuthConfigured(),
  });
});

export default router;
