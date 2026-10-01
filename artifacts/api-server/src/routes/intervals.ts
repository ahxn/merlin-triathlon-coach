import { Router, type IRouter, type Request, type RequestHandler } from "express";
import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, userApiCredentials } from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
router.use(requireAuth);
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

function encryptionKey(): Buffer {
  const value = process.env.INTERVALS_CREDENTIAL_ENCRYPTION_KEY;
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) throw new Error("Set INTERVALS_CREDENTIAL_ENCRYPTION_KEY to a random 32-byte hex value.");
  return Buffer.from(value, "hex");
}

async function storedCredentials(req: Request) {
  const row = await db.query.userApiCredentials.findFirst({ where: eq(userApiCredentials.authUserId, req.auth!.userId) });
  if (!row) return null;
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(row.apiKeyIv, "hex"));
  decipher.setAuthTag(Buffer.from(row.apiKeyAuthTag, "hex"));
  const apiKey = Buffer.concat([decipher.update(Buffer.from(row.apiKeyCiphertext, "hex")), decipher.final()]).toString("utf8");
  return { apiKey, athleteId: row.intervalsAthleteId };
}

router.put("/integrations/intervals/credentials", asyncRoute(async (req, res) => {
  const athleteId = typeof req.body?.athleteId === "string" ? req.body.athleteId.trim() : "";
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(athleteId) || apiKey.length < 8 || apiKey.length > 512) return void res.status(400).json({ error: "Enter a valid Intervals.icu athlete ID and API key." });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  await db.insert(userApiCredentials).values({ authUserId: req.auth!.userId, intervalsAthleteId: athleteId, apiKeyCiphertext: encrypted.toString("hex"), apiKeyIv: iv.toString("hex"), apiKeyAuthTag: cipher.getAuthTag().toString("hex") }).onConflictDoUpdate({
    target: userApiCredentials.authUserId,
    set: { intervalsAthleteId: athleteId, apiKeyCiphertext: encrypted.toString("hex"), apiKeyIv: iv.toString("hex"), apiKeyAuthTag: cipher.getAuthTag().toString("hex"), updatedAt: new Date() },
  });
  res.json({ configured: true, athleteId });
}));

router.delete("/integrations/intervals/credentials", asyncRoute(async (req, res) => {
  await db.delete(userApiCredentials).where(eq(userApiCredentials.authUserId, req.auth!.userId));
  res.status(204).send();
}));


router.get("/integrations/intervals/status", asyncRoute(async (req, res) => {
  const credentials = await storedCredentials(req);
  res.json({ configured: Boolean(credentials), athleteId: credentials?.athleteId ?? "0" });
}));

router.get("/integrations/intervals/athlete-settings", asyncRoute(async (req, res) => {
  const credentials = await storedCredentials(req);
  const apiKey = credentials?.apiKey;
  if (!apiKey) return void res.status(503).json({ error: "Intervals.icu is not connected to your account." });
  const athleteId = encodeURIComponent(credentials?.athleteId ?? "0");
  const response = await fetch(`https://intervals.icu/api/v1/athlete/${athleteId}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`,
      "User-Agent": "IntervalsIntegratedCoach/1.0",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) return void res.status(502).json({ error: "Intervals.icu did not accept your API key or athlete access." });
    if (response.status === 429) return void res.status(502).json({ error: "Intervals.icu rate limit reached. Try again later." });
    return void res.status(502).json({ error: "Intervals.icu could not provide athlete settings right now." });
  }
  const athlete = await response.json() as {
    max_hr?: unknown;
    sportSettings?: Array<{ types?: unknown; max_hr?: unknown; hr_zones?: unknown; hr_zone_names?: unknown }>;
  };
  const sportSettings = Array.isArray(athlete.sportSettings) ? athlete.sportSettings : [];
  const settingsFor = (sport: "Run" | "Ride") => sportSettings.find((settings) => Array.isArray(settings.types) && settings.types.includes(sport));
  const readSportSettings = (settings: typeof sportSettings[number] | undefined) => {
    const maxHeartRate = typeof settings?.max_hr === "number" && Number.isFinite(settings.max_hr) ? settings.max_hr : null;
    const zones = Array.isArray(settings?.hr_zones) && settings.hr_zones.every((value) => typeof value === "number" && Number.isFinite(value))
      ? settings.hr_zones as number[]
      : null;
    const zoneNames = Array.isArray(settings?.hr_zone_names) && settings.hr_zone_names.every((value) => typeof value === "string")
      ? settings.hr_zone_names as string[]
      : null;
    return { maxHeartRate, zones, zoneNames };
  };
  const run = readSportSettings(settingsFor("Run"));
  const bike = readSportSettings(settingsFor("Ride"));
  const athleteMaxHeartRate = typeof athlete.max_hr === "number" && Number.isFinite(athlete.max_hr) ? athlete.max_hr : null;
  res.json({ maxHeartRate: athleteMaxHeartRate ?? run.maxHeartRate ?? bike.maxHeartRate, run, bike });
}));

router.get("/integrations/intervals/calendar", asyncRoute(async (req, res) => {
  const credentials = await storedCredentials(req);
  const apiKey = credentials?.apiKey;
  if (!apiKey) return void res.status(503).json({ error: "Intervals.icu is not connected to your account." });

  const from = req.query.from;
  const to = req.query.to;
  if (typeof from !== "string" || !datePattern.test(from) || typeof to !== "string" || !datePattern.test(to) || from > to) {
    return void res.status(400).json({ error: "Provide valid from and to dates in YYYY-MM-DD format." });
  }

  const athleteId = encodeURIComponent(credentials?.athleteId ?? "0");
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
    if (failed.status === 401 || failed.status === 403) return void res.status(502).json({ error: "Intervals.icu did not accept your API key or athlete access." });
    if (failed.status === 429) return void res.status(502).json({ error: "Intervals.icu rate limit reached. Try again later." });
    return void res.status(502).json({ error: "Intervals.icu could not provide training data right now." });
  }

  const [events, activities] = await Promise.all([eventsResponse.json(), activitiesResponse.json()]);
  if (!Array.isArray(events) || !Array.isArray(activities)) return void res.status(502).json({ error: "Intervals.icu returned an unexpected response." });
  res.json({ events, activities, syncedAt: new Date().toISOString() });
}));

router.get("/integrations/intervals/wellness", asyncRoute(async (req, res) => {
  const credentials = await storedCredentials(req);
  const apiKey = credentials?.apiKey;
  if (!apiKey) return void res.status(503).json({ error: "Intervals.icu is not connected to your account." });
  const oldest = req.query.oldest;
  const newest = req.query.newest;
  if (typeof oldest !== "string" || !datePattern.test(oldest) || typeof newest !== "string" || !datePattern.test(newest) || oldest > newest) {
    return void res.status(400).json({ error: "Provide valid oldest and newest dates in YYYY-MM-DD format." });
  }
  const athleteId = encodeURIComponent(credentials?.athleteId ?? "0");
  const query = new URLSearchParams({ oldest, newest });
  const authorization = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`;
  const response = await fetch(`https://intervals.icu/api/v1/athlete/${athleteId}/wellness?${query}`, {
    headers: { Accept: "application/json", Authorization: authorization, "User-Agent": "IntervalsIntegratedCoach/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) return void res.status(502).json({ error: "Intervals.icu did not accept your API key or athlete access." });
    if (response.status === 429) return void res.status(502).json({ error: "Intervals.icu rate limit reached. Try again later." });
    return void res.status(502).json({ error: "Intervals.icu could not provide wellness data right now." });
  }
  const records = await response.json();
  if (!Array.isArray(records)) return void res.status(502).json({ error: "Intervals.icu returned an unexpected wellness response." });
  res.json({ records, syncedAt: new Date().toISOString() });
}));

router.get("/integrations/intervals/activity/:activityId", asyncRoute(async (req, res) => {
  const credentials = await storedCredentials(req);
  const apiKey = credentials?.apiKey;
  if (!apiKey) return void res.status(503).json({ error: "Intervals.icu is not connected to your account." });
  const activityIdParam = req.params.activityId;
  const activityId = Array.isArray(activityIdParam) ? activityIdParam[0] : activityIdParam;
  if (!activityId || !/^[A-Za-z0-9_-]+$/.test(activityId)) return void res.status(400).json({ error: "Provide a valid Intervals.icu activity ID." });
  const authorization = `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`;
  const response = await fetch(`https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}?intervals=true`, {
    headers: { Accept: "application/json", Authorization: authorization, "User-Agent": "IntervalsIntegratedCoach/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) return void res.status(502).json({ error: "Intervals.icu did not accept your API key or athlete access." });
    if (response.status === 404) return void res.status(404).json({ error: "This activity could not be found in Intervals.icu." });
    if (response.status === 429) return void res.status(502).json({ error: "Intervals.icu rate limit reached. Try again later." });
    return void res.status(502).json({ error: "Intervals.icu could not provide activity details right now." });
  }
  res.json(await response.json());
}));

export default router;
