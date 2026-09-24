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
  const query = new URLSearchParams({ oldest: from, newest: to });
  const authorization = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`;
  const requestOptions: RequestInit = {
    headers: { Accept: "application/json", Authorization: authorization, "User-Agent": "IntervalsIntegratedCoach/1.0" },
    signal: AbortSignal.timeout(15_000),
  };

  const [eventsResponse, activitiesResponse] = await Promise.all([
    fetch(`https://intervals.icu/api/v1/athlete/${athleteId}/events?${query}`, requestOptions),
    fetch(`https://intervals.icu/api/v1/athlete/${athleteId}/activities?${query}&limit=500`, requestOptions),
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

export default router;
