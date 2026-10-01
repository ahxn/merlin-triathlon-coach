import type { Request, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { athletes, db } from "@workspace/db";

declare global {
  namespace Express { interface Request { auth?: { userId: string; email: string | null; athleteId: string } } }
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const url = process.env.SUPABASE_URL;
    const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !apiKey) return void res.status(503).json({ error: "Authentication is not configured on the server." });
    const header = req.header("authorization");
    const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return void res.status(401).json({ error: "Sign in to continue." });
    const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { apikey: apiKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return void res.status(401).json({ error: "Your session has expired. Sign in again." });
    const user = await response.json() as { id?: unknown; email?: unknown; user_metadata?: Record<string, unknown> };
    if (typeof user.id !== "string" || !/^[0-9a-f-]{36}$/i.test(user.id)) return void res.status(401).json({ error: "Invalid session." });
    let athlete = await db.query.athletes.findFirst({ where: eq(athletes.authUserId, user.id) });
    if (!athlete) {
      const displayName = user.user_metadata?.display_name ?? user.user_metadata?.full_name;
      const name = typeof displayName === "string" && displayName.trim() ? displayName.trim().slice(0, 120) : (typeof user.email === "string" ? user.email.split("@")[0] : "Athlete");
      [athlete] = await db.insert(athletes).values({ authUserId: user.id, name, email: null }).onConflictDoNothing().returning();
      athlete ??= await db.query.athletes.findFirst({ where: eq(athletes.authUserId, user.id) });
    }
    if (!athlete) return void res.status(500).json({ error: "Could not load your athlete profile." });
    req.auth = { userId: user.id, email: typeof user.email === "string" ? user.email : null, athleteId: athlete.id };
    next();
  } catch (error) { next(error); }
};

export function scopedAthleteId(value: string | string[] | undefined, req: Request): string | null {
  const requested = typeof value === "string" ? value : null;
  const ownId = req.auth?.athleteId;
  if (!requested || !ownId) return null;
  if (requested === "me" || requested === ownId) return ownId;
  return null;
}
