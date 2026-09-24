const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:5000/api";

export const ATHLETE_ID = "b3bc616f-3d6b-4764-9dd9-5a502faebc52";

export type AthleteRecord = {
  id: string;
  name: string;
  email: string | null;
  timezone: string;
  availabilityDays: string[];
  preferences: { coachTone: string; notifications: boolean };
};

export type GoalRecord = {
  id: string;
  type: string;
  name: string;
  targetDate: string | null;
  targetValue: string | null;
  targetUnit: string | null;
  notes: string | null;
};

export type CheckInRecord = {
  id: string;
  checkInDate: string;
  readiness: number;
  energy: number | null;
  soreness: number | null;
  stress: number | null;
  illnessSignal: string | null;
  notes: string | null;
};

export type RecommendationChange = {
  workoutId?: string;
  field: string;
  from?: unknown;
  to: unknown;
};

export type RecommendationRecord = {
  id: string;
  checkInId: string | null;
  status: "pending" | "approved" | "edited" | "dismissed";
  title: string;
  reasoning: string;
  proposedChanges: RecommendationChange[];
  athleteNotes: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export type IntervalsEvent = {
  id: number;
  category?: string;
  start_date_local?: string;
  type?: string;
  name?: string;
  description?: string;
  moving_time?: number;
  distance?: number;
  icu_intensity?: number;
};

export type IntervalsActivity = {
  id: number;
  start_date_local?: string;
  start_date?: string;
  type?: string;
  name?: string;
  description?: string;
  moving_time?: number;
  distance?: number;
  paired_event_id?: number;
  average_heartrate?: number;
  icu_training_load?: number;
  device_name?: string;
};

export type IntervalsStatus = { configured: boolean; athleteId: string };
export type IntervalsCalendar = {
  events: IntervalsEvent[];
  activities: IntervalsActivity[];
  syncedAt: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || `Request failed (${response.status})`);
  }
  return body as T;
}

export const dataApi = {
  athlete: (id = ATHLETE_ID) => request<AthleteRecord>(`/athletes/${id}`),
  goals: (id = ATHLETE_ID) => request<GoalRecord[]>(`/athletes/${id}/goals`),
  checkIns: (id = ATHLETE_ID) => request<CheckInRecord[]>(`/athletes/${id}/check-ins`),
  recommendations: (id = ATHLETE_ID) => request<RecommendationRecord[]>(`/athletes/${id}/recommendations`),
  updateAthlete: (body: Partial<Omit<AthleteRecord, "id">>) => request<AthleteRecord>(`/athletes/${ATHLETE_ID}`, { method: "PATCH", body: JSON.stringify(body) }),
  createGoal: (body: Omit<GoalRecord, "id">) => request<GoalRecord>(`/athletes/${ATHLETE_ID}/goals`, { method: "POST", body: JSON.stringify(body) }),
  updateGoal: (id: string, body: Partial<Omit<GoalRecord, "id">>) => request<GoalRecord>(`/athletes/${ATHLETE_ID}/goals/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  saveCheckIn: (body: Omit<CheckInRecord, "id">) => request<CheckInRecord>(`/athletes/${ATHLETE_ID}/check-ins`, { method: "POST", body: JSON.stringify(body) }),
  updateRecommendation: (id: string, body: Partial<RecommendationRecord>) => request<RecommendationRecord>(`/athletes/${ATHLETE_ID}/recommendations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  intervalsStatus: () => request<IntervalsStatus>("/integrations/intervals/status"),
  intervalsCalendar: (from: string, to: string) => request<IntervalsCalendar>(`/integrations/intervals/calendar?from=${from}&to=${to}`),
};
