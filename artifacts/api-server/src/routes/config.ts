import { Router } from "express";
import { isCollaboraConfigured } from "../lib/wopi-token";
import { listConfiguredProviders } from "../lib/oidc";

const router = Router();

// /api/config is unauthenticated. Only return information the login page
// genuinely needs to render — never leak server provisioning state (e.g.
// "no admin exists yet") because that fingerprints fresh installs for
// attackers and tells them where to point a scanner.
//
// `oidcProviders` is the list of OIDC IdPs the operator has configured. The
// login page renders one button per entry. `oidcEnabled` is kept for
// backward-compat with older clients that haven't been redeployed yet.
router.get("/config", (_req, res) => {
  const providers = listConfiguredProviders();
  res.json({
    collaboraEnabled: isCollaboraConfigured(),
    authEnabled: true,
    oidcEnabled: providers.length > 0,
    oidcProviders: providers,
  });
});

export default router;
