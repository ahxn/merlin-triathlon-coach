import { Router, type IRouter } from "express";
import healthRouter from "./health";
import intervalsRouter from "./intervals";
import trainingRouter from "./training";

const router: IRouter = Router();

router.use(healthRouter);
router.use(trainingRouter);
router.use(intervalsRouter);

export default router;
