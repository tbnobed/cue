import { Router } from "express";
import { isCollaboraConfigured } from "../lib/wopi-token";
import { isAuthConfigured } from "../lib/oidc";

const router = Router();

router.get("/config", (_req, res) => {
  res.json({
    collaboraEnabled: isCollaboraConfigured(),
    authEnabled: isAuthConfigured(),
  });
});

export default router;
