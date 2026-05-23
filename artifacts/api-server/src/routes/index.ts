import { Router, type IRouter } from "express";
import healthRouter from "./health";
import studiosRouter from "./studios";
import milestonesRouter from "./milestones";
import tasksRouter from "./tasks";
import commentsRouter from "./comments";
import membersRouter from "./members";
import dashboardRouter from "./dashboard";
import documentsRouter from "./documents";
import collabRouter from "./collab";
import wopiRouter from "./wopi";
import configRouter from "./config";

const router: IRouter = Router();

router.use(healthRouter);
router.use(configRouter);
router.use(studiosRouter);
router.use(milestonesRouter);
router.use(tasksRouter);
router.use(commentsRouter);
router.use(membersRouter);
router.use(dashboardRouter);
router.use(documentsRouter);
router.use(collabRouter);
router.use(wopiRouter);

export default router;
