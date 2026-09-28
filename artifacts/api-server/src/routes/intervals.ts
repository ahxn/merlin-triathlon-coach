import { Router, type IRouter, type RequestHandler } from "express";

const router: IRouter = Router();
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

router.get("/integrations/intervals/status", (_req, res) => {
  res.json({
    configured: Boolean(process.env.INTERVALS_API_KEY),
    athleteId: process.env.INTERVALS_ATHLETE_ID || "0",
  });
});

router.get("/integrations/intervals/calendar", asyncRoute(async (req, res) => {
  const apiKey = process.env.INTERVALS_API_KEY;
  if (!apiKey) return void res.status(503).json({ error: "Intervals.icu is not configured on the server." });

  const from = req.query.from;
  const to = req.query.to;
  if (typeof from !== "string" || !datePattern.test(from) || typeof to !== "string" || !datePattern.test(to) || from > to) {
    return void res.status(400).json({ error: "Provide valid from and to dates in YYYY-MM-DD format." });
  }

  const athleteId = encodeURIComponent(process.env.INTERVALS_ATHLETE_ID || "0");
  const dateQuery = new URLSearchParams({ oldest: from, newest: to });
  const workoutQuery = new URLSearchParams({ oldest: from, newest: to, resolve: "true" });
  const authorization = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`;
  const requestOptions: RequestInit = {
    headers: { Accept: "application/json", Authorization: authorization, "User-Agent": "IntervalsIntegratedCoach/1.0" },
    signal: AbortSignal.timeout(15_000),
  };

  const [eventsResponse, activitiesResponse] = await Promise.all([
    fetch(`https://intervals.icu/api/v1/athlete/${athleteId}/events?${workoutQuery}`, requestOptions),
    fetch(`https://intervals.icu/api/v1/athlete/${athleteId}/activities?${dateQuery}&limit=500`, requestOptions),
  ]);

  const failed = [eventsResponse, activitiesResponse].find((response) => !response.ok);
  if (failed) {
    if (failed.status === 401 || failed.status === 403) return void res.status(502).json({ error: "Intervals.icu did not accept the configured API key or athlete access." });
    if (failed.status === 429) return void res.status(502).json({ error: "Intervals.icu rate limit reached. Try again later." });
    return void res.status(502).json({ error: "Intervals.icu could not provide training data right now." });
  }

  const [events, activities] = await Promise.all([eventsResponse.json(), activitiesResponse.json()]);
  if (!Array.isArray(events) || !Array.isArray(activities)) return void res.status(502).json({ error: "Intervals.icu returned an unexpected response." });
  res.json({ events, activities, syncedAt: new Date().toISOString() });
}));

router.get("/integrations/intervals/wellness", asyncRoute(async (req, res) => {
  const apiKey = process.env.INTERVALS_API_KEY;
  if (!apiKey) return void res.status(503).json({ error: "Intervals.icu is not configured on the server." });
  const oldest = req.query.oldest;
  const newest = req.query.newest;
  if (typeof oldest !== "string" || !datePattern.test(oldest) || typeof newest !== "string" || !datePattern.test(newest) || oldest > newest) {
    return void res.status(400).json({ error: "Provide valid oldest and newest dates in YYYY-MM-DD format." });
  }
  const athleteId = encodeURIComponent(process.env.INTERVALS_ATHLETE_ID || "0");
  const query = new URLSearchParams({ oldest, newest });
  const authorization = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`;
  const response = await fetch(`https://intervals.icu/api/v1/athlete/${athleteId}/wellness?${query}`, {
    headers: { Accept: "application/json", Authorization: authorization, "User-Agent": "IntervalsIntegratedCoach/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) return void res.status(502).json({ error: "Intervals.icu did not accept the configured API key or athlete access." });
    if (response.status === 429) return void res.status(502).json({ error: "Intervals.icu rate limit reached. Try again later." });
    return void res.status(502).json({ error: "Intervals.icu could not provide wellness data right now." });
  }
  const records = await response.json();
  if (!Array.isArray(records)) return void res.status(502).json({ error: "Intervals.icu returned an unexpected wellness response." });
  res.json({ records, syncedAt: new Date().toISOString() });
}));

router.get("/integrations/intervals/activity/:activityId", asyncRoute(async (req, res) => {
  const apiKey = process.env.INTERVALS_API_KEY;
  if (!apiKey) return void res.status(503).json({ error: "Intervals.icu is not configured on the server." });
  const activityIdParam = req.params.activityId;
  const activityId = Array.isArray(activityIdParam) ? activityIdParam[0] : activityIdParam;
  if (!activityId || !/^[A-Za-z0-9_-]+$/.test(activityId)) return void res.status(400).json({ error: "Provide a valid Intervals.icu activity ID." });
  const authorization = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`;
  const response = await fetch(`https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}?intervals=true`, {
    headers: { Accept: "application/json", Authorization: authorization, "User-Agent": "IntervalsIntegratedCoach/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) return void res.status(502).json({ error: "Intervals.icu did not accept the configured API key or athlete access." });
    if (response.status === 404) return void res.status(404).json({ error: "This activity could not be found in Intervals.icu." });
    if (response.status === 429) return void res.status(502).json({ error: "Intervals.icu rate limit reached. Try again later." });
    return void res.status(502).json({ error: "Intervals.icu could not provide activity details right now." });
  }
  res.json(await response.json());
}));

export default router;
