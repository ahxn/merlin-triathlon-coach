import { Router, type IRouter, type RequestHandler } from "express";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import {
  athletes,
  checkIns,
  db,
  goals,
  insertAthleteSchema,
  insertCheckInSchema,
  insertGoalSchema,
  insertRecommendationSchema,
  insertWorkoutSchema,
  recommendations,
  workouts,
} from "@workspace/db";

const router: IRouter = Router();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const athleteIdFrom = (value: string | string[] | undefined) => {
  if (typeof value !== "string" || !uuidPattern.test(value)) return null;
  return value;
};

router.post("/athletes", asyncRoute(async (req, res) => {
  const parsed = insertAthleteSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid athlete", issues: parsed.error.issues });
  const [athlete] = await db.insert(athletes).values(parsed.data).returning();
  res.status(201).json(athlete);
}));

router.get("/athletes/:athleteId", asyncRoute(async (req, res) => {
  const athleteId = athleteIdFrom(req.params.athleteId);
  if (!athleteId) return void res.status(400).json({ error: "Invalid athlete id" });
  const athlete = await db.query.athletes.findFirst({ where: eq(athletes.id, athleteId) });
  if (!athlete) return void res.status(404).json({ error: "Athlete not found" });
  res.json(athlete);
}));

router.patch("/athletes/:athleteId", asyncRoute(async (req, res) => {
  const athleteId = athleteIdFrom(req.params.athleteId);
  if (!athleteId) return void res.status(400).json({ error: "Invalid athlete id" });
  const parsed = insertAthleteSchema.partial().safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid athlete", issues: parsed.error.issues });
  const [athlete] = await db.update(athletes).set({ ...parsed.data, updatedAt: new Date() }).where(eq(athletes.id, athleteId)).returning();
  if (!athlete) return void res.status(404).json({ error: "Athlete not found" });
  res.json(athlete);
}));

router.get("/athletes/:athleteId/goals", asyncRoute(async (req, res) => {
  const athleteId = athleteIdFrom(req.params.athleteId);
  if (!athleteId) return void res.status(400).json({ error: "Invalid athlete id" });
  res.json(await db.select().from(goals).where(eq(goals.athleteId, athleteId)).orderBy(asc(goals.targetDate)));
}));

router.post("/athletes/:athleteId/goals", asyncRoute(async (req, res) => {
  const athleteId = athleteIdFrom(req.params.athleteId);
  if (!athleteId) return void res.status(400).json({ error: "Invalid athlete id" });
  const parsed = insertGoalSchema.safeParse({ ...req.body, athleteId });
  if (!parsed.success) return void res.status(400).json({ error: "Invalid goal", issues: parsed.error.issues });
  const [goal] = await db.insert(goals).values(parsed.data).returning();
  res.status(201).json(goal);
}));

router.patch("/athletes/:athleteId/goals/:goalId", asyncRoute(async (req, res) => {
  const athleteId = athleteIdFrom(req.params.athleteId);
  const goalId = athleteIdFrom(req.params.goalId);
  if (!athleteId || !goalId) return void res.status(400).json({ error: "Invalid id" });
  const parsed = insertGoalSchema.partial().safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid goal", issues: parsed.error.issues });
  const [goal] = await db.update(goals).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(goals.id, goalId), eq(goals.athleteId, athleteId))).returning();
  if (!goal) return void res.status(404).json({ error: "Goal not found" });
  res.json(goal);
}));

router.get("/athletes/:athleteId/workouts", asyncRoute(async (req, res) => {
  const athleteId = athleteIdFrom(req.params.athleteId);
  if (!athleteId) return void res.status(400).json({ error: "Invalid athlete id" });
  const filters = [eq(workouts.athleteId, athleteId)];
  if (typeof req.query.from === "string") filters.push(gte(workouts.scheduledDate, req.query.from));
  if (typeof req.query.to === "string") filters.push(lte(workouts.scheduledDate, req.query.to));
  res.json(await db.select().from(workouts).where(and(...filters)).orderBy(asc(workouts.scheduledDate)));
}));

router.post("/athletes/:athleteId/workouts", asyncRoute(async (req, res) => {
  const athleteId = athleteIdFrom(req.params.athleteId);
  if (!athleteId) return void res.status(400).json({ error: "Invalid athlete id" });
  const parsed = insertWorkoutSchema.safeParse({ ...req.body, athleteId });
  if (!parsed.success) return void res.status(400).json({ error: "Invalid workout", issues: parsed.error.issues });
  const [workout] = await db.insert(workouts).values(parsed.data).returning();
  res.status(201).json(workout);
}));

router.get("/athletes/:athleteId/check-ins", asyncRoute(async (req, res) => {
  const athleteId = athleteIdFrom(req.params.athleteId);
  if (!athleteId) return void res.status(400).json({ error: "Invalid athlete id" });
  res.json(await db.select().from(checkIns).where(eq(checkIns.athleteId, athleteId)).orderBy(desc(checkIns.checkInDate)));
}));

router.post("/athletes/:athleteId/check-ins", asyncRoute(async (req, res) => {
  const athleteId = athleteIdFrom(req.params.athleteId);
  if (!athleteId) return void res.status(400).json({ error: "Invalid athlete id" });
  const parsed = insertCheckInSchema.safeParse({ ...req.body, athleteId });
  if (!parsed.success) return void res.status(400).json({ error: "Invalid check-in", issues: parsed.error.issues });
  const [checkIn] = await db.insert(checkIns).values(parsed.data).onConflictDoUpdate({
    target: [checkIns.athleteId, checkIns.checkInDate],
    set: { ...parsed.data, updatedAt: new Date() },
  }).returning();
  res.json(checkIn);
}));

router.get("/athletes/:athleteId/recommendations", asyncRoute(async (req, res) => {
  const athleteId = athleteIdFrom(req.params.athleteId);
  if (!athleteId) return void res.status(400).json({ error: "Invalid athlete id" });
  res.json(await db.select().from(recommendations).where(eq(recommendations.athleteId, athleteId)).orderBy(desc(recommendations.createdAt)));
}));

router.post("/athletes/:athleteId/recommendations", asyncRoute(async (req, res) => {
  const athleteId = athleteIdFrom(req.params.athleteId);
  if (!athleteId) return void res.status(400).json({ error: "Invalid athlete id" });
  const parsed = insertRecommendationSchema.safeParse({ ...req.body, athleteId });
  if (!parsed.success) return void res.status(400).json({ error: "Invalid recommendation", issues: parsed.error.issues });
  const [recommendation] = await db.insert(recommendations).values(parsed.data).returning();
  res.status(201).json(recommendation);
}));

router.patch("/athletes/:athleteId/recommendations/:recommendationId", asyncRoute(async (req, res) => {
  const athleteId = athleteIdFrom(req.params.athleteId);
  const recommendationId = athleteIdFrom(req.params.recommendationId);
  if (!athleteId || !recommendationId) return void res.status(400).json({ error: "Invalid id" });
  const parsed = insertRecommendationSchema.partial().safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid recommendation", issues: parsed.error.issues });
  const decidedAt = parsed.data.status && parsed.data.status !== "pending" ? new Date() : null;
  const [recommendation] = await db.update(recommendations).set({ ...parsed.data, decidedAt, updatedAt: new Date() }).where(and(eq(recommendations.id, recommendationId), eq(recommendations.athleteId, athleteId))).returning();
  if (!recommendation) return void res.status(404).json({ error: "Recommendation not found" });
  res.json(recommendation);
}));

export default router;
