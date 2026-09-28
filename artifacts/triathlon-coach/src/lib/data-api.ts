const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:5001/api";

export const ATHLETE_ID = "b3bc616f-3d6b-4764-9dd9-5a502faebc52";

export type RecoveryRhythm = "2:1" | "3:1" | "4:1" | "manual";

export type WorkoutConfirmation = {
  workoutId: string;
  date: string;
  status: "completed" | "skipped";
};

export type PlanWorkoutOverride = {
  workoutId: string;
  date: string;
  restDay?: boolean;
  title?: string;
  durationMinutes?: number;
  intensity?: string;
  workoutDescription?: string;
};

export type PlanPreferences = {
  workoutOverrides?: PlanWorkoutOverride[];
  workoutConfirmations?: WorkoutConfirmation[];
  recoveryRhythm: RecoveryRhythm;
  goalMode: "race" | "consistency";
  volumeBasis: "time" | "distance";
  workoutDisplay: "time" | "distance" | "both";
  primaryFocus: "balanced" | "swim" | "bike" | "run";
  planningMode: "guided" | "self-managed";
  manualSessions: Array<{ id: string; day: string; sport: "swim" | "bike" | "run"; title: string; duration: string; intensity: string; quality: boolean; durationMinutes?: number; workoutDescription?: string }>;
  sessionsPerWeek: number;
  restDaysPerWeek: number;
  maxSessionMinutes: number;
  timeTargets: {
    swim: { weekly: number | null; peak: number | null };
    bike: { weekly: number | null; peak: number | null };
    run: { weekly: number | null; peak: number | null };
  };
  distanceTargets: {
    swim: { weekly: number | null; peak: number | null; unit: "m" | "yd" };
    bike: { weekly: number | null; peak: number | null; unit: "mi" | "km" };
    run: { weekly: number | null; peak: number | null; unit: "mi" | "km" };
  };
  weeklyBuildRate: number | null;
  trainingBaseline?: Partial<Record<"swim" | "bike" | "run", { startingMinutes: number; medianMinutes: number; completedWeeks: number }>>;
  longRunDay: string;
  longBikeDay: string;
  qualityDays: string[];
  qualitySports: Array<"swim" | "bike" | "run">;
  restDays: string[];
  generatedAt: string | null;
};

export type AthleteRecord = {
  id: string;
  name: string;
  email: string | null;
  timezone: string;
  availabilityDays: string[];
  preferences: { coachTone: string; notifications: boolean; units?: "metric" | "imperial"; calendarBlurEnabled?: boolean; plan?: Partial<PlanPreferences> };
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
  sleepQuality: number | null;
  sleepDuration: string | null;
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
  workout_doc?: IntervalsWorkoutDoc;
};

export type IntervalsWorkoutValue = {
  value?: number;
  start?: number;
  end?: number;
  units?: string;
  target?: string;
};

export type IntervalsWorkoutStep = {
  text?: string;
  duration?: number;
  distance?: number;
  reps?: number;
  intensity?: string;
  steps?: IntervalsWorkoutStep[];
  power?: IntervalsWorkoutValue;
  hr?: IntervalsWorkoutValue;
  pace?: IntervalsWorkoutValue;
  cadence?: IntervalsWorkoutValue;
  _power?: IntervalsWorkoutValue;
  _hr?: IntervalsWorkoutValue;
  _pace?: IntervalsWorkoutValue;
};

export type IntervalsWorkoutDoc = {
  description?: string;
  duration?: number;
  distance?: number;
  ftp?: number;
  lthr?: number;
  threshold_pace?: number;
  pace_units?: string;
  target?: string;
  steps?: IntervalsWorkoutStep[];
};

export type IntervalsActivity = {
  id: number | string;
  start_date_local?: string;
  start_date?: string;
  type?: string;
  name?: string;
  description?: string;
  moving_time?: number;
  distance?: number;
  paired_event_id?: number;
  average_heartrate?: number;
  average_watts?: number;
  icu_average_watts?: number;
  weighted_average_watts?: number;
  icu_weighted_avg_watts?: number;
  icu_normalized_watts?: number;
  average_speed?: number;
  total_elevation_gain?: number;
  average_temp?: number;
  average_weather_temp?: number;
  average_wind_speed?: number;
  average_weather_wind_speed?: number;
  pool_length?: number;
  trainer?: boolean;
  icu_training_load?: number;
  device_name?: string;
};

export type IntervalsActivityInterval = {
  type?: string;
  moving_time?: number;
  distance?: number;
  average_watts?: number;
  weighted_average_watts?: number;
  average_heartrate?: number;
  average_speed?: number;
  average_cadence?: number;
  training_load?: number;
  zone?: number;
};

export type IntervalsActivityDetails = IntervalsActivity & {
  icu_intervals?: IntervalsActivityInterval[];
};

export type IntervalsStatus = { configured: boolean; athleteId: string };
export type IntervalsCalendar = {
  events: IntervalsEvent[];
  activities: IntervalsActivity[];
  syncedAt: string;
};

export type IntervalsWellness = {
  id: string;
  weight?: number | null;
  restingHR?: number | null;
  hrv?: number | null;
  sleepSecs?: number | null;
  sleepQuality?: number | null;
  steps?: number | null;
  kcalConsumed?: number | null;
  kcal?: number | null;
  ctl?: number | null;
  atl?: number | null;
  rampRate?: number | null;
  sportInfo?: Array<{ type?: string; eftp?: number | null }> | null;
  sleepScore?: number | null;
  hrvSDNN?: number | null;
  avgSleepingHR?: number | null;
  readiness?: number | null;
  hydration?: number | null;
  hydrationVolume?: number | null;
  vo2max?: number | null;
  fatigue?: number | null;
  soreness?: number | null;
  stress?: number | null;
  mood?: number | null;
  motivation?: number | null;
  spO2?: number | null;
  respiration?: number | null;
  tempWeight?: number | null;
  tempRestingHR?: number | null;
  [key: string]: string | number | boolean | null | undefined | Array<{ type?: string; eftp?: number | null }>;
};
export type IntervalsWellnessResponse = { records: IntervalsWellness[]; syncedAt: string };

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
  updateCheckIn: (id: string, body: Omit<CheckInRecord, "id">) => request<CheckInRecord>(`/athletes/${ATHLETE_ID}/check-ins/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteCheckIn: (id: string) => request<void>(`/athletes/${ATHLETE_ID}/check-ins/${id}`, { method: "DELETE" }),
  createRecommendation: (body: Omit<RecommendationRecord, "id" | "createdAt" | "decidedAt">) => request<RecommendationRecord>(`/athletes/${ATHLETE_ID}/recommendations`, { method: "POST", body: JSON.stringify(body) }),
  updateRecommendation: (id: string, body: Partial<RecommendationRecord>) => request<RecommendationRecord>(`/athletes/${ATHLETE_ID}/recommendations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  intervalsStatus: () => request<IntervalsStatus>("/integrations/intervals/status"),
  intervalsCalendar: (from: string, to: string) => request<IntervalsCalendar>(`/integrations/intervals/calendar?from=${from}&to=${to}`),
  intervalsWellness: (oldest: string, newest: string) => request<IntervalsWellnessResponse>(`/integrations/intervals/wellness?oldest=${oldest}&newest=${newest}`),
  intervalsActivityDetails: (id: number | string) => request<IntervalsActivityDetails>(`/integrations/intervals/activity/${encodeURIComponent(String(id))}`),
};
