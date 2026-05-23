import { Router } from "express";
import { isCollaboraConfigured } from "../lib/wopi-token";

const router = Router();

router.get("/config", (_req, res) => {
  res.json({
    collaboraEnabled: isCollaboraConfigured(),
  });
});

export default router;
