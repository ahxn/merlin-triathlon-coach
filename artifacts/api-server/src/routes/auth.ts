import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();
router.get("/auth/me", requireAuth, (req, res) => {
  res.json({ userId: req.auth!.userId, email: req.auth!.email, athleteId: req.auth!.athleteId });
});
export default router;
