import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import milestonesRouter from "./milestones";
import tasksRouter from "./tasks";
import commentsRouter from "./comments";
import membersRouter from "./members";
import dashboardRouter from "./dashboard";
import documentsRouter from "./documents";
import foldersRouter from "./folders";
import collabRouter from "./collab";
import wopiRouter from "./wopi";
import configRouter from "./config";
import authRouter from "./auth";
import shareLinksRouter from "./share-links";
import publicSharesRouter from "./public-shares";
import { requireAuth } from "../middlewares/require-auth";

const router: IRouter = Router();

// --- Unauthenticated routes ---
// healthz: liveness probe; config: tells frontend whether Collabora/auth are configured;
// auth: the sign-in flow itself; wopi: Collabora calls these with its own HMAC access tokens.
router.use(healthRouter);
router.use(configRouter);
router.use(authRouter);
router.use(wopiRouter);
// public share viewer — read-only, gated by opaque random token.
router.use(publicSharesRouter);

// --- Authenticated routes ---
// All product data routes require a signed-in user.
router.use(requireAuth, projectsRouter);
router.use(requireAuth, milestonesRouter);
router.use(requireAuth, tasksRouter);
router.use(requireAuth, commentsRouter);
router.use(requireAuth, membersRouter);
router.use(requireAuth, dashboardRouter);
router.use(requireAuth, documentsRouter);
router.use(requireAuth, foldersRouter);
router.use(requireAuth, collabRouter);
router.use(requireAuth, shareLinksRouter);

export default router;
