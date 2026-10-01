import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import intervalsRouter from "./intervals";
import trainingRouter from "./training";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(trainingRouter);
router.use(intervalsRouter);

export default router;
