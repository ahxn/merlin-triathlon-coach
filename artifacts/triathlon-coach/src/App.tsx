import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
  useContext,
  type ReactNode,
  type FormEvent,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Link,
  Redirect,
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from "wouter";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bike,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Dumbbell,
  Gauge,
  HeartPulse,
  History,
  Home,
  Info,
  LayoutList,
  Lightbulb,
  Link2,
  LogOut,
  Menu,
  Mountain,
  Pencil,
  Plus,
  RefreshCw,
  Footprints,
  Save,
  Settings,
  ShieldCheck,
  Sparkles,
  Sunrise,
  Target,
  Timer,
  Trash2,
  TrendingUp,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ATHLETE_ID, dataApi, type GoalRecord, type CheckInRecord, type IntervalsActivity, type IntervalsEvent, type IntervalsActivityDetails, type IntervalsWorkoutStep, type IntervalsWorkoutValue, type IntervalsWellness, type RecommendationChange, type RecommendationRecord, type PlanPreferences, type PlanWorkoutOverride, type WorkoutConfirmation, type RecoveryRhythm } from "@/lib/data-api";
import { buildInitialWeeklySchedule, generateWeeklyWorkouts, recommendedSessionCap, weeklyTargetMinutes } from "@/lib/plan-generator";
import { buildWeeksBeforeRecovery, cyclePositionForWeek, periodizePlannedSession, planWeekForDate, progressionCycleSteps } from "@/lib/periodization";
import { deriveCheckInRecommendation } from "@/lib/recommendations";
import { historicalHrvBaseline, historicalSleepScoreBaseline, HRV_BASELINE_MIN_READINGS, SLEEP_SCORE_BASELINE_MIN_READINGS } from "@/lib/wellness-baseline";
import { HEART_RATE_ZONE_BANDS, heartRateZoneUpperBoundsFromMax, heartRateZonesFromMax } from "@/lib/heart-rate-zones";
import { comparablePerformanceInsights } from "@/lib/performance-comparisons";
import { estimateWorkoutDistance, workoutDescriptionForDisplay, workoutTargetLabel } from "@/lib/workout-display";
import { formatRunPace, getRunTrainingPaces, paceSecondsPerKmFromInput, type RunPaceUnit } from "@/lib/run-training-paces";
import { getBikeTrainingPowerZones } from "@/lib/bike-training-powers";
import { authConfigured, getSession, getEmailConfirmationStatus, isPasswordRecovery, restoreSession, signIn, signOut, signUp, sendPasswordReset, updatePassword } from "@/lib/auth";

type Sport = "swim" | "bike" | "run" | "strength" | "rest" | "other";
type SessionStatus = "planned" | "completed" | "missed" | "skipped";
type RecommendationStatus = "pending" | "edited" | "approved" | "dismissed";

type UnitSystem = "metric" | "imperial";

type Athlete = {
  id: string;
  goalId: string | null;
  name: string;
  sport: string;
  event: string;
  distance: string;
  raceDate: string;
  raceTime: string;
  timezone: string;
  availability: string[];
  preferences: { coachTone: string; notifications: boolean; units: UnitSystem; calendarBlurEnabled: boolean; plan: PlanPreferences };
};
type TrainingSession = {
  id: string;
  sport: Sport;
  title: string;
  date: string;
  duration: string;
  durationMinutes?: number;
  startTime?: string;
  distance?: string;
  distanceMeters?: number;
  intensity: string;
  status: SessionStatus;
  notes?: string;
  source?: string;
  workoutDescription?: string;
  workoutDisplayLabel?: string;
  plannedDistanceMeters?: number;
  plannedDistanceIsEstimate?: boolean;
  workoutSteps?: IntervalsWorkoutStep[];
  intervalsActivityId?: number | string;
  averageHeartRate?: number;
  averagePower?: number;
  weightedAveragePower?: number;
  averageSpeed?: number;
  elevationGainMeters?: number;
  averageTemperatureC?: number;
  averageWindSpeedMps?: number;
  trainer?: boolean;
  poolLengthMeters?: number;
  performedAt?: string;
  plannedWorkoutTitle?: string;
  quality?: boolean;
};
type CheckIn = {
  id: string;
  fatigue: number;
  stress: number;
  soreness: number;
  illness: string;
  readiness: number;
  sleepQuality: number | null;
  note: string;
  timestamp: string;
};
type Recommendation = {
  id: string;
  checkInId: string | null;
  title: string;
  trigger: string;
  evidence: string;
  proposedChange: string;
  rationale: string;
  proposedChanges: RecommendationChange[];
  date: string;
  status: RecommendationStatus;
};
type Connection = {
  configured: boolean;
  intervalsConfigured: boolean;
  athleteId: string;
  lastSync?: string;
  error?: string;
  intervalsError?: string;
};
const defaultPlanPreferences: PlanPreferences = {
  recoveryRhythm: "3:1",
  customBuildWeeks: 3,
  goalMode: "race",
  volumeBasis: "time",
  workoutDisplay: "both",
  primaryFocus: "balanced",
  planningMode: "guided",
  manualSessions: [],
  sessionsPerWeek: 6,
  restDaysPerWeek: 1,
  maxSessionMinutes: 0,
  timeTargets: {
    swim: { weekly: null, peak: null },
    bike: { weekly: null, peak: null },
    run: { weekly: null, peak: null },
  },
  distanceTargets: {
    swim: { weekly: null, peak: null, unit: "m" },
    bike: { weekly: null, peak: null, unit: "km" },
    run: { weekly: null, peak: null, unit: "km" },
  },
  weeklyBuildRate: 5,
  recoveryWeekPercent: 75,
  maxHeartRate: null,
  runIntervalRecoverySeconds: { short: 60, medium: 90, long: 120 },
  easyRunPaceSecondsPerKm: null,
  ftpWatts: null,
  longRunDay: "Sun",
  longBikeDay: "Sat",
  qualityDays: ["Tue"],
  qualitySports: ["bike", "run"],
  restDays: ["Mon"],
  generatedAt: null,
};
const emptyAthlete: Athlete = {
  id: ATHLETE_ID,
  goalId: null,
  name: "",
  sport: "Triathlon",
  event: "",
  distance: "",
  raceDate: "",
  raceTime: "",
  timezone: "America/New_York",
  availability: [],
  preferences: { coachTone: "Warm + direct", notifications: true, units: "metric", calendarBlurEnabled: true, plan: defaultPlanPreferences },
};

type PlanBuilderDraftStep = "setup" | "week-builder" | "schedule" | "refinements" | "review";
type PlanBuilderDraft = {
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  athleteId: string;
  form: Athlete;
  maxSessionMinutesInput: string;
  step: PlanBuilderDraftStep;
};
const planBuilderDraftKey = (athleteId: string) => `triathlon-coach-plan-builder-draft:${athleteId}`;
const readPlanBuilderDraft = (athleteId: string): PlanBuilderDraft | null => {
  try {
    const value = localStorage.getItem(planBuilderDraftKey(athleteId));
    if (!value) return null;
    const draft = JSON.parse(value) as PlanBuilderDraft;
    if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(draft.version) || draft.athleteId !== athleteId || !draft.form?.preferences?.plan || !["setup", "week-builder", "schedule", "refinements", "review"].includes(draft.step)) return null;
    const savedPlan = draft.form.preferences.plan;
    const clearLegacyRaceDetails = draft.version < 9 && !savedPlan.generatedAt;
    const recoveryRhythm = savedPlan.recoveryRhythm === "manual"
      ? "none"
      : ["none", "2:1", "3:1", "4:1", "custom"].includes(savedPlan.recoveryRhythm ?? "")
        ? savedPlan.recoveryRhythm!
        : defaultPlanPreferences.recoveryRhythm;
    const migrateSundayRest = draft.version < 5
      && savedPlan.restDaysPerWeek === 1
      && savedPlan.restDays.length === 1
      && savedPlan.restDays[0] === "Sun";
    const migrateSchedule = draft.version < 6 && draft.step !== "setup";
    const planWithDefaults = {
      ...savedPlan,
      ...(migrateSundayRest ? { restDays: ["Mon"] } : {}),
      ...(migrateSchedule ? { longBikeDay: "Sat", longRunDay: "Sun" } : {}),
      weeklyBuildRate: savedPlan.weeklyBuildRate === 7 && !savedPlan.generatedAt ? 5 : savedPlan.weeklyBuildRate ?? defaultPlanPreferences.weeklyBuildRate,
      recoveryWeekPercent: savedPlan.recoveryWeekPercent ?? defaultPlanPreferences.recoveryWeekPercent,
      customBuildWeeks: Math.min(12, Math.max(1, Math.round(savedPlan.customBuildWeeks ?? defaultPlanPreferences.customBuildWeeks ?? 3))),
      recoveryRhythm,
    };
    const plan = migrateSchedule ? {
      ...planWithDefaults,
      manualSessions: buildInitialWeeklySchedule({ ...planWithDefaults, manualSessions: savedPlan.manualSessions }),
    } : planWithDefaults;
    return {
      ...draft,
      version: 10,
      form: {
        ...draft.form,
        ...(clearLegacyRaceDetails ? { event: "", distance: "", raceDate: "", raceTime: "" } : {}),
        preferences: {
          ...draft.form.preferences,
          plan,
        },
      },
    };
  } catch { return null; }
};
const writePlanBuilderDraft = (draft: PlanBuilderDraft) => {
  try { localStorage.setItem(planBuilderDraftKey(draft.athleteId), JSON.stringify(draft)); } catch { /* Keep the active draft in memory if browser storage is unavailable. */ }
};
const clearPlanBuilderDraft = (athleteId: string) => {
  try { localStorage.removeItem(planBuilderDraftKey(athleteId)); } catch { /* The saved plan remains available even if draft cleanup fails. */ }
};

const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (days: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + days);
  return iso(d);
};
const prettyDate = (value: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
const isoWeekNumber = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  const dayNumber = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
};
const longDate = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));

const weekdayShort = (value: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(`${value}T12:00:00`));

function planSessionsForDates(athlete: Athlete, dates: string[], importedSessions: TrainingSession[]) {
  const plan = athlete.preferences.plan;
  if (!plan.generatedAt) return [] as TrainingSession[];
  const planStartDate = plan.generatedAt.slice(0, 10);
  return dates.filter((date) => date >= planStartDate && !(plan.goalMode === "race" && athlete.raceDate && date >= athlete.raceDate)).flatMap((date) => {
    const week = planWeekForDate(plan, date, athlete.raceDate);
    if (!week) return [];
    return plan.manualSessions
      .filter((slot) => slot.day === weekdayShort(date))
      .filter((slot) => !importedSessions.some((session) => session.date === date && session.sport === slot.sport))
      .flatMap((slot): TrainingSession[] => {
        const workoutId = `weekly-plan-${slot.id}-${date}`;
        const override = plan.workoutOverrides?.find((item) => item.workoutId === workoutId);
        if (override?.restDay) return [];
        const workout = periodizePlannedSession(plan, slot, week);
        const durationMinutes = override?.durationMinutes ?? workout.durationMinutes;
        const displayedWorkout = {
          ...workout,
          duration: durationMinutes !== undefined && override?.durationMinutes !== undefined ? `${durationMinutes} min` : workout.duration,
          durationMinutes,
          workoutDescription: override?.workoutDescription ?? workout.workoutDescription,
        };
        const distanceEstimate = estimateWorkoutDistance(plan, displayedWorkout, importedSessions);
        const confirmation = plan.workoutConfirmations?.find((item) => item.workoutId === workoutId);
        return [{
          id: workoutId,
          sport: workout.sport,
          title: override?.title ?? workout.title ?? `${slot.sport[0].toUpperCase()}${slot.sport.slice(1)} workout`,
          date,
          duration: displayedWorkout.duration,
          durationMinutes,
          workoutDisplayLabel: workoutTargetLabel(plan, displayedWorkout, importedSessions, athlete.preferences.units),
          plannedDistanceMeters: distanceEstimate?.meters,
          plannedDistanceIsEstimate: distanceEstimate?.source !== "planned target",
          intensity: override?.intensity ?? workout.intensity,
          status: confirmation?.status ?? "planned",
          source: "Weekly plan",
          workoutDescription: workoutDescriptionForDisplay(plan, displayedWorkout, importedSessions, athlete.preferences.units),
          quality: workout.quality,
        }];
      });
  });
}

function withWorkoutConfirmations(plan: PlanPreferences, sessions: TrainingSession[]) {
  return sessions.map((session) => {
    const confirmation = plan.workoutConfirmations?.find((item) => item.workoutId === session.id);
    return confirmation ? { ...session, status: confirmation.status } : session;
  });
}

function isPlanRestDay(athlete: Athlete, date: string) {
  const plan = athlete.preferences.plan;
  const isWithinPlan = Boolean(plan.generatedAt && date >= plan.generatedAt.slice(0, 10))
    && !(plan.goalMode === "race" && athlete.raceDate && date > athlete.raceDate);
  return isWithinPlan && (plan.restDays.includes(weekdayShort(date)) || plan.workoutOverrides?.some((override) => override.date === date && override.restDay) === true);
}

const formatDuration = (seconds?: number) => {
  if (!seconds || seconds <= 0) return "Duration not provided";
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours} hr${remainder ? ` ${remainder} min` : ""}` : `${minutes} min`;
};

const formatWeeklyMinutes = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours} h${remainder ? ` ${remainder} min` : ""}` : `${remainder} min`;
};

const formatRaceTime = (value?: string | null) => {
  const seconds = Number(value);
  if (!value || !Number.isFinite(seconds) || seconds <= 0) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
};

const parseRaceTime = (value: string) => {
  const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return seconds > 0 ? seconds : null;
};

const formatDistance = (meters?: number, units: UnitSystem = "metric", sport: Sport = "run") => {
  if (!meters || meters <= 0) return undefined;
  if (sport === "swim") return units === "metric" ? `${Math.round(meters)} m` : `${Math.round(meters * 1.09361)} yd`;
  return units === "metric"
    ? meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
    : `${(meters / 1609.344).toFixed(meters >= 16093 ? 0 : 1)} mi`;
};

const formatSessionDistance = (session: TrainingSession, units: UnitSystem) => {
  if (session.distanceMeters !== undefined) return formatDistance(session.distanceMeters, units, session.sport);
  if (!session.distance) return undefined;
  const parsed = /([\d.]+)\s*(km|m|mi|yd)\b/i.exec(session.distance);
  if (!parsed) return session.distance;
  const amount = Number(parsed[1]);
  const sourceUnit = parsed[2].toLowerCase();
  const meters = sourceUnit === "km" ? amount * 1000 : sourceUnit === "mi" ? amount * 1609.344 : sourceUnit === "yd" ? amount / 1.09361 : amount;
  return formatDistance(meters, units, session.sport);
};

const sportFromIntervals = (value?: string): Sport => {
  const type = value?.toLowerCase() ?? "";
  if (type.includes("swim")) return "swim";
  if (/(ride|bike|cycling)/.test(type)) return "bike";
  if (type.includes("run")) return "run";
  if (/(strength|weight|gym)/.test(type)) return "strength";
  return "other";
};

function sessionsFromIntervals(events: IntervalsEvent[], activities: IntervalsActivity[]): TrainingSession[] {
  const workoutEvents = events.filter((event) => event.category === "WORKOUT" && event.start_date_local && event.name);
  const matchedActivityIds = new Set<number | string>();
  const matchedActivitiesByEvent = new Map<number, IntervalsActivity>();
  const eventById = new Map(workoutEvents.map((event) => [event.id, event]));

  // Prefer Intervals.icu's explicit event pairing whenever it is available.
  for (const activity of activities) {
    if (typeof activity.paired_event_id === "number" && eventById.has(activity.paired_event_id)) {
      matchedActivitiesByEvent.set(activity.paired_event_id, activity);
      matchedActivityIds.add(activity.id);
    }
  }

  // If Intervals.icu did not pair an activity, use a conservative date + sport match.
  // Only auto-match unambiguous one-workout/one-activity groups to avoid false replacements.
  const unmatchedEventsByKey = new Map<string, IntervalsEvent[]>();
  for (const event of workoutEvents) {
    if (matchedActivitiesByEvent.has(event.id)) continue;
    const key = `${event.start_date_local!.slice(0, 10)}|${sportFromIntervals(event.type)}`;
    unmatchedEventsByKey.set(key, [...(unmatchedEventsByKey.get(key) ?? []), event]);
  }
  const unmatchedActivitiesByKey = new Map<string, IntervalsActivity[]>();
  for (const activity of activities) {
    if (matchedActivityIds.has(activity.id) || typeof activity.paired_event_id === "number") continue;
    const date = activity.start_date_local ?? activity.start_date;
    if (!date) continue;
    const key = `${date.slice(0, 10)}|${sportFromIntervals(activity.type)}`;
    unmatchedActivitiesByKey.set(key, [...(unmatchedActivitiesByKey.get(key) ?? []), activity]);
  }
  for (const [key, sameDayEvents] of unmatchedEventsByKey) {
    const sameDayActivities = unmatchedActivitiesByKey.get(key) ?? [];
    if (sameDayEvents.length === 1 && sameDayActivities.length === 1) {
      matchedActivitiesByEvent.set(sameDayEvents[0].id, sameDayActivities[0]);
      matchedActivityIds.add(sameDayActivities[0].id);
    }
  }

  const sessions: TrainingSession[] = workoutEvents.map((event) => {
    const activity = matchedActivitiesByEvent.get(event.id);
    if (activity) {
      const activityDate = activity.start_date_local ?? activity.start_date ?? event.start_date_local!;
      return {
        id: `activity-${activity.id}`,
        sport: sportFromIntervals(activity.type || event.type),
        title: activity.name || activity.type || event.name || "Completed workout",
        date: activityDate.slice(0, 10),
        duration: formatDuration(activity.moving_time),
        durationMinutes: activity.moving_time ? Math.round(activity.moving_time / 60) : undefined,
        distanceMeters: activity.distance,
        intensity: typeof activity.icu_training_load === "number" ? `Training load ${Math.round(activity.icu_training_load)}` : "Completed activity",
        status: "completed",
        notes: activity.description || event.description || undefined,
        source: activity.device_name?.toLowerCase().includes("garmin") ? activity.device_name : undefined,
        workoutDescription: event.workout_doc?.description,
        workoutSteps: event.workout_doc?.steps,
        intervalsActivityId: activity.id,
        averageHeartRate: activity.average_heartrate,
        averagePower: activity.icu_average_watts ?? activity.average_watts,
        weightedAveragePower: activity.icu_normalized_watts ?? activity.icu_weighted_avg_watts ?? activity.weighted_average_watts,
        averageSpeed: activity.average_speed,
        elevationGainMeters: activity.total_elevation_gain,
        averageTemperatureC: activity.average_weather_temp ?? activity.average_temp,
        averageWindSpeedMps: activity.average_weather_wind_speed ?? activity.average_wind_speed,
        trainer: activity.trainer,
        poolLengthMeters: activity.pool_length,
        performedAt: activity.start_date_local ?? activity.start_date,
        plannedWorkoutTitle: event.name,
      };
    }
    const date = event.start_date_local!.slice(0, 10);
    return {
      id: `event-${event.id}`,
      sport: sportFromIntervals(event.type),
      title: event.name || "Planned workout",
      date,
      duration: formatDuration(event.moving_time),
      distanceMeters: event.distance,
      intensity: typeof event.icu_intensity === "number" ? `Intensity ${Math.round(event.icu_intensity)}%` : "From Intervals.icu",
      // A workout event without a paired activity is unconfirmed, not proof it was skipped.
      status: "planned",
      source: "Intervals.icu",
      notes: event.description || undefined,
      workoutDescription: event.workout_doc?.description,
      workoutSteps: event.workout_doc?.steps,
    };
  });

  const completedActivities = activities
    .filter((activity) => !matchedActivityIds.has(activity.id))
    .map((activity): TrainingSession | null => {
      const date = activity.start_date_local ?? activity.start_date;
      if (!date) return null;
      return {
        id: `activity-${activity.id}`,
        sport: sportFromIntervals(activity.type),
        title: activity.name || activity.type || "Completed activity",
        date: date.slice(0, 10),
        duration: formatDuration(activity.moving_time),
        durationMinutes: activity.moving_time ? Math.round(activity.moving_time / 60) : undefined,
        distanceMeters: activity.distance,
        intensity: typeof activity.icu_training_load === "number" ? `Training load ${Math.round(activity.icu_training_load)}` : "Completed activity",
        status: "completed",
        notes: activity.description || undefined,
        source: activity.device_name?.toLowerCase().includes("garmin") ? activity.device_name : undefined,
        intervalsActivityId: activity.id,
        averageHeartRate: activity.average_heartrate,
        averagePower: activity.icu_average_watts ?? activity.average_watts,
        weightedAveragePower: activity.icu_normalized_watts ?? activity.icu_weighted_avg_watts ?? activity.weighted_average_watts,
        averageSpeed: activity.average_speed,
        elevationGainMeters: activity.total_elevation_gain,
        averageTemperatureC: activity.average_weather_temp ?? activity.average_temp,
        averageWindSpeedMps: activity.average_weather_wind_speed ?? activity.average_wind_speed,
        trainer: activity.trainer,
        poolLengthMeters: activity.pool_length,
        performedAt: activity.start_date_local ?? activity.start_date,
      };
    })
    .filter((activity): activity is TrainingSession => activity !== null);
  return [...sessions, ...completedActivities].sort((a, b) => a.date.localeCompare(b.date));
}

const checkInFromRecord = (record: { id: string; checkInDate: string; readiness: number; energy: number | null; soreness: number | null; stress: number | null; sleepQuality: number | null; sleepDuration: string | null; illnessSignal: string | null; notes: string | null }): CheckIn => ({
  id: record.id,
  fatigue: record.energy === null ? 5 : 11 - record.energy,
  stress: record.stress ?? 5,
  soreness: record.soreness ?? 5,
  illness: record.illnessSignal || "None",
  readiness: record.readiness,
  sleepQuality: record.sleepQuality,
  note: record.notes || "",
  timestamp: record.checkInDate,
});

const recommendationFromRecord = (record: RecommendationRecord): Recommendation => {
  const summary = record.proposedChanges.find((change) => change.field === "summary")?.to;
  const proposedChange = typeof summary === "string" ? summary : record.proposedChanges.map((change) => typeof change.to === "string" ? change.to : "").filter(Boolean).join("; ");
  return {
    id: record.id,
    checkInId: record.checkInId,
    title: record.title,
    trigger: record.checkInId ? "Linked check-in" : "Coach recommendation",
    evidence: record.athleteNotes || "No additional athlete notes.",
    proposedChange: proposedChange || record.title,
    rationale: record.reasoning,
    proposedChanges: record.proposedChanges,
    date: (record.decidedAt ?? record.createdAt).slice(0, 10),
    status: record.status,
  };
};

const planPreferencesWithoutLegacyExperience = (preferences: Partial<PlanPreferences> | undefined) => {
  const stored = (preferences ?? {}) as Partial<PlanPreferences> & { newToStructuredTraining?: boolean | null };
  const { newToStructuredTraining: _legacyExperience, ...currentPreferences } = stored;
  return currentPreferences;
};

const regeneratePlanFromLegacyExperienceSettings = (plan: PlanPreferences, storedPreferences?: Partial<PlanPreferences>) => {
  const hadExperienceSelection = typeof (storedPreferences as (Partial<PlanPreferences> & { newToStructuredTraining?: boolean | null }) | undefined)?.newToStructuredTraining === "boolean";
  if (!hadExperienceSelection || !plan.generatedAt) return plan;
  return { ...plan, manualSessions: generateWeeklyWorkouts(plan).sessions };
};

const normalizeFocusedBikeRunDistribution = (plan: PlanPreferences): PlanPreferences => {
  const bikeCount = plan.manualSessions.filter((session) => session.sport === "bike").length;
  const runCount = plan.manualSessions.filter((session) => session.sport === "run").length;
  const balancedMismatch = plan.primaryFocus === "balanced" && runCount > bikeCount;
  const runFocusMismatch = plan.primaryFocus === "run" && bikeCount > runCount;
  if (!plan.generatedAt || (!balancedMismatch && !runFocusMismatch)) return plan;
  const rebalanced = { ...plan, manualSessions: buildInitialWeeklySchedule(plan) };
  return { ...rebalanced, manualSessions: generateWeeklyWorkouts(rebalanced).sessions };
};

const athleteFromRecord = (record: { id: string; name: string; timezone: string; availabilityDays: string[]; preferences: { coachTone: string; notifications: boolean; units?: UnitSystem; calendarBlurEnabled?: boolean; plan?: Partial<PlanPreferences> } }, goal?: GoalRecord): Athlete => ({
  ...emptyAthlete,
  id: record.id,
  goalId: goal?.id ?? null,
  name: record.name,
  timezone: record.timezone,
  availability: record.availabilityDays ?? [],
  preferences: {
    ...emptyAthlete.preferences,
    ...record.preferences,
    plan: normalizeFocusedBikeRunDistribution(regeneratePlanFromLegacyExperienceSettings({
      ...defaultPlanPreferences,
      ...planPreferencesWithoutLegacyExperience(record.preferences?.plan),
      recoveryRhythm: record.preferences?.plan?.recoveryRhythm === "manual" ? "none" : record.preferences?.plan?.recoveryRhythm ?? defaultPlanPreferences.recoveryRhythm,
      customBuildWeeks: Math.min(12, Math.max(1, Math.round(record.preferences?.plan?.customBuildWeeks ?? defaultPlanPreferences.customBuildWeeks ?? 3))),
      goalMode: record.preferences?.plan?.goalMode ?? (goal?.type === "consistency" ? "consistency" : goal?.type === "race" ? "race" : "race"),
      weeklyBuildRate: record.preferences?.plan?.weeklyBuildRate === 7 && !record.preferences?.plan?.generatedAt
        ? 5
        : record.preferences?.plan?.weeklyBuildRate ?? defaultPlanPreferences.weeklyBuildRate,
      recoveryWeekPercent: record.preferences?.plan?.recoveryWeekPercent ?? defaultPlanPreferences.recoveryWeekPercent,
      workoutDisplay: "both",
      primaryFocus: record.preferences?.plan?.primaryFocus ?? defaultPlanPreferences.primaryFocus,
      planningMode: record.preferences?.plan?.planningMode ?? defaultPlanPreferences.planningMode,
      manualSessions: (record.preferences?.plan?.manualSessions ?? defaultPlanPreferences.manualSessions).map((session) => ({ ...session, intensity: session.intensity ?? (session.quality ? "Threshold" : "Endurance") })),
      sessionsPerWeek: record.preferences?.plan?.sessionsPerWeek ?? Math.min(14, Math.max(3, record.preferences?.plan?.manualSessions?.length || defaultPlanPreferences.sessionsPerWeek)),
      restDaysPerWeek: record.preferences?.plan?.restDaysPerWeek ?? record.preferences?.plan?.restDays?.length ?? defaultPlanPreferences.restDaysPerWeek,
      maxSessionMinutes: record.preferences?.plan?.maxSessionMinutes ?? defaultPlanPreferences.maxSessionMinutes,
      qualitySports: record.preferences?.plan?.qualitySports ?? defaultPlanPreferences.qualitySports,
      timeTargets: {
        swim: { ...defaultPlanPreferences.timeTargets.swim, ...record.preferences?.plan?.timeTargets?.swim },
        bike: { ...defaultPlanPreferences.timeTargets.bike, ...record.preferences?.plan?.timeTargets?.bike },
        run: { ...defaultPlanPreferences.timeTargets.run, ...record.preferences?.plan?.timeTargets?.run },
      },
      distanceTargets: {
        swim: { ...defaultPlanPreferences.distanceTargets.swim, ...record.preferences?.plan?.distanceTargets?.swim },
        bike: { ...defaultPlanPreferences.distanceTargets.bike, ...record.preferences?.plan?.distanceTargets?.bike },
        run: { ...defaultPlanPreferences.distanceTargets.run, ...record.preferences?.plan?.distanceTargets?.run },
      },
      generatedAt: record.preferences?.plan?.timeTargets ? record.preferences.plan.generatedAt ?? null : null,
    }, record.preferences?.plan)),
  },
  event: goal?.type === "race" && !["Race goal", "Race 70.3", "Race 140.6"].includes(goal.name) ? goal.name : "",
  distance: goal?.type !== "race" ? "" : goal?.targetUnit === "70.3 miles" || goal?.targetUnit === "70.3" || goal?.targetUnit === "Half Ironman"
    ? "Half Ironman"
    : goal?.targetUnit === "140.6 miles" || goal?.targetUnit === "140.6" || goal?.targetUnit === "Ironman"
      ? "Ironman"
      : "",
  raceDate: goal?.type === "race" ? goal.targetDate ?? "" : "",
  raceTime: goal?.type === "race" ? formatRaceTime(goal.targetValue) : "",
});

const seedSessions: TrainingSession[] = [
  {
    id: "s1",
    sport: "swim",
    title: "Form + aerobic rhythm",
    date: shift(0),
    duration: "45 min",
    distance: "1,800 m",
    intensity: "Zone 2",
    status: "planned",
    notes: "Long exhale, relaxed catch.",
  },
  {
    id: "s2",
    sport: "run",
    title: "Steady progression",
    date: shift(1),
    duration: "52 min",
    distance: "7.4 km",
    intensity: "Z2 → Z3",
    status: "planned",
    notes: "Finish the final 12 minutes with quiet focus.",
  },
  {
    id: "s3",
    sport: "bike",
    title: "Tempo over rolling roads",
    date: shift(2),
    duration: "1 hr 35 min",
    distance: "42 km",
    intensity: "Tempo",
    status: "planned",
    notes: "3 × 10 min controlled tempo.",
  },
  {
    id: "s4",
    sport: "rest",
    title: "Full rest + mobility",
    date: shift(3),
    duration: "20 min",
    intensity: "Recovery",
    status: "planned",
    notes: "A session can be choosing less.",
  },
  {
    id: "s5",
    sport: "swim",
    title: "Threshold ladder",
    date: shift(4),
    duration: "55 min",
    distance: "2,200 m",
    intensity: "Threshold",
    status: "planned",
  },
  {
    id: "s6",
    sport: "bike",
    title: "Long ride · nutrition practice",
    date: shift(5),
    duration: "2 hr 40 min",
    distance: "72 km",
    intensity: "Z2",
    status: "planned",
    notes: "Practice one bottle per hour.",
  },
  {
    id: "s7",
    sport: "run",
    title: "Brick run",
    date: shift(5),
    duration: "22 min",
    distance: "3.5 km",
    intensity: "Zone 2",
    status: "planned",
  },
  {
    id: "s8",
    sport: "run",
    title: "Conversational run",
    date: shift(-1),
    duration: "38 min",
    distance: "5.5 km",
    intensity: "Z2",
    status: "completed",
  },
  {
    id: "s9",
    sport: "bike",
    title: "Cadence waves",
    date: shift(-2),
    duration: "1 hr 08 min",
    distance: "31 km",
    intensity: "Z2",
    status: "completed",
  },
];
const seedCheckIns: CheckIn[] = [
  {
    id: "c1",
    fatigue: 3,
    stress: 2,
    soreness: 2,
    illness: "None",
    readiness: 7,
    sleepQuality: 8,
    note: "Good energy after a quiet evening.",
    timestamp: shift(-1),
  },
];
const seedRecommendations: Recommendation[] = [
  {
    id: "r1",
    checkInId: null,
    title: "Keep tomorrow’s run relaxed",
    trigger: "Readiness trend",
    evidence: "Three-day readiness average is 5.8/10, down from 7.1 last week.",
    proposedChange:
      "Keep tomorrow’s run relaxed and remove the final progression block.",
    rationale:
      "Protects consistency while keeping the aerobic signal. Revisit after your next check-in.",
    proposedChanges: [{ field: "summary", to: "Keep tomorrow’s run relaxed and remove the final progression block." }],
    date: shift(0),
    status: "pending",
  },
  {
    id: "r2",
    checkInId: null,
    title: "Reduce the long ride",
    trigger: "Load balance",
    evidence: "Bike volume is 18% above the current four-week rolling average.",
    proposedChange: "Reduce Saturday’s long ride by 15 minutes.",
    rationale:
      "A small reduction preserves the weekend rhythm without over-correcting from one data point.",
    proposedChanges: [{ field: "summary", to: "Reduce Saturday’s long ride by 15 minutes." }],
    date: shift(0),
    status: "pending",
  },
];
const seedAthlete: Athlete = {
  ...emptyAthlete,
  name: "Maya Chen",
  sport: "Triathlon",
  event: "Cascadia 70.3",
  distance: "70.3 miles",
  raceDate: "2025-09-14",
  availability: ["Mon", "Tue", "Wed", "Thu", "Sat"],
  preferences: { coachTone: "Warm + direct", notifications: true, units: "metric", calendarBlurEnabled: true, plan: defaultPlanPreferences },
};
const seedConnection: Connection = {
  configured: false,
  intervalsConfigured: false,
  athleteId: "0",
};

function useStored<T>(
  key: string,
  fallback: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue];
}

type AppState = {
  athlete: Athlete;
  sessions: TrainingSession[];
  wellness: IntervalsWellness[];
  wellnessError: string | null;
  checkIns: CheckIn[];
  recommendations: Recommendation[];
  connection: Connection;
  databaseConnected: boolean;
  loading: boolean;
  loadError: string | null;
  refresh: () => Promise<void>;
  saveAthlete: (v: Athlete) => Promise<Athlete>;
  saveCheckIn: (v: Omit<CheckIn, "id">) => Promise<void>;
  updateCheckIn: (id: string, v: Omit<CheckIn, "id">) => Promise<void>;
  deleteCheckIn: (id: string) => Promise<void>;
  updateRecommendation: (id: string, patch: Partial<RecommendationRecord>) => Promise<void>;
  confirmWorkout: (workoutId: string, date: string, status: WorkoutConfirmation["status"]) => Promise<void>;
  applyRecommendation: (id: string) => Promise<void>;
  undoRecommendation: (id: string) => Promise<void>;
  toast: (message: string) => void;
};
const AppData = createContext<AppState | null>(null);
const useApp = () => {
  const value = useContext(AppData);
  if (!value) throw new Error("App context missing");
  return value;
};

const sportMeta: Record<
  Sport,
  { label: string; color: string; Icon: typeof Waves }
> = {
  swim: { label: "Swim", color: "text-cyan-700 bg-cyan-50", Icon: Waves },
  bike: { label: "Bike", color: "text-amber-700 bg-amber-50", Icon: Bike },
  run: { label: "Run", color: "text-rose-700 bg-rose-50", Icon: Footprints },
  strength: {
    label: "Strength",
    color: "text-violet-700 bg-violet-50",
    Icon: Dumbbell,
  },
  rest: { label: "Rest", color: "text-slate-600 bg-slate-100", Icon: Sunrise },
  other: { label: "Other", color: "text-slate-600 bg-slate-100", Icon: CircleHelp },
};
const navItems = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/training", label: "Calendar", Icon: CalendarDays },
  { href: "/check-in", label: "Check-in", Icon: HeartPulse },
  { href: "/recommendations", label: "Recommendations", Icon: Lightbulb },
  { href: "/plan", label: "Plan", Icon: LayoutList },
];
const accountItems = [
  { href: "/settings", label: "Settings", Icon: Settings },
];

function IconButton({
  label,
  children,
  onClick,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      data-testid={`button-${label.toLowerCase().replaceAll(" ", "-")}`}
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
function Button({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled = false,
  testId,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  testId?: string;
  className?: string;
}) {
  const styles = {
    primary:
      "bg-primary text-primary-foreground hover:brightness-110 shadow-sm",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
    ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
    danger: "bg-rose-50 text-rose-700 hover:bg-rose-100",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "coral" | "green" | "amber" | "blue";
}) {
  const colors = {
    neutral: "bg-secondary text-muted-foreground",
    coral: "bg-orange-50 text-orange-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-cyan-50 text-cyan-700",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.08em] ${colors[tone]}`}
    >
      {children}
    </span>
  );
}
function SectionTitle({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="mono mb-1 text-[10px] uppercase tracking-[.14em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h2 className="display text-2xl text-foreground">{title}</h2>
      </div>
      {action}
    </div>
  );
}
function Metric({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div data-testid={`metric-${label.toLowerCase().replaceAll(" ", "-")}`}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`display mt-1 text-3xl ${accent ? "text-accent" : "text-foreground"}`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
function SessionIcon({ sport, compact = false }: { sport: Sport; compact?: boolean }) {
  const { Icon, color } = sportMeta[sport];
  return (
    <span
      className={`flex shrink-0 items-center justify-center ${compact ? "h-6 w-6 rounded-md" : "h-9 w-9 rounded-xl"} ${color}`}
    >
      <Icon size={compact ? 13 : 17} strokeWidth={1.8} />
    </span>
  );
}
function SessionRow({
  session,
  onToggle,
}: {
  session: TrainingSession;
  onToggle?: () => void;
}) {
  const { athlete } = useApp();
  const sessionDistance = formatSessionDistance(session, athlete.preferences.units);
  return (
    <div
      className="group flex items-center gap-3 py-3"
      data-testid={`session-${session.id}`}
    >
      <SessionIcon sport={session.sport} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p
            className={`truncate text-sm font-semibold ${session.status === "completed" ? "text-muted-foreground line-through decoration-accent/60" : session.status === "missed" ? "text-red-800" : session.status === "skipped" ? "text-muted-foreground" : "text-foreground"}`}
          >
            {session.title}
          </p>
          {session.source && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-sky-800">{session.source}</span>}
          {session.status === "completed" && <CheckCircle2 size={14} className="text-emerald-600" />}
          {session.status === "missed" && <X size={14} className="text-red-700" aria-label="Missed workout" />}
          {session.status === "skipped" && <X size={14} className="text-muted-foreground" aria-label="Skipped workout" />}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {sportMeta[session.sport].label} · {session.duration}
          {sessionDistance ? ` · ${sessionDistance}` : ""}
        </p>
      </div>
      {onToggle && (
        <IconButton label={`mark ${session.id}`} onClick={onToggle}>
          {session.status === "completed" ? (
            <RefreshCw size={16} />
          ) : (
            <Check size={16} />
          )}
        </IconButton>
      )}
    </div>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { athlete, recommendations, connection } = useApp();
  const initials = athlete.name.split(/\s+/).filter(Boolean).map((name) => name[0]).join("").slice(0, 2) || "A";
  const isActive = (href: string) => href === "/" ? location === "/" : location === "/calendar" && href === "/training" ? true : location.startsWith(href);
  return (
    <div className="grain app-shell text-foreground">
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[252px] flex-col bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform duration-300 md:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="absolute right-4 top-5 z-10 rounded-lg p-2 text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-foreground md:hidden"
          data-testid="button-close-menu"
          aria-label="Close navigation"
        >
          <X size={18} />
        </button>
        <div className="mb-4 px-3">
          <div
            className="flex min-h-[54px] items-center gap-2.5 px-2 py-2"
            data-testid="brand-lockup"
          >
            <img
              src={`${import.meta.env.BASE_URL}branding/merlin-book-mark-white.png`}
              alt=""
              className="h-8 w-10 shrink-0 object-contain"
            />
            <img
              src={`${import.meta.env.BASE_URL}branding/merlin-wordmark-white.png`}
              alt="Merlin"
              className="h-8 w-[112px] shrink-0 object-contain object-left"
            />
          </div>
        </div>
        <nav className="flex-1">
          {navItems.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              data-testid={`link-${label.toLowerCase().replaceAll(" ", "-")}`}
              className={`nav-link mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${isActive(href) ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm" : "text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"}`}
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
              {label === "Recommendations" && (
                recommendations.filter((item) => item.status === "pending" || item.status === "edited").length > 0 && (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-sidebar-primary px-1 text-[10px] font-bold text-sidebar-primary-foreground">
                    {recommendations.filter((item) => item.status === "pending" || item.status === "edited").length}
                  </span>
                )
              )}
            </Link>
          ))}
        </nav>
        <div className="mt-auto pb-2">
          <div key={location} data-testid="global-connection-status" className="page-refocus mb-2 flex items-start gap-3 rounded-xl px-3 py-2.5">
            {connection.configured && !connection.error
              ? <CheckCircle2 size={17} strokeWidth={1.8} className="mt-0.5 shrink-0 text-emerald-300" />
              : <Info size={17} strokeWidth={1.8} className="mt-0.5 shrink-0 text-amber-300" />}
            <div className="min-w-0">
              <p className="text-sm text-sidebar-foreground/80">{connection.intervalsConfigured ? "Intervals.icu" : "No data connection"}</p>
              <p className="mt-0.5 text-[10px] leading-tight text-sidebar-foreground/55">
                {connection.lastSync
                  ? `Last sync · ${new Date(connection.lastSync).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                  : connection.error || connection.intervalsError ? "Sync needs attention" : "Waiting for first sync"}
              </p>
            </div>
          </div>
          {accountItems.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              data-testid={`link-${label.toLowerCase().replaceAll(" ", "-")}`}
              className={`nav-link mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${isActive(href) ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"}`}
            >
              <Icon size={17} strokeWidth={1.8} />
              {label}
            </Link>
          ))}
          <button type="button" onClick={() => { void signOut().then(() => setLocation("/login")); }} className="nav-link mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left font-sans text-sm font-normal leading-5 text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"><LogOut size={17} strokeWidth={1.8} />Sign out</button>
          <Link
            href="/profile"
            onClick={() => setMobileOpen(false)}
            data-testid="link-header-profile"
            className={`nav-link flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${isActive("/profile") ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"}`}
          >
            <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-sidebar-foreground/20 text-[10px] font-bold text-sidebar-foreground">{initials}</span>
            <span className="min-w-0 truncate">{athlete.name || "Athlete"}</span>
          </Link>
        </div>
      </aside>
      {mobileOpen && <button
        type="button"
        onClick={() => setMobileOpen(false)}
        className="fixed inset-0 z-30 bg-slate-950/40 md:hidden"
        data-testid="button-close-menu-backdrop"
        aria-label="Close navigation"
      />}
      <div className="md:pl-[252px]">
        {!mobileOpen && <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="fixed left-4 top-4 z-30 rounded-lg border border-border bg-background/90 p-2 shadow-sm backdrop-blur md:hidden"
          data-testid="button-open-menu"
          aria-label="Open navigation"
        >
          <Menu size={20} />
        </button>}
        <main className={`mx-auto max-w-[1400px] px-5 pt-7 md:px-10 md:pt-10 ${location === "/training" || location === "/calendar" ? "pb-2" : "pb-7 md:pb-10"}`}>
          <div key={location} className="page-refocus">{children}</div>
        </main>
      </div>
    </div>
  );
}

function Dashboard() {
  const { athlete, sessions, checkIns } = useApp();
  const [currentTime, setCurrentTime] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const greeting = currentTime.getHours() < 12 ? "Good morning" : currentTime.getHours() < 17 ? "Good afternoon" : "Good evening";
  const mondayOffset = -((today.getDay() + 6) % 7);
  const weekDates = Array.from({ length: 7 }, (_, index) => shift(mondayOffset + index));
  const importedWeekSessions = withWorkoutConfirmations(athlete.preferences.plan, sessions.filter((s) => s.date >= weekDates[0] && s.date <= weekDates[6]));
  const plannedWeekSessions = planSessionsForDates(athlete, weekDates, sessions);
  const weekSessions = [...importedWeekSessions, ...plannedWeekSessions];
  const weekTrainingSessions = weekSessions.filter((session) =>
    session.sport !== "rest" && !/^(?:rest day|day off)$/i.test(session.title.trim()),
  );
  const todaySessions = [
    ...sessions.filter((session) => session.date === shift(0) && session.sport !== "rest" && !/^(?:rest day|day off)$/i.test(session.title.trim())),
    ...plannedWeekSessions.filter((session) => session.date === shift(0)),
  ];
  const todaySession = todaySessions.find((session) => session.status === "planned") ?? todaySessions[0];
  const weekCompleted = weekTrainingSessions.filter((s) => s.status === "completed").length;
  const skippedWorkoutIds = new Set([
    ...weekTrainingSessions.filter((session) => session.status === "skipped").map((session) => session.id),
    ...(athlete.preferences.plan.workoutOverrides ?? [])
      .filter((override) => override.restDay && weekDates.includes(override.date))
      .map((override) => override.workoutId),
  ]);
  const weekSkipped = skippedWorkoutIds.size;
  const weekScheduled = weekTrainingSessions.length - weekTrainingSessions.filter((session) => session.status === "skipped").length;
  const daysToRace = athlete.raceDate ? Math.max(0, Math.ceil((new Date(`${athlete.raceDate}T12:00:00`).getTime() - today.getTime()) / 86400000)) : null;
  const homePlan = athlete.preferences.plan;
  const homeRaceTitle = athlete.event
    ? `${athlete.event}${athlete.distance === "Half Ironman" && !/\b70\.3\b/.test(athlete.event) ? " 70.3" : athlete.distance === "Ironman" && !/\b140\.6\b/.test(athlete.event) ? " 140.6" : ""}`
    : athlete.distance === "Ironman" ? "Race 140.6" : athlete.distance === "Half Ironman" ? "Race 70.3" : "Race goal";
  const homeCurrentPlanWeek = homePlan.generatedAt ? planWeekForDate(homePlan, shift(0), athlete.raceDate) : null;
  const homeRaceWeek = homePlan.generatedAt && homePlan.goalMode === "race" && athlete.raceDate
    ? planWeekForDate(homePlan, athlete.raceDate, athlete.raceDate)
    : null;
  const homeRaceTimeline = homeRaceWeek && athlete.raceDate ? (() => {
    const totalWeeks = homeRaceWeek.index + 1;
    const isPastRace = shift(0) > athlete.raceDate;
    const currentWeekIndex = isPastRace ? totalWeeks : Math.min(totalWeeks - 1, Math.max(0, homeCurrentPlanWeek?.index ?? 0));
    const completedWeeks = currentWeekIndex;
    const buildWeeksRemaining = Math.max(0, totalWeeks - currentWeekIndex - Math.min(2, totalWeeks));
    const taperWeeksRemaining = totalWeeks >= 2 && currentWeekIndex <= totalWeeks - 2 ? 1 : 0;
    const raceWeeksRemaining = currentWeekIndex < totalWeeks ? 1 : 0;
    const daysUntilRace = Math.max(0, (Date.parse(`${athlete.raceDate}T00:00:00Z`) - Date.parse(`${shift(0)}T00:00:00Z`)) / 86_400_000);
    const weeksUntilRace = Math.ceil(daysUntilRace / 7);
    const peakWeekIndex = totalWeeks - 3;
    const peakLabel = peakWeekIndex < 0
      ? "Peak week unavailable"
      : currentWeekIndex > peakWeekIndex
        ? "Peak week complete"
        : currentWeekIndex === peakWeekIndex
          ? "Peak week"
          : `Peak in ${peakWeekIndex - currentWeekIndex} ${peakWeekIndex - currentWeekIndex === 1 ? "week" : "weeks"}`;
    return { totalWeeks, completedWeeks, buildWeeksRemaining, taperWeeksRemaining, raceWeeksRemaining, weeksUntilRace, peakLabel };
  })() : null;
  return (
    <div className="space-y-4">
      <div className="fade-up flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <div className="mono mb-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[.18em] text-muted-foreground">
            <span>{longDate(shift(0))}</span>
            <span className="text-border">·</span>
            <span className="inline-flex items-center gap-1.5 tabular-nums" aria-label={`Current local time ${currentTime.toLocaleTimeString()}`}>
              <Clock3 size={12} aria-hidden="true" />
              {currentTime.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}
            </span>
          </div>
          <h1 className="display text-4xl md:text-5xl">
            {greeting}, {athlete.name.split(" ")[0]}.
          </h1>
        </div>
      </div>
      <section className="fade-up delay-1 grid items-stretch gap-3 lg:grid-cols-[minmax(0,.86fr)_minmax(0,1.3fr)]">
        <div className="flex flex-col gap-3">
          <div className="relative flex min-h-[190px] flex-col overflow-hidden rounded-2xl bg-primary p-4 text-primary-foreground shadow-lg shadow-primary/10 md:p-5">
            <div className="absolute -right-16 -top-24 h-64 w-64 rounded-full border border-accent/25" />
            <div className="absolute -right-8 -top-16 h-48 w-48 rounded-full border border-accent/20" />
            <div className="relative flex flex-col">
              <div className="flex items-center justify-between">
                <Badge tone="coral">Today’s focus</Badge>
                {todaySession?.source === "Weekly plan" && <span className="mono text-[10px] uppercase tracking-[.14em] text-primary-foreground/55">From your weekly plan</span>}
              </div>
              {todaySessions.length > 0 ? (
                <>
                  <p className="mt-4 text-[11px] text-primary-foreground/65">
                    {todaySessions.length === 1 ? "Your planned session" : `${todaySessions.length} sessions planned today`}
                  </p>
                  <div className="mt-2 space-y-2">
                    {todaySessions.map((session) => {
                      const distance = formatSessionDistance(session, athlete.preferences.units);
                      return <div key={session.id} className={`rounded-xl ${todaySessions.length > 1 ? "border border-white/15 bg-white/10 p-3" : ""}`}>
                        <h2 className="display max-w-md text-xl md:text-2xl">{session.title}</h2>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-primary-foreground/70">
                          <span className="inline-flex items-center gap-1.5"><Timer size={14} />{session.duration}</span>
                          <span className="inline-flex items-center gap-1.5"><Gauge size={14} />{session.intensity}</span>
                          {distance && <span className="inline-flex items-center gap-1.5"><Activity size={14} />{distance}</span>}
                        </div>
                        {todaySessions.length === 1 && session.source !== "Weekly plan" && session.notes && <p className="mt-2 max-w-md text-xs leading-relaxed text-primary-foreground/70">{session.notes}</p>}
                      </div>;
                    })}
                  </div>
                </>
              ) : isPlanRestDay(athlete, shift(0)) ? (
                <div className="mt-4 rounded-xl border border-white/15 bg-white/10 p-4">
                  <p className="text-xs text-primary-foreground/65">Your weekly plan</p>
                  <h2 className="display mt-1 text-3xl">Rest day</h2>
                  <p className="mt-2 text-sm text-primary-foreground/70">Keep today restorative—go for a relaxed walk, stretch a bit, and let your body recharge.</p>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-white/15 bg-white/10 p-4">
                  <p className="text-xs text-primary-foreground/65">{athlete.preferences.plan.generatedAt ? "Your weekly plan" : "Today's schedule"}</p>
                  <h2 className="display mt-1 text-2xl md:text-3xl">Nothing planned today</h2>
                  {athlete.preferences.plan.generatedAt && <p className="mt-2 text-sm text-primary-foreground/70">No workout is scheduled for today in your weekly plan or Intervals.icu.</p>}
                </div>
              )}
            </div>
          </div>
          <div className="flex-1 rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
            <p className="mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
              The bigger picture
            </p>
            <h2 className="display mt-2 text-2xl">{!homePlan.generatedAt ? "No training plan yet" : athlete.preferences.plan.goalMode === "consistency" ? "Consistent training" : homeRaceTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{!homePlan.generatedAt ? <>Head to <Link href="/plan" className="font-semibold text-primary underline decoration-accent decoration-2 underline-offset-2 hover:decoration-accent/70">Plan</Link> to create your training plan.</> : athlete.preferences.plan.goalMode === "consistency" ? "No race date" : <>{athlete.raceTime && <>Goal {athlete.raceTime} · </>}{athlete.raceDate && daysToRace !== null ? `${prettyDate(athlete.raceDate)} · ${daysToRace} days to go` : "Add a target race in your athlete profile."}</>}</p>
            {homeRaceTimeline && <div className="mt-4 border-t border-border pt-3" aria-label="Race training timeline">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
                <div><p className="text-xs font-semibold text-foreground">Race timeline</p><p className="text-[11px] text-muted-foreground">{homeRaceTimeline.weeksUntilRace === 0 ? "Race day reached" : `${homeRaceTimeline.weeksUntilRace} ${homeRaceTimeline.weeksUntilRace === 1 ? "week" : "weeks"} to race`} · {homeRaceTimeline.totalWeeks} weeks in this plan</p></div>
                <p className="text-xs font-semibold text-primary">{homeRaceTimeline.peakLabel}</p>
              </div>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary" role="img" aria-label={`${homeRaceTimeline.completedWeeks} weeks completed, ${homeRaceTimeline.weeksUntilRace} weeks to race, ${homeRaceTimeline.peakLabel.toLowerCase()}`}>
                {[
                  { key: "completed", count: homeRaceTimeline.completedWeeks, color: "bg-emerald-500", label: "Completed" },
                  { key: "build", count: homeRaceTimeline.buildWeeksRemaining, color: "bg-sky-500", label: "Build and peak" },
                  { key: "taper", count: homeRaceTimeline.taperWeeksRemaining, color: "bg-amber-400", label: "Taper" },
                  { key: "race", count: homeRaceTimeline.raceWeeksRemaining, color: "bg-rose-500", label: "Race week" },
                ].filter((segment) => segment.count > 0).map((segment) => <span key={segment.key} title={`${segment.label}: ${segment.count} ${segment.count === 1 ? "week" : "weeks"}`} className={`h-full ${segment.color}`} style={{ flexGrow: segment.count, flexBasis: 0 }} />)}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                <span><i className="mr-1 inline-block size-2 rounded-full bg-emerald-500" />{homeRaceTimeline.completedWeeks} completed</span>
                <span><i className="mr-1 inline-block size-2 rounded-full bg-sky-500" />Build and peak</span>
                {homeRaceTimeline.taperWeeksRemaining > 0 && <span><i className="mr-1 inline-block size-2 rounded-full bg-amber-400" />Taper</span>}
                {homeRaceTimeline.raceWeeksRemaining > 0 && <span><i className="mr-1 inline-block size-2 rounded-full bg-rose-500" />Race week</span>}
              </div>
            </div>}
            {homePlan.generatedAt && <div className="mt-4 flex items-end justify-between gap-4 border-t border-border pt-4">
              <div><p className="text-xs font-medium text-muted-foreground">This week</p><p className="display mt-1 text-3xl text-foreground">{weekCompleted}/{weekScheduled}/{weekSkipped}</p></div>
              <p className="mb-1 text-right text-xs text-muted-foreground">completed / scheduled / skipped</p>
            </div>}
          </div>
        </div>
        <HealthMetricsDashboard />
      </section>
      <DailyCoachNote />
    </div>
  );
}

function TrainingPage() {
  return <CalendarSection />;
}

function DailyCoachNote() {
  const { wellness, wellnessError, checkIns } = useApp();
  const [expanded, setExpanded] = useState(false);
  const today = shift(0);
  const todayWellness = wellness.filter((record) => record.id === today);
  const latestWellnessDate = wellness[0]?.id;
  const todayCheckIn = checkIns.find((item) => item.timestamp === today);
  const metricDefinitions: Array<{
    key: keyof IntervalsWellness;
    label: string;
    format: (value: number) => string;
    direction: "lower" | "higher";
    family: "cardio" | "sleep" | "self-report" | "load";
    contextOnly?: boolean;
  }> = [
    { key: "hrv", label: "HRV", format: (value) => `${Math.round(value)} ms`, direction: "lower", family: "cardio" },
    { key: "restingHR", label: "Resting heart rate", format: (value) => `${Math.round(value)} bpm`, direction: "higher", family: "cardio" },
    { key: "avgSleepingHR", label: "Average overnight heart rate", format: (value) => `${Math.round(value)} bpm`, direction: "higher", family: "cardio" },
    { key: "sleepSecs", label: "Sleep duration", format: (value) => `${(value / 3600).toFixed(1)} h`, direction: "lower", family: "sleep" },
    { key: "sleepScore", label: "Sleep score", format: (value) => `${Math.round(value)}`, direction: "lower", family: "sleep" },
    { key: "readiness", label: "Intervals readiness", format: (value) => `${Math.round(value)}`, direction: "lower", family: "self-report" },
    { key: "stress", label: "Wearable stress", format: (value) => `${Math.round(value)} / 4`, direction: "higher", family: "self-report" },
    { key: "fatigue", label: "Wearable fatigue", format: (value) => `${Math.round(value)} / 4`, direction: "higher", family: "self-report" },
    { key: "soreness", label: "Wearable soreness", format: (value) => `${Math.round(value)} / 4`, direction: "higher", family: "self-report" },
    { key: "mood", label: "Mood", format: (value) => `${Math.round(value)} / 4`, direction: "lower", family: "self-report" },
    { key: "motivation", label: "Motivation", format: (value) => `${Math.round(value)} / 4`, direction: "lower", family: "self-report" },
    { key: "atl", label: "Acute training load", format: (value) => `${Math.round(value)}`, direction: "higher", family: "load", contextOnly: true },
    { key: "rampRate", label: "Training-load ramp", format: (value) => `${Math.round(value * 10) / 10}`, direction: "higher", family: "load", contextOnly: true },
    { key: "ctl", label: "Chronic training load", format: (value) => `${Math.round(value)}`, direction: "higher", family: "load", contextOnly: true },
  ];
  const wellnessEvidence = metricDefinitions.flatMap((definition) => {
    const currentSample = todayWellness.find((record) => finite(record[definition.key]));
    const yesterdaySample = definition.family === "cardio" || definition.family === "sleep"
      ? wellness.find((record) => record.id === shiftDate(today, -1) && finite(record[definition.key]))
      : undefined;
    const sample = currentSample ?? yesterdaySample;
    if (!sample) return [];
    const sampleDate = sample.id;
    const windowStart = shiftDate(sampleDate, -30);
    const prior = wellness
      .filter((record) => record.id < sampleDate && record.id >= windowStart && finite(record[definition.key]))
      .map((record) => record[definition.key] as number);
    const recentHrvReadings = definition.key === "hrv"
      ? wellness
        .filter((record) => record.id < sampleDate && record.id >= shiftDate(sampleDate, -30) && finite(record.hrv))
        .sort((a, b) => b.id.localeCompare(a.id))
        .slice(0, 7)
        .map((record) => record.hrv as number)
      : [];
    const value = sample[definition.key] as number;
    const historicalReference = definition.key === "hrv" ? historicalHrvBaseline(wellness, sampleDate)
      : definition.key === "sleepScore" ? historicalSleepScoreBaseline(wellness, sampleDate)
      : null;
    const isLongReference = historicalReference !== null;
    const baselineCount = historicalReference?.count ?? prior.length;
    const baselineReady = historicalReference ? historicalReference.ready : prior.length >= 7;
    const average = historicalReference
      ? historicalReference.center
      : baselineReady ? prior.reduce((sum, item) => sum + item, 0) / prior.length : null;
    const sd = historicalReference
      ? historicalReference.spread
      : average === null ? null : Math.sqrt(prior.reduce((sum, item) => sum + (item - average) ** 2, 0) / prior.length);
    const delta = average === null ? null : value - average;
    const nearAverage = delta !== null && sd !== null && (sd === 0 ? delta === 0 : Math.abs(delta) <= sd);
    const shiftedAdversely = delta !== null && sd !== null && !nearAverage && (definition.direction === "lower" ? delta < 0 : delta > 0);
    const recentHrvMedian = recentHrvReadings.length >= 5
      ? [...recentHrvReadings].sort((a, b) => a - b)[Math.floor(recentHrvReadings.length / 2)]
      : null;
    const hrvRemainsBelowLongTermReference = definition.key === "hrv"
      && average !== null && sd !== null && recentHrvMedian !== null
      && recentHrvMedian < average - sd;
    const trendStatus = delta !== null ? classifySignalTrend(String(definition.key), delta, nearAverage) : null;
    const deltaText = delta === null ? ""
      : definition.key === "sleepSecs" ? `${Math.round(Math.abs(delta) / 60)} min`
      : definition.key === "hrv" ? `${Math.round(Math.abs(delta))} ms`
      : definition.key === "restingHR" || definition.key === "avgSleepingHR" ? `${Math.round(Math.abs(delta))} bpm`
      : `${Math.round(Math.abs(delta) * 10) / 10} pts`;
    const comparisonText = delta === null ? ""
      : `${delta < 0 ? "−" : delta > 0 ? "+" : ""}${deltaText} vs ${isLongReference ? "90-day reference" : "30-day average"}${sd !== null && sd > 0 ? ` · ${Math.abs(delta / sd).toFixed(1)} SD ${delta < 0 ? "below" : delta > 0 ? "above" : "from"} average` : ""}`;
    const change = average === null ? `${isLongReference ? "Building long-term reference" : "Building baseline"} · ${baselineCount}/${definition.key === "hrv" ? HRV_BASELINE_MIN_READINGS : definition.key === "sleepScore" ? SLEEP_SCORE_BASELINE_MIN_READINGS : 7}`
      : definition.key === "hrv" && hrvRemainsBelowLongTermReference ? `Remains below long-term reference · ${comparisonText}`
      : definition.key === "sleepScore" ? `${sleepScoreCategory(value)} · ${comparisonText}`
      : comparisonText;
    return [{
      key: definition.key,
      label: sampleDate < today ? `${definition.label} · ${prettyDate(sampleDate)}` : definition.label,
      current: definition.format(value),
      baseline: average === null ? isLongReference ? `${definition.key === "hrv" ? "Long-term HRV" : "Long-term sleep-score"} reference building` : "Personal baseline building"
        : definition.key === "hrv" ? `90-day HRV reference ${definition.format(average)} · recent 30 days excluded`
          : definition.key === "sleepScore" ? `90-day sleep-score reference ${definition.format(average)}`
            : `30-day baseline ${definition.format(average)}`,
      change,
      tone: definition.contextOnly ? "unclear" as const : definition.key === "sleepScore" && value < 80 ? "attention" as const : shiftedAdversely ? "attention" as const : trendStatus?.tone ?? "unclear" as const,
      concern: shiftedAdversely || definition.key === "sleepScore" && value < 60,
      persistent: hrvRemainsBelowLongTermReference,
      family: definition.family,
      contextOnly: Boolean(definition.contextOnly),
    }];
  });
  const yesterday = shift(-1);
  const yesterdaySteps = wellness.find((record) => record.id === yesterday && finite(record.steps));
  const stepBaseline = yesterdaySteps ? wellness
    .filter((record) => record.id < yesterday && record.id >= shiftDate(yesterday, -30) && finite(record.steps))
    .map((record) => record.steps as number) : [];
  const stepsAverage = stepBaseline.length >= 7 ? stepBaseline.reduce((sum, item) => sum + item, 0) / stepBaseline.length : null;
  const activityEvidence = yesterdaySteps ? [{
    key: "steps-yesterday",
    label: "Steps · yesterday",
    current: Math.round(yesterdaySteps.steps as number).toLocaleString(),
    baseline: stepsAverage === null ? "Activity context · baseline building" : `30-day baseline ${Math.round(stepsAverage).toLocaleString()}`,
    change: stepsAverage === null ? `Building baseline · ${stepBaseline.length}/7` : `${(yesterdaySteps.steps as number) >= stepsAverage ? "+" : "−"}${Math.round(Math.abs((yesterdaySteps.steps as number) - stepsAverage)).toLocaleString()} steps · context only`,
    tone: "unclear" as const,
    concern: false,
    family: "activity",
    contextOnly: true,
  }] : [];
  const checkInEvidence = todayCheckIn ? [
    { key: "checkin-sleep", label: "Check-in · sleep quality", current: todayCheckIn.sleepQuality === null ? "Not entered" : `${todayCheckIn.sleepQuality}/5`, baseline: "Self-reported today", change: todayCheckIn.sleepQuality !== null && todayCheckIn.sleepQuality <= 2 ? "Low self-rating" : todayCheckIn.sleepQuality !== null && todayCheckIn.sleepQuality >= 4 ? "Good self-rating" : "Self-report", tone: todayCheckIn.sleepQuality !== null && todayCheckIn.sleepQuality <= 2 ? "attention" as const : "unclear" as const, concern: todayCheckIn.sleepQuality !== null && todayCheckIn.sleepQuality <= 2, family: "sleep", contextOnly: false },
    { key: "checkin-readiness", label: "Check-in · readiness", current: `${todayCheckIn.readiness}/10`, baseline: "Self-reported today", change: todayCheckIn.readiness <= 3 ? "Low self-rating" : todayCheckIn.readiness >= 7 ? "Good self-rating" : "Self-report", tone: todayCheckIn.readiness <= 3 ? "attention" as const : "unclear" as const, concern: todayCheckIn.readiness <= 3, family: "self-report", contextOnly: false },
    { key: "checkin-fatigue", label: "Check-in · fatigue", current: `${todayCheckIn.fatigue}/10`, baseline: "Self-reported today", change: todayCheckIn.fatigue >= 7 ? "High self-rating" : todayCheckIn.fatigue <= 3 ? "Low self-rating" : "Self-report", tone: todayCheckIn.fatigue >= 7 ? "attention" as const : "unclear" as const, concern: todayCheckIn.fatigue >= 7, family: "self-report", contextOnly: false },
    { key: "checkin-stress", label: "Check-in · stress", current: `${todayCheckIn.stress}/10`, baseline: "Self-reported today", change: todayCheckIn.stress >= 7 ? "High self-rating" : todayCheckIn.stress <= 3 ? "Low self-rating" : "Self-report", tone: todayCheckIn.stress >= 7 ? "attention" as const : "unclear" as const, concern: todayCheckIn.stress >= 7, family: "self-report", contextOnly: false },
    { key: "checkin-soreness", label: "Check-in · soreness", current: `${todayCheckIn.soreness}/10`, baseline: "Self-reported today", change: todayCheckIn.soreness >= 7 ? "High self-rating" : todayCheckIn.soreness <= 3 ? "Low self-rating" : "Self-report", tone: todayCheckIn.soreness >= 7 ? "attention" as const : "unclear" as const, concern: todayCheckIn.soreness >= 7, family: "self-report", contextOnly: false },
    ...(todayCheckIn.illness !== "None" ? [{ key: "checkin-illness", label: "Check-in · symptom", current: todayCheckIn.illness, baseline: "Self-reported today", change: "Reported symptom", tone: "attention" as const, concern: true, family: "symptom", contextOnly: false }] : []),
  ] : [];
  const signalBreakdown = [...wellnessEvidence, ...activityEvidence, ...checkInEvidence];
  const symptomsReported = Boolean(todayCheckIn && todayCheckIn.illness !== "None");
  const concernEvidence = signalBreakdown.filter((item) => item.concern && !item.contextOnly);
  const concernNames = [...new Set(concernEvidence.map((item) => item.label))];
  const persistentHrvConcern = wellnessEvidence.some((item) => item.key === "hrv" && item.persistent && item.concern);
  const relevantSignals = symptomsReported
    ? [
        ...checkInEvidence.filter((item) => item.key === "checkin-illness" || item.key === "checkin-readiness"),
        ...wellnessEvidence.filter((item) => (item.concern || item.persistent) && !item.contextOnly).slice(0, 3),
      ]
    : concernEvidence.slice(0, 3);
  const concernFamilies = new Set(concernEvidence.map((item) => item.family));
  const acuteLoadElevated = wellnessEvidence.some((item) => ["atl", "rampRate"].includes(String(item.key)) && item.concern);
  if (acuteLoadElevated && concernFamilies.size > 0) concernFamilies.add("load");
  const loadOnly = acuteLoadElevated && concernFamilies.size === 0;
  const baselineBackedSignals = wellnessEvidence.filter((item) => !item.contextOnly && !item.baseline.endsWith("building")).length;
  const enoughEvidence = Boolean(todayCheckIn) || baselineBackedSignals >= 2;
  const hasTodayInputs = signalBreakdown.length > 0;
  let tone: "good" | "caution" | "warning" = "good";
  let title = "Plan as scheduled";
  let text = "Current recovery signals are compared with your own recent patterns. They can add context, but they cannot determine exactly how ready you feel.";
  let matters = "A few measures near baseline are reassuring context, not proof that you are fully recovered. Use your energy, mood, and warm-up to decide how the planned effort feels.";
  let briefText = "Today’s available readings sit within their personal ranges.";
  let briefAdvice = "Enjoy your planned session and notice how you feel.";
  if (symptomsReported) {
    tone = "warning";
    title = "You reported a discomfort or symptom";
    text = "Your symptom report adds context that wearable sensors cannot capture; readings cannot rule out pain or illness.";
    matters = "If symptoms affect you, hard training may feel worse or be a poor tradeoff. Choose rest or gentle movement when needed, and seek appropriate care for concerning symptoms.";
    briefText = `You reported ${todayCheckIn!.illness.toLowerCase()}; let symptoms guide today’s effort.`;
    briefAdvice = "Skip hard effort if symptoms affect you; choose rest or gentle movement.";
  } else if (concernFamilies.size >= 2) {
    tone = "warning";
    title = "Several signals are outside your usual range";
    text = `${concernNames.join(", ")}${acuteLoadElevated ? ", alongside elevated acute load" : ""} contribute to today’s note. Differences across these measures can have many causes and don’t predict how the workout will feel.`;
    matters = "Differences across more than one area are worth noticing, though they do not identify a cause or predict performance. Start conservatively and let your warm-up and how you feel guide the session.";
    briefText = `Signals flagged: ${concernNames.slice(0, 3).join(", ")}${concernNames.length > 3 ? " and others" : ""}. Together they span more than one area of recovery.`;
    briefAdvice = "Start with a relaxed warm-up and scale the session if it feels unusually hard.";
  } else if (concernFamilies.size === 1) {
    tone = "caution";
    if (concernNames.length === 1 && concernNames[0].startsWith("HRV")) {
      if (persistentHrvConcern) {
        title = "HRV remains below your long-term range";
        text = "This call uses up to seven recent readings against your older 90-day reference, so the pattern was present before today rather than appearing as a single-day dip.";
        briefText = "The recent readings confirm this pattern has continued beyond today.";
        briefAdvice = "Use your energy and warm-up to guide the planned effort.";
      } else {
        title = "HRV is below your long-term range";
        text = "The reference excludes the most recent 30 days, so today’s comparison alone cannot show when this difference began.";
        briefText = "This single-day comparison doesn’t show when the difference began.";
        briefAdvice = "Use your energy and warm-up to guide the planned effort.";
      }
      matters = "A difference from an older reference does not by itself explain how you feel or determine readiness. Use your energy and warm-up to guide today’s effort.";
    } else {
      title = "A recovery signal is outside its usual range";
      text = `Signal flagged: ${concernNames.join(", ")}. A single measure is only one part of recovery context and doesn’t identify a cause on its own.`;
      matters = "An unusual signal may or may not affect training. Use a relaxed warm-up and adjust the effort if it feels harder than expected.";
      briefText = `${concernNames.join(", ")} is the specific signal to watch alongside how the warm-up feels.`;
      briefAdvice = "Check how the warm-up feels before pushing the planned effort.";
    }
  } else if (loadOnly) {
    tone = "caution";
    title = "Recent training load is above your usual range";
    text = "A planned build can raise acute load because it reflects recent training work. By itself, the number doesn’t mean you need to reduce today’s session.";
    matters = "Load is useful context alongside sleep, recovery signals, and how you feel. Follow the plan if recovery and the warm-up feel normal.";
    briefText = "Other available recovery signals don’t flag a separate concern today.";
    briefAdvice = "Follow the planned session if you feel good through the warm-up.";
  } else if (!hasTodayInputs || wellnessError || !enoughEvidence) {
    tone = "caution";
    title = todayCheckIn ? "Your check-in is today’s clearest signal" : "Not enough current data to assess today";
    text = wellnessError ? "Wearable data could not be refreshed. Any older readings may not reflect today." : "Only current readings with enough personal history can inform this note; missing or incomplete data does not mean you are ready or unready.";
    matters = "Use how you feel and how the warm-up goes. The app will show only signals that are current and relevant to today’s training decision.";
    briefText = todayCheckIn
      ? "Your check-in can help fill the gap left by limited wearable context."
      : wellnessError
        ? "Wearable data did not refresh, so older values may not reflect today."
        : "Some readings lack enough personal history for a useful comparison.";
    briefAdvice = todayCheckIn ? "Let your check-in and warm-up guide the effort." : "Use your energy and warm-up to guide today’s session.";
  }
  const toneStyle = {
    good: { card: "border-emerald-200 bg-emerald-50/70" },
    caution: { card: "border-amber-200 bg-amber-50/75" },
    warning: { card: "border-rose-200 bg-rose-50/75" },
  }[tone];
  return <section data-coach-tone={tone} className={`coach-note-card overflow-hidden rounded-2xl border p-0 shadow-sm ${toneStyle.card}`} aria-labelledby="coach-note-title">
    <div className="flex flex-col justify-between gap-0 sm:flex-row sm:items-stretch">
      <div className="flex min-w-0 flex-1 items-center">
        <span className="coach-note-icon flex h-28 w-24 shrink-0 items-center justify-center"><img src={`${import.meta.env.BASE_URL}branding/merlin-wizard.png`} alt="Merlin, your training coach" className="coach-note-wizard h-20 w-20 object-contain" /></span>
        <div className="min-w-0 flex-1 p-4 md:px-4 md:py-5">
          <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs"><span className="font-semibold text-foreground">Merlin</span><span className="text-muted-foreground">· Your coach · {latestWellnessDate ? prettyDate(latestWellnessDate) : "Today"}</span></p>
          <h2 id="coach-note-title" className="display mt-1 text-base leading-tight">{title}</h2>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-muted-foreground">{briefText}</p>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed"><strong className="text-foreground">Try today: </strong><span className="text-muted-foreground">{briefAdvice}</span></p>
        </div>
      </div>
      <div className="flex shrink-0 justify-end px-4 pb-4 sm:items-start sm:py-5 sm:pl-0 sm:pr-5">
        <button type="button" data-testid="button-coach-note-why" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-controls="coach-note-details" className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-foreground hover:underline">
          {expanded ? "Hide details" : "Get context"}<ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>
    </div>
    {expanded && <div id="coach-note-details" className="border-t border-accent/20 p-4 md:p-5">
      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        <div>
          <h3 className="text-xs font-bold">{symptomsReported ? "Key signals" : "Signals to note"}</h3>
          {relevantSignals.length > 0 ? <div className="mt-2 divide-y divide-border/70">{relevantSignals.map((item) => <div key={item.key} className="flex items-center justify-between gap-3 py-2 text-xs">
            <div><p className="font-medium capitalize">{item.label.replace("Check-in · ", "")}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{item.change}</p></div>
            <span className="text-right text-muted-foreground">{item.current}</span>
          </div>)}</div> : <p className="mt-2 text-xs text-muted-foreground">No specific signals to call out today.</p>}
        </div>
        <div className="rounded-xl border border-border/70 bg-card/70 p-3">
          <h3 className="text-xs font-bold">Today’s guidance</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{symptomsReported ? "If symptoms affect you, rest or choose gentle movement. Wearables can’t identify the cause." : matters}</p>
        </div>
      </div>
    </div>}
  </section>;
}

type SignalTone = "favorable" | "attention" | "unclear";

const signalToneClasses: Record<SignalTone, string> = {
  favorable: "bg-emerald-50 text-emerald-800",
  attention: "bg-rose-50 text-rose-800",
  unclear: "bg-slate-100 text-slate-700",
};

function sleepScoreCategory(score: number) {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Good";
  if (score >= 60) return "Fair";
  return "Poor";
}

function classifySignalTrend(key: string, delta: number, nearAverage: boolean) {
  if (nearAverage) return { label: "Near baseline", tone: "unclear" as const };
  const direction = delta > 0 ? "Above average" : "Below average";
  let tone: SignalTone = "unclear";
  if (key === "hrv") tone = delta < 0 ? "attention" : "unclear";
  else if (key === "restingHR" || key === "avgSleepingHR") tone = delta > 0 ? "attention" : "favorable";
  else if (key === "sleepSecs") tone = delta < 0 ? "attention" : "unclear";
  else if (key === "sleepScore" || key === "readiness" || key === "mood" || key === "motivation" || key === "vo2max") tone = delta > 0 ? "favorable" : "attention";
  else if (key === "stress" || key === "fatigue" || key === "soreness") tone = delta > 0 ? "attention" : "favorable";
  const label = tone === "unclear" ? `${direction} · unclear` : direction;
  return { label, tone };
}

function HealthMetricsDashboard() {
  const { athlete, wellness, wellnessError, connection } = useApp();
  const [metricGoals, setMetricGoals] = useState<Record<string, { value: number; direction: "atLeast" | "atMost" }>>(() => {
    try {
      const stored = localStorage.getItem("triathlon-coach-metric-goals");
      if (!stored) return {};
      const goals = JSON.parse(stored) as Record<string, { value: number; direction: "atLeast" | "atMost" }>;
      delete goals.ctl;
      delete goals.atl;
      delete goals.steps;
      delete goals.vo2max;
      return goals;
    } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem("triathlon-coach-metric-goals", JSON.stringify(metricGoals)); } catch { /* Keep goals in memory if storage is unavailable. */ }
  }, [metricGoals]);
  const latest = wellness[0];
  const formatSleepDuration = (value: unknown) => {
    let seconds: number | null = null;
    if (typeof value === "number" && Number.isFinite(value)) seconds = value;
    else if (typeof value === "string") {
      const text = value.trim();
      const clock = text.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
      const hoursAndMinutes = text.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/i);
      if (clock) seconds = Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3] ?? 0);
      else if (hoursAndMinutes && (hoursAndMinutes[1] || hoursAndMinutes[2])) seconds = Number(hoursAndMinutes[1] ?? 0) * 3600 + Number(hoursAndMinutes[2] ?? 0) * 60;
      else if (Number.isFinite(Number(text))) seconds = Number(text);
    }
    if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
    const minutes = Math.round(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return hours ? `${hours} h ${remainingMinutes} min` : `${remainingMinutes} min`;
  };
  const recordWith = (key: keyof IntervalsWellness) => wellness.find((record) => finite(record[key]));
  const valueFrom = (key: keyof IntervalsWellness) => recordWith(key)?.[key];
  const trendFor = (key: keyof IntervalsWellness) => {
    const sample = recordWith(key);
    if (!sample) return null;
    if (key === "hrv" || key === "sleepScore") {
      const reference = key === "hrv" ? historicalHrvBaseline(wellness, sample.id) : historicalSleepScoreBaseline(wellness, sample.id);
      return { sample, value: sample[key] as number, count: reference.count, required: key === "hrv" ? HRV_BASELINE_MIN_READINGS : SLEEP_SCORE_BASELINE_MIN_READINGS, average: reference.center, sd: reference.spread, comparisonLabel: "90-day reference" };
    }
    const windowStart = shiftDate(sample.id, -30);
    const baseline = wellness
      .filter((record) => record.id < sample.id && record.id >= windowStart && finite(record[key]))
      .map((record) => record[key] as number);
    if (baseline.length < 7) return { sample, value: sample[key] as number, count: baseline.length, required: 7, average: null as number | null, sd: null as number | null, comparisonLabel: "30-day average" };
    const average = baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
    const sd = Math.sqrt(baseline.reduce((sum, value) => sum + (value - average) ** 2, 0) / baseline.length);
    return { sample, value: sample[key] as number, count: baseline.length, required: 7, average, sd, comparisonLabel: "30-day average" };
  };
  const formatDelta = (key: string, delta: number) => {
    const absolute = Math.abs(delta);
    const rounded = Math.round(absolute * 10) / 10;
    const amount = key === "sleepSecs" ? `${Math.round(absolute / 60)} min`
      : key === "hrv" || key === "hrvSDNN" ? `${Math.round(absolute)} ms`
      : key === "restingHR" || key === "avgSleepingHR" ? `${Math.round(absolute)} bpm`
      : key === "respiration" ? `${rounded} breaths/min`
      : key === "steps" ? `${Math.round(absolute).toLocaleString()} steps`
      : key === "stress" || key === "fatigue" || key === "soreness" || key === "mood" || key === "motivation" || key === "readiness" ? `${rounded} pts`
      : key === "weight" || key === "tempWeight" ? `${rounded} ${athlete.preferences.units === "imperial" ? "lb" : "kg"}`
      : key === "kcalConsumed" || key === "kcal" ? `${Math.round(absolute)} kcal`
      : key === "spO2" ? `${rounded}%`
      : key === "vo2max" ? `${rounded} mL/kg/min`
      : key === "sleepScore" ? `${Math.round(absolute)} pts`
      : key === "hydration" || key === "hydrationVolume" ? `${rounded} L`
      : `${rounded} pts`;
    return `${delta < 0 ? "−" : "+"}${amount}`;
  };
  const hrv = valueFrom("hrv");
  const restingHR = valueFrom("restingHR");
  const sleepSecs = valueFrom("sleepSecs");
  const steps = valueFrom("steps");
  const bikeEftp = wellness.flatMap((record) => record.sportInfo ?? [])
    .find((sport) => ["Ride", "VirtualRide"].includes(sport.type ?? "") && finite(sport.eftp) && sport.eftp > 0)?.eftp;
  const weight = valueFrom("weight") ?? valueFrom("tempWeight");
  const stress = valueFrom("stress");
  const fatigue = valueFrom("fatigue");
  const spO2 = valueFrom("spO2");
  const metrics = [
    { key: "hrv", label: "HRV", value: finite(hrv) ? `${Math.round(hrv)} ms` : null, icon: HeartPulse, color: "text-rose-700 bg-rose-50" },
    { key: "restingHR", label: "Resting heart rate", value: finite(restingHR) ? `${Math.round(restingHR)} bpm` : null, icon: HeartPulse, color: "text-orange-700 bg-orange-50" },
    { key: "sleepSecs", label: "Sleep duration", value: finite(sleepSecs) ? formatSleepDuration(sleepSecs) : null, icon: Sunrise, color: "text-indigo-700 bg-indigo-50" },
    { key: "steps", label: "Steps", value: finite(steps) ? Math.round(steps).toLocaleString() : null, icon: Footprints, color: "text-sky-700 bg-sky-50" },
    { key: "weight", label: "Weight", value: finite(weight) ? `${(athlete.preferences.units === "imperial" ? weight * 2.20462 : weight).toFixed(1)} ${athlete.preferences.units === "imperial" ? "lb" : "kg"}` : null, icon: Activity, color: "text-sky-700 bg-sky-50" },
    { key: "stress", label: "Stress", value: finite(stress) ? `${Math.round(stress)} / 4` : null, icon: Zap, color: "text-amber-700 bg-amber-50" },
    { key: "fatigue", label: "Fatigue", value: finite(fatigue) ? `${Math.round(fatigue)} / 4` : null, icon: Gauge, color: "text-violet-700 bg-violet-50" },
    { key: "spO2", label: "Blood oxygen", value: finite(spO2) ? `${spO2.toFixed(1)}%` : null, icon: Activity, color: "text-cyan-700 bg-cyan-50" },
    { key: "sleepScore", label: "Sleep score", value: finite(valueFrom("sleepScore")) ? `${Math.round(valueFrom("sleepScore") as number)}` : null, icon: Sunrise, color: "text-indigo-700 bg-indigo-50" },
    { key: "avgSleepingHR", label: "Average overnight HR", value: finite(valueFrom("avgSleepingHR")) ? `${Math.round(valueFrom("avgSleepingHR") as number)} bpm` : null, icon: HeartPulse, color: "text-rose-700 bg-rose-50" },
    { key: "hrvSDNN", label: "HRV SDNN", value: finite(valueFrom("hrvSDNN")) ? `${Math.round(valueFrom("hrvSDNN") as number)} ms` : null, icon: HeartPulse, color: "text-violet-700 bg-violet-50" },
    { key: "respiration", label: "Respiration", value: finite(valueFrom("respiration")) ? `${(valueFrom("respiration") as number).toFixed(1)} breaths/min` : null, icon: Activity, color: "text-cyan-700 bg-cyan-50" },
    { key: "vo2max", label: "VO₂ max", value: finite(valueFrom("vo2max")) ? `${(valueFrom("vo2max") as number).toFixed(1)}` : null, icon: Activity, color: "text-sky-700 bg-sky-50" },
    { key: "bikeEftp", label: "Estimated bike FTP", value: finite(bikeEftp) && bikeEftp > 0 ? `${Math.round(bikeEftp)} W` : null, icon: Bike, color: "text-sky-700 bg-sky-50" },
    { key: "ctl", label: "Chronic load", value: finite(valueFrom("ctl")) ? `${Math.round(valueFrom("ctl") as number)}` : null, icon: TrendingUp, color: "text-sky-700 bg-sky-50" },
    { key: "atl", label: "Acute load", value: finite(valueFrom("atl")) ? `${Math.round(valueFrom("atl") as number)}` : null, icon: Zap, color: "text-sky-700 bg-sky-50" },
    { key: "kcalConsumed", label: "Calories consumed", value: finite(valueFrom("kcalConsumed")) ? `${Math.round(valueFrom("kcalConsumed") as number)} kcal` : null, icon: Activity, color: "text-orange-700 bg-orange-50" },
    { key: "readiness", label: "Intervals readiness", value: finite(valueFrom("readiness")) ? `${Math.round(valueFrom("readiness") as number)}` : null, icon: HeartPulse, color: "text-violet-700 bg-violet-50" },
  ].filter((metric) => metric.value !== null);
  const primarySignalOrder = ["sleepSecs", "sleepScore", "hrv", "restingHR"];
  const statGroups = [
    { title: "Load & activity", keys: ["ctl", "atl", "steps"] },
    { title: "Fitness estimates", keys: ["vo2max", "bikeEftp"] },
  ];
  const statOrder = statGroups.flatMap((group) => group.keys);
  const otherMetrics = metrics.filter((metric) => metric.key !== "weight" && ![...primarySignalOrder, ...statOrder].includes(metric.key));
  const hasSignals = primarySignalOrder.some((key) => metrics.some((metric) => metric.key === key));
  const hasStats = statOrder.some((key) => metrics.some((metric) => metric.key === key));
  const trendByKey: Record<string, ReturnType<typeof trendFor>> = Object.fromEntries(
    metrics.map(({ key }) => [key, trendFor(key as keyof IntervalsWellness)]),
  );
  const primarySignalLabels: Record<string, string> = { sleepSecs: "Sleep duration", sleepScore: "Sleep score", hrv: "HRV", restingHR: "Resting heart rate" };
  const renderPrimarySignal = (key: string) => {
    const metric = metrics.find((item) => item.key === key);
    const label = metric?.label ?? primarySignalLabels[key] ?? key;
    if (!metric) return <div key={key} className="min-h-20 rounded-xl border border-border/80 bg-background p-2" aria-label={`${label} unavailable`}><p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p><p className="mt-2 text-xs text-muted-foreground">No recent reading</p></div>;
    const { value, icon: Icon, color } = metric;
    const trend = trendByKey[key];
    return <div key={key} className="rounded-xl border border-border/80 bg-background p-2">
      <div className="flex items-start justify-between gap-1"><span className="text-[10px] font-medium leading-tight text-muted-foreground">{label}</span><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${color}`}><Icon size={12} /></span></div>
      <p className="mt-1 text-base font-semibold leading-tight tracking-tight">{value}</p>
      {trend?.average !== null && trend?.average !== undefined ? (() => {
        const delta = trend.value - trend.average;
        const nearAverage = trend.sd !== null && (trend.sd === 0 ? delta === 0 : Math.abs(delta) <= trend.sd);
        const trendStatus = key === "sleepScore"
          ? { label: sleepScoreCategory(trend.value), tone: trend.value < 80 ? "attention" as const : "favorable" as const }
          : classifySignalTrend(key, delta, nearAverage);
        return <div className="mt-1 space-y-0.5"><span className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold ${signalToneClasses[trendStatus.tone]}`}>{trendStatus.label}</span><p className="text-[9px] leading-tight text-muted-foreground">{formatDelta(key, delta)} vs {trend.comparisonLabel}</p></div>;
      })() : <p className="mt-2 text-[9px] leading-tight text-muted-foreground">{trend ? `${key === "hrv" || key === "sleepScore" ? "Building long-term reference" : "Building baseline"} · ${trend.count}/${trend.required} readings` : "No recent reading"}</p>}
    </div>;
  };
  const renderStat = (key: string) => {
    const metric = metrics.find((item) => item.key === key);
    if (!metric) return null;
    const { label, value, icon: Icon, color } = metric;
    const trend = trendByKey[key];
    const delta = trend?.average !== null && trend?.average !== undefined ? trend.value - trend.average : null;
    const context = key === "bikeEftp" ? "Intervals.icu cycling estimate"
      : key === "vo2max" ? "Device estimate · mL/kg/min"
      : delta !== null && trend ? `${formatDelta(key, delta)} vs ${trend.comparisonLabel}`
      : trend ? `Building baseline · ${trend.count}/${trend.required} readings` : "No recent trend";
    return <div key={key} className="rounded-xl border border-border/80 bg-background p-2">
      <div className="flex items-start justify-between gap-1"><span className="text-[10px] font-medium leading-tight text-muted-foreground">{label}</span><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${color}`}><Icon size={12} /></span></div>
      <p className="mt-1 text-base font-semibold leading-tight tracking-tight">{value}</p>
      <p className="mt-1 text-[9px] leading-tight text-muted-foreground">{context}</p>
    </div>;
  };
  return (
    <div className="fade-up delay-2 flex min-w-0 flex-col gap-3">
      <section className="rounded-2xl border border-border bg-card p-3 shadow-sm md:p-4" aria-labelledby="health-metrics-title">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Health & recovery</p>
          <h2 id="health-metrics-title" className="display mt-1 text-2xl">Your signals</h2>
        </div>
      </div>
      {!wellnessError && hasSignals ? (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {primarySignalOrder.slice(0, 4).map(renderPrimarySignal)}
          </div>
          {otherMetrics.length > 0 && <details className="mt-3 border-t border-border pt-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">Other health readings ({otherMetrics.length})</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {otherMetrics.map(({ key, label, value, icon: Icon, color }) => {
                const trend = trendByKey[key];
                const hasBaseline = trend?.average !== null && trend?.average !== undefined;
                const delta = hasBaseline ? trend.value - trend.average! : null;
                const nearAverage = hasBaseline && trend.sd !== null && (trend.sd === 0 ? delta === 0 : Math.abs(delta!) <= trend.sd);
                const trendStatus = hasBaseline ? classifySignalTrend(key, delta!, nearAverage) : null;
                const trendLabel = trendStatus?.label ?? (trend ? `Building baseline · ${trend.count}/${trend.required} readings` : "No recent trend");
                const tone = trendStatus ? signalToneClasses[trendStatus.tone] : "bg-secondary text-secondary-foreground";
                const goalEligible = !["ctl", "atl", "steps", "vo2max"].includes(key);
                const goal = goalEligible ? metricGoals[key] : undefined;
                const goalDelta = trend && goal ? (goal.direction === "atLeast" ? goal.value - trend.value : trend.value - goal.value) : null;
                const goalMet = goalDelta !== null && goalDelta <= 0;
                const goalText = !goal ? "No personal target set" : goalMet ? "Target met" : `${formatDelta(key, Math.abs(goalDelta!)).slice(1)} ${goal.direction === "atLeast" ? "to target" : "over target"}`;
                return <div key={key} className="rounded-xl border border-border/80 bg-background p-3">
                  <div className="flex items-center gap-3"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${color}`}><Icon size={15} /></span><div className="min-w-0"><p className="truncate text-xs text-muted-foreground">{label}</p><p className="text-base font-semibold">{value}</p></div></div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}>{trendLabel}</span>{delta !== null && <span className="text-[10px] text-muted-foreground">{formatDelta(key, delta)} · {trend?.comparisonLabel ?? "30-day average"}</span>}</div>
                  {goalEligible && <p className="mt-1 text-[11px] text-muted-foreground">{goal ? `Goal ${goal.direction === "atLeast" ? "≥" : "≤"} ${formatDelta(key, goal.value).slice(1)} · ${goalText}` : goalText}</p>}
                  {goalEligible && <details className="mt-3 border-t border-border/70 pt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">{goal ? "Edit personal goal" : "Set personal goal"}</summary>
                    <div className="mt-3 space-y-3">
                      <div>
                        <label htmlFor={`goal-direction-${key}`} className="mb-1 block text-[11px] font-semibold text-muted-foreground">Goal direction</label>
                        <select id={`goal-direction-${key}`} aria-label={`${label} goal direction`} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" value={goal?.direction ?? "atLeast"} onChange={(event) => setMetricGoals((current) => ({ ...current, [key]: { value: current[key]?.value ?? 0, direction: event.target.value as "atLeast" | "atMost" } }))}>
                          <option value="atLeast">At least</option><option value="atMost">At most</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor={`goal-value-${key}`} className="mb-1 block text-[11px] font-semibold text-muted-foreground">Target value</label>
                        <input id={`goal-value-${key}`} aria-label={`${label} personal target`} className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" type="number" min="0" step="any" value={goal?.value ?? ""} placeholder="Enter target" onChange={(event) => {
                          const value = event.target.value === "" ? null : Number(event.target.value);
                          setMetricGoals((current) => {
                            const next = { ...current };
                            if (value === null || !Number.isFinite(value)) delete next[key];
                            else next[key] = { value, direction: current[key]?.direction ?? "atLeast" };
                            return next;
                          });
                        }} />
                      </div>
                    </div>
                  </details>}
                </div>;
              })}
            </div>
          </details>}
        </>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-border bg-background px-4 py-5 text-center">
          <HeartPulse className="mx-auto text-muted-foreground" size={20} />
          <p className="mt-2 text-sm font-semibold">{wellnessError ? "Wellness data couldn’t be loaded" : "No recovery readings yet"}</p>
          <p className="mt-1 text-xs text-muted-foreground">{wellnessError || "Sleep and heart readings will appear here when available."}</p>
        </div>
      )}
      </section>
      <section className="rounded-2xl border border-border bg-card p-3 shadow-sm md:p-4" aria-labelledby="training-stats-title">
        <p className="mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Training & activity</p>
        <h2 id="training-stats-title" className="display mt-1 text-2xl">Your stats</h2>
        {hasStats
          ? <div className="mt-3 space-y-3">{statGroups.map((group) => {
              const availableStats = group.keys.filter((key) => metrics.some((metric) => metric.key === key));
              if (availableStats.length === 0) return null;
              return <section key={group.title} aria-label={group.title}>
                <h3 className="mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">{group.title}</h3>
                <div className="mt-1.5 grid grid-cols-2 gap-2 lg:grid-cols-4">{availableStats.map(renderStat)}</div>
              </section>;
            })}</div>
          : !connection.configured && <p className="mt-3 rounded-xl border border-dashed border-border bg-background px-4 py-5 text-xs text-muted-foreground">Connect your required Intervals.icu account to see training stats.</p>}
      </section>
    </div>
  );
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return iso(value);
}

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }

function CalendarSessionCard({ session: s, onSelect, density = "normal" }: { session: TrainingSession; onSelect: (session: TrainingSession) => void; density?: "normal" | "compact" | "mini" }) {
  const tone = s.status === "completed" ? "bg-emerald-50/70 shadow-sm" : s.status === "missed" ? "bg-red-50/80 shadow-sm" : s.status === "skipped" ? "bg-secondary/50 shadow-sm" : s.source === "Weekly plan" ? "bg-accent/[.045] shadow-sm" : "bg-background shadow-sm hover:bg-secondary/40";
  const statusMark = s.status === "completed" ? <CheckCircle2 size={15} className="shrink-0 text-emerald-600" /> : s.status === "missed" ? <X size={15} className="shrink-0 text-red-700" aria-label="Missed workout" /> : s.status === "skipped" ? <X size={15} className="shrink-0 text-muted-foreground" aria-label="Skipped workout" /> : <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-label="Pending workout" />;
  const displayTitle = s.title.replace(/\s+session$/i, "");
  if (density === "mini") return <button type="button" onClick={() => onSelect(s)} aria-label={`View details for ${s.title}`} data-testid={`calendar-session-${s.id}`} className={`flex w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${tone}`}>
    {statusMark}<span className={`min-w-0 truncate text-[9px] font-semibold ${s.status === "missed" ? "text-red-900" : ""}`}>{displayTitle}</span>
  </button>;
  if (density === "compact") return <button type="button" onClick={() => onSelect(s)} aria-label={`View details for ${s.title}`} data-testid={`calendar-session-${s.id}`} className={`flex h-9 min-w-0 w-full items-center gap-1.5 rounded-lg px-1.5 text-left transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${tone}`}>
    <SessionIcon sport={s.sport} compact />
    <span className="min-w-0 flex-1">
      <span className={`block truncate text-[10px] font-bold leading-tight ${s.status === "missed" ? "text-red-900" : ""}`}>{displayTitle}</span>
      {s.duration !== "Details pending" && <span className={`mt-0.5 block truncate text-[9px] leading-tight ${s.status === "missed" ? "text-red-800/75" : "text-muted-foreground"}`}>{s.startTime ? `${s.startTime} · ` : ""}{s.workoutDisplayLabel ?? s.duration}</span>}
    </span>
    {statusMark}
  </button>;
  return (
    <button type="button" onClick={() => onSelect(s)} aria-label={`View details for ${s.title}`} data-testid={`calendar-session-${s.id}`} className={`flex h-14 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${tone}`}>
      <SessionIcon sport={s.sport} compact />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-xs font-bold leading-tight ${s.status === "missed" ? "text-red-900" : ""}`}>{displayTitle}</span>
        {s.duration !== "Details pending" && <span className={`mt-0.5 block truncate text-[10px] leading-tight ${s.status === "missed" ? "text-red-800/75" : "text-muted-foreground"}`}>{s.startTime ? `${s.startTime} · ` : ""}{s.workoutDisplayLabel ?? s.duration}</span>}
      </span>
      {statusMark}
    </button>
  );
}

function formatStepDuration(seconds?: number) {
  if (seconds === undefined) return "";
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(seconds % 3600 === 0 ? 0 : 1)} h`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)} min${seconds % 60 ? ` ${seconds % 60} sec` : ""}`;
  return `${seconds} sec`;
}

function formatWorkoutTargetValue(value: IntervalsWorkoutValue, label: string, unitSystem: UnitSystem) {
  const units = value.units ?? "";
  const formatNumber = (number: number) => {
    if (label === "Pace" && units === "m/s" && number > 0) {
      const paceSeconds = 1000 / number;
      const pace = unitSystem === "metric" ? paceSeconds : paceSeconds * 1.609344;
      return `${Math.floor(pace / 60)}:${String(Math.round(pace % 60)).padStart(2, "0")}/${unitSystem === "metric" ? "km" : "mi"}`;
    }
    if (label === "Pace" && units === "MINS_KM") {
      const paceSeconds = number * 60 * (unitSystem === "metric" ? 1 : 1.609344);
      return `${Math.floor(paceSeconds / 60)}:${String(Math.round(paceSeconds % 60)).padStart(2, "0")}/${unitSystem === "metric" ? "km" : "mi"}`;
    }
    if (units.startsWith("secs/")) {
      const sourceIsMetric = units.toLowerCase().includes("/km") || units.toLowerCase().includes("/100m");
      const converted = sourceIsMetric && unitSystem === "imperial" ? number * 1.609344 : !sourceIsMetric && unitSystem === "metric" && units.toLowerCase().includes("/mi") ? number / 1.609344 : number;
      const minutes = Math.floor(converted / 60);
      const seconds = Math.round(converted % 60);
      return `${minutes}:${String(seconds).padStart(2, "0")}/${unitSystem === "metric" ? "km" : "mi"}`;
    }
    const displayUnits = units || (label === "Power" ? "W" : label === "HR" ? "bpm" : label === "Cadence" ? "rpm" : "");
    return `${Number.isInteger(number) ? number : number.toFixed(1)}${displayUnits ? ` ${displayUnits}` : ""}`;
  };
  const range = value.start !== undefined && value.end !== undefined
    ? `${formatNumber(value.start)}–${formatNumber(value.end)}`
    : value.value !== undefined ? formatNumber(value.value) : "";
  return range ? `${label}: ${range}` : "";
}

function WorkoutStepItem({ step, index, unitSystem, sport }: { step: IntervalsWorkoutStep; index: number; unitSystem: UnitSystem; sport: Sport }) {
  const target = [
    formatWorkoutTargetValue(step._power ?? step.power ?? {}, "Power", unitSystem),
    formatWorkoutTargetValue(step._hr ?? step.hr ?? {}, "HR", unitSystem),
    formatWorkoutTargetValue(step._pace ?? step.pace ?? {}, "Pace", unitSystem),
    formatWorkoutTargetValue(step.cadence ?? {}, "Cadence", unitSystem),
  ].filter(Boolean);
  const detail = [step.distance ? formatDistance(step.distance, unitSystem, sport) : "", step.duration !== undefined ? formatStepDuration(step.duration) : "", ...target].filter(Boolean).join(" · ");
  return (
    <li key={`${index}-${step.text ?? step.intensity ?? "step"}`} className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold">{step.reps ? `${step.reps} × ` : ""}{step.text || step.intensity || `Step ${index + 1}`}</p>
        {step.intensity && <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{step.intensity}</span>}
      </div>
      {detail && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>}
      {step.steps && step.steps.length > 0 && <ol className="mt-3 space-y-2 border-l-2 border-border pl-3">{step.steps.map((child, childIndex) => <WorkoutStepItem key={`${index}-${childIndex}`} step={child} index={childIndex} unitSystem={unitSystem} sport={sport} />)}</ol>}
    </li>
  );
}

function ActivityIntervals({ intervals, unitSystem, sport }: { intervals: NonNullable<IntervalsActivityDetails["icu_intervals"]>; unitSystem: UnitSystem; sport: Sport }) {
  if (intervals.length === 0) return null;
  return <section className="space-y-3">
    <div><h3 className="text-sm font-bold">Completed intervals</h3><p className="mt-1 text-xs text-muted-foreground">Lap and work segment data from Intervals.icu.</p></div>
    <ol className="max-h-72 space-y-2 overflow-y-auto pr-1">
      {intervals.map((interval, index) => <li key={`${index}-${interval.type ?? "interval"}`} className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background p-3">
        <div><p className="text-xs font-bold">{interval.type || `Interval ${index + 1}`}</p><p className="mt-1 text-[11px] text-muted-foreground">{[interval.distance ? formatDistance(interval.distance, unitSystem, sport) : "", interval.moving_time !== undefined ? formatStepDuration(interval.moving_time) : ""].filter(Boolean).join(" · ") || "Duration not provided"}</p></div>
        <p className="text-right text-[11px] text-muted-foreground">{[interval.average_watts ? `${Math.round(interval.average_watts)} W` : "", interval.average_heartrate ? `${Math.round(interval.average_heartrate)} bpm` : "", interval.average_cadence ? `${Math.round(interval.average_cadence)} rpm` : ""].filter(Boolean).join(" · ")}</p>
      </li>)}
    </ol>
  </section>;
}

function CalendarSection() {
  const { athlete, sessions, connection } = useApp();
  const [calendarHasMoved, setCalendarHasMoved] = useState(false);
  const [selectedSession, setSelectedSession] = useState<TrainingSession | null>(null);
  const [activityDetails, setActivityDetails] = useState<IntervalsActivityDetails | null>(null);
  const [activityDetailsLoading, setActivityDetailsLoading] = useState(false);
  const [activityDetailsError, setActivityDetailsError] = useState("");
  const calendarScrollRef = useRef<HTMLDivElement | null>(null);
  const currentWeekRef = useRef<HTMLElement | null>(null);
  const restoreTimer = useRef<number | null>(null);
  const centerAnimationFrame = useRef<number | null>(null);
  const positioningCurrentWeek = useRef(false);
  useEffect(() => {
    let active = true;
    setActivityDetails(null);
    setActivityDetailsError("");
    if (!selectedSession?.intervalsActivityId) {
      setActivityDetailsLoading(false);
      return () => { active = false; };
    }
    setActivityDetailsLoading(true);
    void dataApi.intervalsActivityDetails(selectedSession.intervalsActivityId)
      .then((details) => { if (active) setActivityDetails(details); })
      .catch((error) => { if (active) setActivityDetailsError(error instanceof Error ? error.message : "Could not load interval details."); })
      .finally(() => { if (active) setActivityDetailsLoading(false); });
    return () => { active = false; };
  }, [selectedSession?.intervalsActivityId]);
  const calendarToday = shift(0);
  const currentWeekStart = new Date(`${calendarToday}T00:00:00Z`);
  currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() - ((currentWeekStart.getUTCDay() + 6) % 7));
  const getWeekDates = (offset: number) => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(currentWeekStart);
    date.setUTCDate(currentWeekStart.getUTCDate() + offset * 7 + index);
    return iso(date);
  });
  const calendarWeeksInEitherDirection = 52;
  const weekEntries = Array.from({ length: calendarWeeksInEitherDirection * 2 + 1 }, (_, index) => {
    const offset = index - calendarWeeksInEitherDirection;
    return { offset, days: getWeekDates(offset) };
  });
  const allCalendarDates = [...new Set(weekEntries.flatMap((week) => week.days))];
  const confirmedSessions = withWorkoutConfirmations(athlete.preferences.plan, sessions);
  const plannedSessions = planSessionsForDates(athlete, allCalendarDates, confirmedSessions);
  const calendarSessions = [...confirmedSessions, ...plannedSessions];
  const weekPhaseLabel = (days: string[]) => {
    const plan = athlete.preferences.plan;
    if (!plan.generatedAt) return "";
    const startDate = plan.generatedAt.slice(0, 10);
    const firstPlannedDay = days.find((day) => day >= startDate && (plan.goalMode !== "race" || !athlete.raceDate || day <= athlete.raceDate));
    return firstPlannedDay ? planWeekForDate(plan, firstPlannedDay, athlete.raceDate)?.label ?? "" : "";
  };
  const centerCurrentWeek = (behavior: ScrollBehavior = "smooth") => {
    const scroller = calendarScrollRef.current;
    const target = currentWeekRef.current;
    if (!scroller || !target) return;
    const topInScroller = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const top = topInScroller - (scroller.clientHeight - target.getBoundingClientRect().height) / 2;
    positioningCurrentWeek.current = true;
    if (centerAnimationFrame.current !== null) {
      cancelAnimationFrame(centerAnimationFrame.current);
      centerAnimationFrame.current = null;
    }
    if (restoreTimer.current !== null) {
      window.clearTimeout(restoreTimer.current);
      restoreTimer.current = null;
    }
    const destination = Math.max(0, top);
    if (behavior === "smooth") {
      const startTop = scroller.scrollTop;
      const distance = destination - startTop;
      const startTime = performance.now();
      const duration = 650;
      const animate = (now: number) => {
        const progress = Math.min(1, (now - startTime) / duration);
        const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - ((-2 * progress + 2) ** 3) / 2;
        scroller.scrollTop = startTop + distance * eased;
        if (progress < 1) {
          centerAnimationFrame.current = requestAnimationFrame(animate);
        } else {
          centerAnimationFrame.current = null;
          positioningCurrentWeek.current = false;
          setCalendarHasMoved(false);
        }
      };
      centerAnimationFrame.current = requestAnimationFrame(animate);
    } else {
      scroller.scrollTo({ top: destination, behavior: "auto" });
      restoreTimer.current = window.setTimeout(() => {
        restoreTimer.current = null;
        positioningCurrentWeek.current = false;
        setCalendarHasMoved(false);
      }, 50);
    }
  };
  const scrollCalendarToCurrent = () => centerCurrentWeek("smooth");
  const handleCalendarInput = () => {
    positioningCurrentWeek.current = false;
    if (centerAnimationFrame.current !== null) {
      cancelAnimationFrame(centerAnimationFrame.current);
      centerAnimationFrame.current = null;
    }
    if (restoreTimer.current !== null) {
      window.clearTimeout(restoreTimer.current);
      restoreTimer.current = null;
    }
    setCalendarHasMoved(true);
  };
  const handleCalendarScroll = () => {
    if (positioningCurrentWeek.current) return;
    if (centerAnimationFrame.current !== null) {
      cancelAnimationFrame(centerAnimationFrame.current);
      centerAnimationFrame.current = null;
    }
    if (restoreTimer.current !== null) {
      window.clearTimeout(restoreTimer.current);
      restoreTimer.current = null;
    }
    setCalendarHasMoved(true);
  };
  const scrollToCurrent = () => scrollCalendarToCurrent();
  useEffect(() => {
    let layoutFrame: number | null = null;
    const frame = requestAnimationFrame(() => {
      layoutFrame = requestAnimationFrame(() => centerCurrentWeek("auto"));
    });
    const scroller = calendarScrollRef.current;
    const target = currentWeekRef.current;
    const resizeObserver = scroller && target
      ? new ResizeObserver(() => centerCurrentWeek("auto"))
      : null;
    if (resizeObserver && scroller && target) {
      resizeObserver.observe(scroller);
      resizeObserver.observe(target);
    }
    return () => {
      resizeObserver?.disconnect();
      cancelAnimationFrame(frame);
      if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
    };
  }, []);
  useEffect(() => () => {
    if (restoreTimer.current !== null) window.clearTimeout(restoreTimer.current);
    if (centerAnimationFrame.current !== null) cancelAnimationFrame(centerAnimationFrame.current);
  }, []);
  const renderDay = (day: string) => {
    const daySessions = calendarSessions.filter((session) => session.date === day);
    const restDay = daySessions.length === 0 && isPlanRestDay(athlete, day);
    const raceDay = athlete.preferences.plan.goalMode === "race" && athlete.preferences.plan.generatedAt && day === athlete.raceDate;
    const isToday = day === shift(0);
    const isPastDay = day < shift(0);
    const date = new Date(`${day}T12:00:00`);
    return <div key={day} className={`min-h-[160px] min-w-0 rounded-2xl p-2.5 ${isToday ? "bg-accent/[.055] shadow-sm" : restDay ? "bg-slate-100 text-slate-600" : "bg-card/80"}`}>
      <div className="mb-3 flex items-center justify-between gap-1">
        <div className="flex min-w-0 items-center gap-2"><p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">{new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date)}</p><p className={`text-lg font-semibold ${isToday ? "text-accent" : ""}`}>{date.getDate()}</p></div>
      </div>
      <div>
        {daySessions.length >= 3 ? <div className="flex min-w-0 flex-col gap-1.5">{daySessions.map((session) => <CalendarSessionCard key={session.id} session={session} onSelect={setSelectedSession} density="compact" />)}</div>
          : daySessions.length > 0 ? <div className="flex min-w-0 flex-col gap-2">{daySessions.map((session) => <CalendarSessionCard key={session.id} session={session} onSelect={setSelectedSession} density="normal" />)}</div>
          : raceDay ? <div className="flex h-14 items-center justify-center rounded-xl bg-accent/10 text-center text-xs font-semibold text-primary">Race day</div>
          : restDay ? <div className="flex h-14 items-center justify-center rounded-xl bg-slate-100 text-center text-xs font-semibold text-slate-600" data-testid={`calendar-rest-${day}`}>Rest day</div>
          : <div className={`flex h-14 items-center justify-center rounded-xl text-center text-xs ${isPastDay ? "bg-secondary/35 text-muted-foreground" : "border border-dashed border-border bg-white/40 text-muted-foreground"}`}>{isPastDay ? "No session" : "Unplanned"}</div>}
      </div>
    </div>;
  };
  return (
    <section id="training-calendar" className="flex h-[calc(100dvh-3rem)] min-h-0 flex-col gap-4 pt-2 scroll-mt-24 md:h-[calc(100dvh-3.75rem)]">
      <div>
        <p className="mono mb-2 text-[10px] uppercase tracking-[.18em] text-muted-foreground">Training calendar</p>
        <h1 className="display text-4xl md:text-5xl">Your weeks in motion</h1>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border/70 bg-background/70 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
          <span className="inline-flex items-center gap-2 text-[11px] font-semibold text-muted-foreground"><ChevronUp size={14} className="text-primary" /> Previous weeks</span>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button onClick={scrollToCurrent} variant="secondary" testId="button-jump-today"><CalendarDays size={16} /> Today</Button>
          </div>
        </div>
        <div ref={calendarScrollRef} onScroll={handleCalendarScroll} onWheel={handleCalendarInput} onTouchMove={handleCalendarInput} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-y-contain p-3">
          {weekEntries.map(({ offset, days }, weekIndex) => {
            const firstOfMonth = days.find((day) => new Date(`${day}T12:00:00`).getDate() === 1);
            const monthLabel = (day: string) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(`${day}T12:00:00`));
            const spansMonths = monthLabel(days[0]) !== monthLabel(days[6]);
            const monthDivider = weekIndex === 0
              ? monthLabel(days[0])
              : firstOfMonth
                ? spansMonths ? `${monthLabel(days[0])} → ${monthLabel(days[6])}` : monthLabel(firstOfMonth)
                : null;
            return <section key={days[0]} ref={offset === 0 ? currentWeekRef : undefined} className={`rounded-2xl p-3 transition-[filter,opacity] duration-700 ${offset === 0 ? "bg-secondary/20" : "bg-transparent"} ${athlete.preferences.calendarBlurEnabled && !calendarHasMoved && offset !== 0 ? "blur-[2px] opacity-60" : "blur-0 opacity-100"}`}>
              {monthDivider && <div className="mb-2 flex items-center gap-3 px-1"><p className="mono shrink-0 text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">{monthDivider}</p><div className="h-px flex-1 bg-border/70" /></div>}
              <div className={`mb-3 flex items-center gap-3 ${offset === 0 ? "justify-between" : "justify-end"}`}>{offset === 0 && <p className="text-xs font-bold">Current week</p>}<p className="text-xs text-muted-foreground">Week {isoWeekNumber(days[0])}{weekPhaseLabel(days) ? ` · ${weekPhaseLabel(days)}` : ""}</p></div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-7">{days.map((day) => renderDay(day))}</div>
            </section>;
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 text-[11px] font-semibold text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-normal">
            <span className="flex items-center gap-2"><X size={14} className="text-red-700" /> Missed</span>
            <span className="flex items-center gap-2"><CheckCircle2 size={14} className="text-emerald-600" /> Completed</span>
            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-400" /> Pending</span>
            <span className="flex items-center gap-2"><Info size={14} /> Select a session to view workout details</span>
            {!connection.configured && <span className="text-amber-700">Connect your required Intervals.icu account in Settings to load workouts.</span>}
          </div>
          <span className="flex shrink-0 items-center gap-2">Upcoming weeks<ChevronDown size={14} className="text-primary" /></span>
        </div>
      </div>
      <Dialog open={Boolean(selectedSession)} onOpenChange={(open) => { if (!open) setSelectedSession(null); }}>
        {selectedSession && <DialogContent className="max-w-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3 pr-8"><SessionIcon sport={selectedSession.sport} /><div><DialogTitle className="display text-2xl">{selectedSession.title}</DialogTitle><DialogDescription className="mt-1">{prettyDate(selectedSession.date)} · {sportMeta[selectedSession.sport].label}</DialogDescription></div></div>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl bg-secondary/60 p-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</p><p className="mt-1 text-sm font-semibold capitalize">{selectedSession.status}</p></div>
            <div className="rounded-xl bg-secondary/60 p-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{selectedSession.source === "Weekly plan" ? "Workout target" : "Duration"}</p><p className="mt-1 text-sm font-semibold">{selectedSession.workoutDisplayLabel ?? selectedSession.duration}</p></div>
            <div className="rounded-xl bg-secondary/60 p-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{selectedSession.source === "Weekly plan" ? "Distance estimate" : "Distance"}</p><p className="mt-1 text-sm font-semibold">{selectedSession.plannedDistanceMeters !== undefined && selectedSession.source === "Weekly plan" ? `${selectedSession.plannedDistanceIsEstimate ? "~" : ""}${formatDistance(selectedSession.plannedDistanceMeters, athlete.preferences.units, selectedSession.sport) ?? "—"}` : formatSessionDistance(selectedSession, athlete.preferences.units) || "—"}</p></div>
            <div className="rounded-xl bg-secondary/60 p-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Training load</p><p className="mt-1 text-sm font-semibold">{selectedSession.intensity.startsWith("Training load") ? selectedSession.intensity.replace("Training load ", "") : "—"}</p></div>
          </div>
          {selectedSession.averageHeartRate && <p className="text-sm text-muted-foreground">Average heart rate: <span className="font-semibold text-foreground">{Math.round(selectedSession.averageHeartRate)} bpm</span></p>}
          {selectedSession.source && <p className="text-xs text-muted-foreground">Recorded with {selectedSession.source}</p>}
          {(selectedSession.workoutDescription || (selectedSession.source !== "Weekly plan" && selectedSession.notes)) && <section className="rounded-xl border border-border p-4"><h3 className="text-sm font-bold">Workout details</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{selectedSession.workoutDescription || selectedSession.notes}</p></section>}
          {selectedSession.workoutSteps && selectedSession.workoutSteps.length > 0 && <section className="space-y-3"><div><h3 className="text-sm font-bold">Workout structure</h3><p className="mt-1 text-xs text-muted-foreground">Planned intervals and targets from Intervals.icu.</p></div><ol className="max-h-72 space-y-2 overflow-y-auto pr-1">{selectedSession.workoutSteps.map((step, index) => <WorkoutStepItem key={index} step={step} index={index} unitSystem={athlete.preferences.units} sport={selectedSession.sport} />)}</ol></section>}
          {activityDetailsLoading && <p className="text-sm text-muted-foreground">Loading completed interval details…</p>}
          {activityDetailsError && <p className="rounded-lg bg-secondary/60 p-3 text-xs text-muted-foreground">{activityDetailsError} Showing the activity summary available from the calendar.</p>}
          {activityDetails?.icu_intervals && activityDetails.icu_intervals.length > 0 && <ActivityIntervals intervals={activityDetails.icu_intervals} unitSystem={athlete.preferences.units} sport={selectedSession.sport} />}
          {selectedSession.intervalsActivityId && activityDetails && !activityDetailsLoading && !activityDetailsError && !activityDetails.icu_intervals?.length && <p className="text-xs text-muted-foreground">Intervals.icu didn’t return a lap-by-lap breakdown for this activity.</p>}
        </DialogContent>}
      </Dialog>
    </section>
  );
}

function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div>
        {eyebrow && <p className="mono mb-2 text-[10px] uppercase tracking-[.18em] text-muted-foreground">{eyebrow}</p>}
        <h1 className="display text-4xl md:text-5xl">{title}</h1>
        {description && <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-primary/30 bg-primary/10 p-5">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs text-primary-foreground/70">{text}</p>
    </div>
  );
}

function CheckInPage() {
  const { checkIns, saveCheckIn, updateCheckIn, deleteCheckIn, toast } = useApp();
  const latest = checkIns[0];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CheckIn | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [form, setForm] = useState({
    fatigue: 5,
    stress: 5,
    soreness: 5,
    illness: latest?.illness ?? "None",
    readiness: 5,
    sleepQuality: 5,
    note: "",
  });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const editingCheckIn = checkIns.find((item) => item.id === editingId);
  const clearEditing = () => {
    setEditingId(null);
    setForm({ fatigue: 5, stress: 5, soreness: 5, illness: latest?.illness ?? "None", readiness: 5, sleepQuality: 5, note: "" });
  };
  const beginEditing = (checkIn: CheckIn) => {
    setEditingId(checkIn.id);
    setForm({
      fatigue: checkIn.fatigue,
      stress: checkIn.stress,
      soreness: checkIn.soreness,
      illness: checkIn.illness,
      readiness: checkIn.readiness,
      sleepQuality: checkIn.sleepQuality ?? 5,
      note: checkIn.note,
    });
  };
  useEffect(() => {
    if (!editingId) return;
    const frame = window.requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      formRef.current?.querySelector<HTMLInputElement>('input[type="range"]')?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingId]);
  const removeCheckIn = (checkIn: CheckIn) => setDeleteTarget(checkIn);
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeletingId(target.id);
    try {
      await deleteCheckIn(target.id);
      if (editingId === target.id) clearEditing();
      setDeleteTarget(null);
      toast("Check-in deleted.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not delete the check-in.");
    } finally {
      setDeletingId(null);
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        if (!editingCheckIn) throw new Error("This check-in is no longer available. Refresh the page and try again.");
        await updateCheckIn(editingId, { ...form, timestamp: editingCheckIn.timestamp });
        clearEditing();
        toast("Check-in updated.");
      } else {
        await saveCheckIn({ ...form, timestamp: iso(today) });
        setSaved(true);
        toast("Check-in saved. Thanks for the honest signal.");
        setTimeout(() => setSaved(false), 2500);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : editingId ? "Could not update your check-in." : "Could not save your check-in.");
    } finally {
      setSaving(false);
    }
  };
  const sliderVisualValue = (value: number) => value === 1 || value === 10 ? value : value + 0.5;
  const sliderRatingFromVisual = (value: number) => value <= 1 ? 1 : value >= 10 ? 10 : Math.max(1, Math.min(10, Math.round(value - 0.5)));
  const scale = (
    key: "fatigue" | "stress" | "soreness" | "readiness",
    label: string,
    low: string,
    high: string,
  ) => (
    <div>
      <div className="mb-2 flex items-end justify-between">
        <label className="text-sm font-semibold">{label}</label>
        <span className="display text-2xl text-accent">
          {form[key]}
          <span className="text-sm text-muted-foreground">/10</span>
        </span>
      </div>
      <input
        data-testid={`input-${key}`}
        type="range"
        min="1"
        max="10"
        step="0.5"
        value={sliderVisualValue(form[key])}
        aria-valuetext={`${form[key]} out of 10`}
        onChange={(e) => setForm({ ...form, [key]: sliderRatingFromVisual(Number(e.target.value)) })}
        className="h-2 w-full cursor-pointer accent-[hsl(var(--accent))]"
      />
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
  return (
    <div className="space-y-4 pt-2">
      <PageHeader
        eyebrow="Daily feedback"
        title="Check in with yourself"
      />
      <div className="grid gap-8 lg:grid-cols-[1.1fr_.9fr]">
        <form
          ref={formRef}
          onSubmit={submit}
          className="rounded-3xl border border-border bg-card p-5 shadow-sm md:p-6"
        >
          <div className="mb-5 flex items-start justify-between border-b border-border pb-4">
            <div>
              <p className="text-sm font-bold">{editingCheckIn ? `Editing check-in · ${prettyDate(editingCheckIn.timestamp)}` : "How is your system today?"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                There is no right answer. Notice, then record.
              </p>
            </div>
          </div>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {scale("fatigue", "Fatigue", "Fresh", "Drained")}
            {scale("stress", "Life stress", "Light", "Heavy")}
            {scale("soreness", "Muscle soreness", "None", "Significant")}
            {scale(
              "readiness",
              "Readiness to train",
              "Not ready",
              "Ready to go",
            )}
          </div>
          <div className="mt-5">
            <div className="mb-2 flex items-end justify-between">
              <label htmlFor="sleepQuality" className="text-sm font-semibold">Sleep quality</label>
              <span className="display text-2xl text-accent">{form.sleepQuality}<span className="text-sm text-muted-foreground">/10</span></span>
            </div>
            <p className="mb-1.5 text-[11px] leading-relaxed text-muted-foreground">Think about how you felt when you woke up and how that feeling changed as the day progressed.</p>
            <input
              id="sleepQuality"
              type="range"
              min="1"
              max="10"
              step="0.5"
              value={sliderVisualValue(form.sleepQuality)}
              aria-valuetext={`${form.sleepQuality} out of 10`}
              onChange={(e) => setForm({ ...form, sleepQuality: sliderRatingFromVisual(Number(e.target.value)) })}
              data-testid="input-sleep-quality"
              className="h-2 w-full cursor-pointer accent-[hsl(var(--accent))]"
            />
            <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground"><span>Poor</span><span>Restorative</span></div>
          </div>
          <div className="mt-5">
            <label htmlFor="illness" className="text-sm font-semibold">
              Any discomfort?
            </label>
            <select
              id="illness"
              value={form.illness}
              onChange={(e) => setForm({ ...form, illness: e.target.value })}
              data-testid="select-illness"
              className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent"
            >
              <option>None</option>
              <option>Something feels off</option>
              <option>Cold or flu symptoms</option>
              <option>Injury concern</option>
              <option>Other</option>
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">If you choose Other, add details in the context box below.</p>
          </div>
          <div className="mt-4">
            <label htmlFor="note" className="text-sm font-semibold">
              A little more context{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <textarea
              id="note"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              data-testid="input-check-in-note"
              rows={3}
              placeholder="Sleep, life load, what you noticed on the last session…"
              className="mt-2 w-full resize-none rounded-lg border border-input bg-background p-3 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-accent"
            />
          </div>
          <div className="mt-4 flex items-center justify-end gap-3">
            <div className="flex items-center gap-2">
              {editingId && <Button type="button" onClick={clearEditing} variant="ghost" disabled={saving}>Cancel</Button>}
              <Button type="submit" disabled={saving} testId="button-save-check-in">
                <Save size={16} /> {saving ? "Saving…" : editingId ? "Update check-in" : saved ? "Saved" : "Save check-in"}
              </Button>
            </div>
          </div>
        </form>
        <section className="rounded-2xl border border-border bg-card p-5" aria-labelledby="check-in-history-title">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2"><History size={16} className="text-accent" /><h2 id="check-in-history-title" className="text-sm font-bold">Note history</h2></div>
            <Badge tone="neutral">{checkIns.length} saved</Badge>
          </div>
          <div className="max-h-[75vh] space-y-3 overflow-y-auto pr-1">
            {checkIns.length > 0 ? checkIns.map((c) => (
              <article key={c.id} className="rounded-xl bg-secondary/45 p-3">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/70 pb-2">
                  <time dateTime={c.timestamp} className="text-xs font-semibold">{prettyDate(c.timestamp)}</time>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => beginEditing(c)} className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground transition hover:text-foreground" aria-label={`Edit check-in from ${prettyDate(c.timestamp)}`}><Pencil size={12} /> Edit</button>
                    <button type="button" onClick={() => void removeCheckIn(c)} disabled={deletingId !== null} className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 transition hover:text-red-900 disabled:opacity-50" aria-label={`Delete check-in from ${prettyDate(c.timestamp)}`}><Trash2 size={12} /> {deletingId === c.id ? "Deleting…" : "Delete"}</button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] sm:grid-cols-3">
                  <div><p className="text-muted-foreground">Readiness</p><p>{c.readiness}/10</p></div>
                  <div><p className="text-muted-foreground">Fatigue</p><p>{c.fatigue}/10</p></div>
                  <div><p className="text-muted-foreground">Stress</p><p>{c.stress}/10</p></div>
                  <div><p className="text-muted-foreground">Soreness</p><p>{c.soreness}/10</p></div>
                  <div><p className="text-muted-foreground">Sleep quality</p><p>{c.sleepQuality === null ? "Not recorded" : `${c.sleepQuality}/10`}</p></div>
                  <div><p className="text-muted-foreground">Discomfort</p><p>{c.illness || "None"}</p></div>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{c.note || "No note added."}</p>
              </article>
            )) : <p className="rounded-xl bg-secondary/45 p-4 text-xs text-muted-foreground">No check-ins saved yet. Your saved notes and ratings will appear here.</p>}
          </div>
        </section>
      </div>
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && deletingId === null) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this check-in?</DialogTitle>
            <DialogDescription>
              {deleteTarget && <>Delete the check-in from {prettyDate(deleteTarget.timestamp)}? This can’t be undone. Any linked recommendations will remain but lose their check-in link.</>}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={deletingId !== null} onClick={() => setDeleteTarget(null)}>No, keep it</Button>
            <Button type="button" variant="danger" disabled={deletingId !== null} onClick={() => void confirmDelete()}>{deletingId ? "Deleting…" : "Yes, delete"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RecommendationsPage() {
  const { athlete, sessions, wellness, connection, recommendations, updateRecommendation, confirmWorkout, applyRecommendation, undoRecommendation, toast } = useApp();
  const [saving, setSaving] = useState(false);
  const recentPastDates = Array.from({ length: 7 }, (_, index) => shift(index - 7));
  const performanceInsights = connection.configured && !connection.error ? comparablePerformanceInsights(sessions, wellness) : [];
  const plannedForReview = connection.configured && !connection.error
    ? withWorkoutConfirmations(athlete.preferences.plan, [...sessions, ...planSessionsForDates(athlete, recentPastDates, sessions)])
      .filter((session) => recentPastDates.includes(session.date) && session.status === "planned" && ["swim", "bike", "run"].includes(session.sport))
    : [];
  const decide = async (id: string, status: RecommendationStatus) => {
    setSaving(true);
    try {
      if (status === "approved") await applyRecommendation(id);
      else await updateRecommendation(id, { status });
      const appliesPlanChange = recommendations.find((item) => item.id === id)?.proposedChanges.some((change) => change.field === "workoutOverride");
      toast(status === "approved" ? appliesPlanChange ? "Plan change applied." : "Recommendation accepted." : "Recommendation dismissed.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not update recommendation.");
    } finally {
      setSaving(false);
    }
  };
  const proposed = recommendations.filter((r) => r.status === "pending" || r.status === "edited");
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Coach’s desk" title="Recommendations to review" />
      {performanceInsights.length > 0 && <section className="rounded-2xl border border-border bg-card p-4 md:p-5" aria-labelledby="performance-pattern-title">
        <div><h2 id="performance-pattern-title" className="text-sm font-bold">Comparable session patterns</h2><p className="mt-1 text-xs text-muted-foreground">We compare the same workout type at similar durations, times and conditions. Sleep or HRV patterns appear only with at least three sessions in each group; observations don’t prove cause or change your plan.</p></div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {performanceInsights.map((insight) => <article key={insight.id} className="rounded-xl bg-secondary/35 p-3"><p className="text-xs font-semibold capitalize">{insight.headline}</p><p className="mt-1 text-sm">{insight.detail}</p><p className="mt-1 text-[10px] text-muted-foreground">Compared with {insight.matchedCount} similar workouts</p></article>)}
        </div>
      </section>}
      {plannedForReview.length > 0 && <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 md:p-5" aria-labelledby="workout-check-title">
        <div className="max-w-3xl">
          <h2 id="workout-check-title" className="text-sm font-bold">Workout check</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">No matching activities have appeared in Intervals.icu for these recent workouts yet. Syncs can be delayed or an activity may not have been recorded, so we’ll check with you before considering changes. Your answer won’t change the plan automatically.</p>
        </div>
        <div className="mt-4 divide-y divide-amber-200/70">
          {plannedForReview.map((session) => <div key={session.id} className="flex flex-col justify-between gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center" data-testid={`workout-confirmation-${session.id}`}>
            <div><p className="text-sm">Did you complete <span className="font-semibold">{session.title}</span>?</p><p className="mt-0.5 text-xs text-muted-foreground">{prettyDate(session.date)} · {sportMeta[session.sport].label} · {session.duration}</p></div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={saving} testId={`button-workout-completed-${session.id}`} onClick={async () => { setSaving(true); try { await confirmWorkout(session.id, session.date, "completed"); toast("Workout marked complete."); } catch (error) { toast(error instanceof Error ? error.message : "Could not save your answer."); } finally { setSaving(false); } }}><Check size={14} /> I completed it</Button>
              <Button variant="secondary" disabled={saving} testId={`button-workout-skipped-${session.id}`} onClick={async () => { setSaving(true); try { await confirmWorkout(session.id, session.date, "skipped"); toast("Workout marked skipped. Your plan hasn’t changed."); } catch (error) { toast(error instanceof Error ? error.message : "Could not save your answer."); } finally { setSaving(false); } }}><X size={14} /> I skipped it</Button>
            </div>
          </div>)}
        </div>
      </section>}
      {proposed.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border bg-card p-14 text-center">
          <CheckCircle2 size={32} className="mx-auto text-emerald-600" />
          <h2 className="display mt-4 text-2xl">{plannedForReview.length > 0 ? "No other recommendations right now." : "You’re all caught up."}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{plannedForReview.length > 0 ? "Confirm the workouts above to keep your training history accurate." : "No recommendations have been added yet."}</p>
        </div>
      ) : (
        <div className="grid gap-5">
          {proposed.map((r, index) => (
            <div
              key={r.id}
              className={`fade-up delay-${index + 1} rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8`}
              data-testid={`card-recommendation-${r.id}`}
            >
              <div className="flex flex-col justify-between gap-4 md:flex-row">
                <div className="flex gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><Sparkles size={17} /></span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={r.status === "edited" ? "blue" : "amber"}>{r.status === "edited" ? "Edited" : "For your review"}</Badge>
                    </div>
                    <h2 className="display mt-4 max-w-2xl text-2xl">{r.proposedChange}</h2>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                    <Button
                      onClick={() => void decide(r.id, "approved")}
                      disabled={saving}
                      testId={`button-approve-${r.id}`}
                    >
                      <Check size={14} /> {r.proposedChanges.some((change) => change.field === "workoutOverride") ? "Apply change" : "Accept"}
                    </Button>
                    <IconButton
                      label={`dismiss recommendation ${r.id}`}
                      onClick={() => void decide(r.id, "dismissed")}
                  >
                    <X size={17} />
                  </IconButton>
                </div>
              </div>
              <div className="mt-7 grid gap-5 border-t border-border pt-5 md:grid-cols-2">
                <div>
                  <p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                      Athlete context
                  </p>
                  <p className="mt-2 text-sm leading-relaxed">{r.evidence}</p>
                </div>
                <div>
                  <p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                    Why this might help
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {r.rationale}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <section>
        <SectionTitle eyebrow="Change history" title="What moved, and why" />
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          {recommendations.filter((recommendation) => recommendation.status === "approved").map((recommendation) => (
            <div key={recommendation.id} className="relative border-l border-accent/40 pb-6 pl-5 last:pb-1">
              <span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-accent" />
              <p className="text-sm font-semibold">{recommendation.proposedChange}</p>
              <p className="mt-1 text-xs text-muted-foreground">{recommendation.trigger}</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="mono text-[10px] uppercase tracking-wider text-muted-foreground">{recommendation.date} · {recommendation.proposedChanges.some((change) => change.field === "workoutOverride") ? "Applied" : "Accepted"}</p>
                {recommendation.proposedChanges.some((change) => change.field === "workoutOverride") && <Button variant="secondary" disabled={saving} onClick={async () => {
                  setSaving(true);
                  try { await undoRecommendation(recommendation.id); toast("Plan change undone."); }
                  catch (error) { toast(error instanceof Error ? error.message : "Could not undo the plan change."); }
                  finally { setSaving(false); }
                }}><ArrowLeft size={14} /> Undo</Button>}
              </div>
            </div>
          ))}
          {!recommendations.some((recommendation) => recommendation.status === "approved") && <p className="py-2 text-sm text-muted-foreground">No approved recommendations yet.</p>}
        </div>
      </section>
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-secondary/45 p-4">
        <ShieldCheck
          size={17}
          className="mt-0.5 shrink-0 text-muted-foreground"
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Suggestions are optional and explain which signals informed them.</strong>{" "}
          Accepted recovery changes update this app’s plan for the selected date and can be undone. Intervals.icu remains read-only; performance and environment correlations are not included yet.
        </p>
      </div>
    </div>
  );
}

function distanceTargetsForUnits(plan: PlanPreferences, units: UnitSystem): PlanPreferences["distanceTargets"] {
  const factorToMeters: Record<string, number> = { m: 1, km: 1000, yd: 0.9144, mi: 1609.344 };
  const targetUnits = {
    swim: units === "metric" ? "m" : "yd",
    bike: units === "metric" ? "km" : "mi",
    run: units === "metric" ? "km" : "mi",
  } as const;
  return Object.fromEntries((Object.keys(targetUnits) as Array<keyof typeof targetUnits>).map((sport) => {
    const target = plan.distanceTargets[sport];
    const unit = targetUnits[sport];
    const convert = (value: number | null) => {
      if (value === null || target.unit === unit) return value;
      const converted = value * factorToMeters[target.unit] / factorToMeters[unit];
      return Number(converted.toFixed(unit === "m" || unit === "yd" ? 0 : 1));
    };
    return [sport, { ...target, weekly: convert(target.weekly), peak: convert(target.peak), unit }];
  })) as PlanPreferences["distanceTargets"];
}

function timeBasedPlan(plan: PlanPreferences): PlanPreferences {
  if (plan.volumeBasis !== "distance") return { ...plan, volumeBasis: "time" };
  const sports = ["swim", "bike", "run"] as const;
  const timeTargets = Object.fromEntries(sports.map((sport) => {
    const existing = plan.timeTargets[sport];
    const scheduledMinutes = plan.manualSessions
      .filter((session) => session.sport === sport)
      .reduce((total, session) => {
        const minutes = session.durationMinutes ?? Number(session.duration.match(/[\d.]+/)?.[0]);
        return total + (Number.isFinite(minutes) ? minutes : 0);
      }, 0);
    const weekly = existing.weekly ?? (scheduledMinutes > 0 ? Number((scheduledMinutes / 60).toFixed(1)) : null);
    const distanceTarget = plan.distanceTargets[sport];
    const distanceRatio = distanceTarget.weekly && distanceTarget.peak
      ? distanceTarget.peak / distanceTarget.weekly
      : 1;
    const peak = existing.peak === null ? null : weekly === null ? null : plan.goalMode === "race" ? Number((weekly * distanceRatio).toFixed(1)) : weekly;
    return [sport, { weekly, peak }];
  })) as PlanPreferences["timeTargets"];
  return { ...plan, volumeBasis: "time", timeTargets };
}

function CapacityWarning({ warnings, volumeBasis }: { warnings: string[]; volumeBasis: PlanPreferences["volumeBasis"] }) {
  const [present, setPresent] = useState(warnings.length > 0);
  const [leaving, setLeaving] = useState(false);
  const hasWarnings = warnings.length > 0;

  useEffect(() => {
    if (hasWarnings) {
      setPresent(true);
      setLeaving(false);
      return;
    }
    if (!present) return;
    setLeaving(true);
    const timeout = window.setTimeout(() => setPresent(false), 340);
    return () => window.clearTimeout(timeout);
  }, [hasWarnings, present]);

  if (!present) return null;
  return <div className={`capacity-warning-shell${leaving ? " is-leaving" : ""}`} aria-hidden={leaving || undefined}>
    <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-semibold">{volumeBasis === "distance" ? "Estimated time may exceed your session limits" : "Targets exceed current schedule capacity"}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      <p className="mt-2 text-xs">{volumeBasis === "distance" ? "Estimates use typical speeds when recent pace data is unavailable. Adjust targets or session lengths if needed; this won’t block saving." : "Extend a session if it fits your time limit, add a session, or lower the target."}</p>
    </div>
  </div>;
}

function PlanGoalEditor({ forceSetup = false, onSaved, onCancel }: { forceSetup?: boolean; onSaved?: () => void; onCancel?: () => void }) {
  const { athlete, sessions, wellness, connection, saveAthlete, toast } = useApp();
  const initialDraft = readPlanBuilderDraft(athlete.id);
  const [form, setForm] = useState<Athlete>(() => {
    const initial = initialDraft?.form ?? athlete;
    const freshPlan = forceSetup && !athlete.preferences.plan.generatedAt;
    const clearInherited = (field: "event" | "distance" | "raceDate" | "raceTime") => freshPlan && (!initialDraft || initial[field] === athlete[field]);
    return {
      ...initial,
      event: clearInherited("event") || initial.event === "Race goal" ? "" : initial.event,
      distance: clearInherited("distance") ? "" : initial.distance,
      raceDate: clearInherited("raceDate") ? "" : initial.raceDate,
      raceTime: clearInherited("raceTime") ? "" : initial.raceTime,
      preferences: { ...initial.preferences, units: athlete.preferences.units, plan: { ...timeBasedPlan(initial.preferences.plan), workoutDisplay: "both", distanceTargets: distanceTargetsForUnits(initial.preferences.plan, athlete.preferences.units) } },
    };
  });
  const [maxSessionMinutesInput, setMaxSessionMinutesInput] = useState(() => initialDraft?.maxSessionMinutesInput ?? String(athlete.preferences.plan.maxSessionMinutes ?? 0));
  const initialIntensityPlan = initialDraft?.form.preferences.plan ?? athlete.preferences.plan;
  const [easyPaceInput, setEasyPaceInput] = useState(() => initialIntensityPlan.easyRunPaceSecondsPerKm
    ? formatRunPace(initialIntensityPlan.easyRunPaceSecondsPerKm, distanceTargetsForUnits(initialIntensityPlan, athlete.preferences.units).run.unit).replace(/\/(?:mi|km)$/, "")
    : "");
  const [ftpInput, setFtpInput] = useState(() => initialIntensityPlan.ftpWatts ? String(initialIntensityPlan.ftpWatts) : "");
  const [maxHeartRateInput, setMaxHeartRateInput] = useState(() => initialIntensityPlan.maxHeartRate ? String(initialIntensityPlan.maxHeartRate) : "");
  const initialHeartRateDefaults = initialIntensityPlan.maxHeartRate ? heartRateZoneUpperBoundsFromMax(initialIntensityPlan.maxHeartRate).map(String) : Array(5).fill("");
  const [zoneUpperBoundInputs, setZoneUpperBoundInputs] = useState(() => ({
    run: (initialIntensityPlan.heartRateZoneUpperBounds?.run ?? initialHeartRateDefaults).map(String),
    bike: (initialIntensityPlan.heartRateZoneUpperBounds?.bike ?? initialHeartRateDefaults).map(String),
  }));
  const [importingMaxHeartRate, setImportingMaxHeartRate] = useState(false);
  const [step, setStep] = useState<"setup" | "week-builder" | "schedule" | "refinements" | "review" | "generated">(() => initialDraft?.step ?? (forceSetup ? "setup" : athlete.preferences.plan.generatedAt ? "generated" : "setup"));
  const [saving, setSaving] = useState(false);
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
  const plan = form.preferences.plan;
  const easyPaceUnit: RunPaceUnit = plan.distanceTargets.run.unit;
  const parsedEasyPace = easyPaceInput.trim() ? paceSecondsPerKmFromInput(easyPaceInput, easyPaceUnit) : null;
  const displayedTrainingPaces = getRunTrainingPaces(parsedEasyPace, easyPaceUnit);
  const parsedBikeFtp = ftpInput.trim() && Number.isInteger(Number(ftpInput)) && Number(ftpInput) >= 50 && Number(ftpInput) <= 1000 ? Number(ftpInput) : null;
  const displayedBikePowerZones = getBikeTrainingPowerZones(parsedBikeFtp);
  const parsedMaxHeartRate = maxHeartRateInput.trim() ? Number(maxHeartRateInput) : null;
  const validHeartRateBounds = (values: string[]) => {
    const bounds = values.map((value) => Number(value));
    return values.length >= 3 && values.length <= 10 && values.every((value) => value.trim() && Number.isInteger(Number(value)) && Number(value) >= 30 && Number(value) <= 240)
      && bounds.every((value, index) => index === 0 || value > bounds[index - 1]) ? bounds : null;
  };
  const displayedHeartRateZones = parsedMaxHeartRate && Number.isInteger(parsedMaxHeartRate) && parsedMaxHeartRate >= 80 && parsedMaxHeartRate <= 240
    ? heartRateZonesFromMax(parsedMaxHeartRate, validHeartRateBounds(zoneUpperBoundInputs.run))
    : [];
  const detectedBikeFtp = [...wellness].sort((left, right) => right.id.localeCompare(left.id))
    .flatMap((record) => record.sportInfo ?? [])
    .find((sport) => ["Ride", "VirtualRide"].includes(sport.type ?? "") && finite(sport.eftp) && sport.eftp > 0)?.eftp;
  const generatedWorkouts = useMemo(() => generateWeeklyWorkouts(plan, sessions), [plan, sessions]);
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const updatePlan = (patch: Partial<PlanPreferences>) => setForm({
    ...form,
    preferences: { ...form.preferences, plan: { ...plan, ...patch } },
  });
  useEffect(() => {
    const draft = forceSetup ? readPlanBuilderDraft(athlete.id) : null;
    const syncIntensityInputs = (sourcePlan: PlanPreferences) => {
      const displayPlan = { ...sourcePlan, distanceTargets: distanceTargetsForUnits(sourcePlan, athlete.preferences.units) };
      setEasyPaceInput(displayPlan.easyRunPaceSecondsPerKm
        ? formatRunPace(displayPlan.easyRunPaceSecondsPerKm, displayPlan.distanceTargets.run.unit).replace(/\/(?:mi|km)$/, "")
        : "");
      setFtpInput(sourcePlan.ftpWatts ? String(sourcePlan.ftpWatts) : "");
      setMaxHeartRateInput(sourcePlan.maxHeartRate ? String(sourcePlan.maxHeartRate) : "");
      const defaults = sourcePlan.maxHeartRate ? heartRateZoneUpperBoundsFromMax(sourcePlan.maxHeartRate).map(String) : Array(5).fill("");
      setZoneUpperBoundInputs({
        run: (sourcePlan.heartRateZoneUpperBounds?.run ?? defaults).map(String),
        bike: (sourcePlan.heartRateZoneUpperBounds?.bike ?? defaults).map(String),
      });
    };
    if (draft) {
      const freshPlan = forceSetup && !athlete.preferences.plan.generatedAt;
      const draftForm: Athlete = {
        ...draft.form,
        event: freshPlan && (draft.form.event === athlete.event || draft.form.event === "Race goal") ? "" : draft.form.event,
        distance: freshPlan && draft.form.distance === athlete.distance ? "" : draft.form.distance,
        raceDate: freshPlan && draft.form.raceDate === athlete.raceDate ? "" : draft.form.raceDate,
        raceTime: freshPlan && draft.form.raceTime === athlete.raceTime ? "" : draft.form.raceTime,
      };
      const draftPlan = timeBasedPlan(draftForm.preferences.plan);
      const hasStackedSport = draftPlan.manualSessions.some((session) => {
        const sameDay = draftPlan.manualSessions.filter((item) => item.day === session.day);
        return sameDay.length > 2 || sameDay.some((item) => item.id !== session.id && item.sport === session.sport);
      });
      const planForBuilder = draft.step !== "setup" && hasStackedSport
        ? { ...draftPlan, manualSessions: buildInitialWeeklySchedule(draftPlan) }
        : draftPlan;
      setForm({ ...draftForm, preferences: { ...draftForm.preferences, units: athlete.preferences.units, plan: { ...planForBuilder, workoutDisplay: "both", distanceTargets: distanceTargetsForUnits(draftForm.preferences.plan, athlete.preferences.units) } } });
      setMaxSessionMinutesInput(draft.maxSessionMinutesInput);
      syncIntensityInputs(draftForm.preferences.plan);
      setStep(draft.step);
      return;
    }
    const freshPlanForm = forceSetup && !athlete.preferences.plan.generatedAt
      ? { ...athlete, event: "", distance: "", raceDate: "", raceTime: "" }
      : athlete;
    setForm({ ...freshPlanForm, preferences: { ...athlete.preferences, plan: { ...timeBasedPlan(athlete.preferences.plan), workoutDisplay: "both", distanceTargets: distanceTargetsForUnits(athlete.preferences.plan, athlete.preferences.units) } } });
    setMaxSessionMinutesInput(String(athlete.preferences.plan.maxSessionMinutes ?? 0));
    syncIntensityInputs(athlete.preferences.plan);
    setStep(forceSetup ? "setup" : athlete.preferences.plan.generatedAt ? "generated" : "setup");
  }, [athlete, forceSetup]);

  useEffect(() => {
    if (step === "generated") {
      clearPlanBuilderDraft(athlete.id);
      return;
    }
    writePlanBuilderDraft({ version: 10, athleteId: athlete.id, form, maxSessionMinutesInput, step });
  }, [athlete.id, form, maxSessionMinutesInput, step]);

  const todayForRaceDate = new Date();
  todayForRaceDate.setMinutes(todayForRaceDate.getMinutes() - todayForRaceDate.getTimezoneOffset());
  const todayIsoDate = todayForRaceDate.toISOString().slice(0, 10);
  const raceLeadDays = form.raceDate
    ? Math.floor((Date.parse(`${form.raceDate}T12:00:00Z`) - Date.parse(`${todayIsoDate}T12:00:00Z`)) / 86_400_000)
    : null;
  const weeksToRace = raceLeadDays === null ? null : Math.max(0, Math.ceil(raceLeadDays / 7));
  const raceDistanceLabel = form.distance === "Ironman" ? "Full Ironman" : "Half Ironman (70.3)";
  const triathlonExperience = plan.triathlonExperience;
  const preparationWeeksByExperience = {
    beginner: form.distance === "Ironman" ? 24 : 20,
    intermediate: form.distance === "Ironman" ? 16 : 16,
    advanced: form.distance === "Ironman" ? 12 : 12,
  };
  const recommendedRacePreparationWeeks = triathlonExperience ? preparationWeeksByExperience[triathlonExperience] : null;
  const raceTimelineWarning = plan.goalMode === "race" && form.distance && raceLeadDays !== null && raceLeadDays >= 0 && weeksToRace !== null && recommendedRacePreparationWeeks !== null && raceLeadDays < recommendedRacePreparationWeeks * 7
    ? `About ${weeksToRace} weeks remain, shorter than the ${recommendedRacePreparationWeeks}-week preparation window for your selected experience level and ${raceDistanceLabel}. Compare your current longest rides and runs with race demands; if you are not already close, choose a later event.`
    : null;

  const personalValidationMessage = () => {
    if (!plan.triathlonExperience) return "Choose your triathlon experience to set a suitable race-preparation window.";
    if (plan.goalMode === "race" && !form.distance) return "Choose a race distance before building the plan.";
    if (plan.goalMode === "race" && !form.raceDate) return "Add a race date before building the plan.";
    if (plan.goalMode === "race" && form.raceDate && form.raceDate < todayIsoDate) return "That race date has passed. Choose a future date before building the plan.";
    return null;
  };

  const validationMessage = (includeSchedule = true, includeIntensity = true) => {
    if (!plan.triathlonExperience) return "Choose your triathlon experience to set a suitable race-preparation window.";
    if (plan.goalMode === "race" && !form.distance) return "Choose a race distance before building the plan.";
    if (plan.goalMode === "race" && !form.raceDate) return "Add a race date before building the plan.";
    if (plan.goalMode === "race" && form.raceDate && form.raceDate < todayIsoDate) return "That race date has passed. Choose a future date before building the plan.";
    for (const sport of ["swim", "bike", "run"] as const) {
      const targets = plan.volumeBasis === "time" ? plan.timeTargets[sport] : plan.distanceTargets[sport];
      const measure = plan.volumeBasis === "time" ? "hours" : "distance";
      if (targets.weekly === null || targets.weekly <= 0) return `Enter a current weekly ${sport} ${measure} target above zero.`;
      if (plan.goalMode === "race" && targets.peak !== null && targets.peak < targets.weekly) return `Peak weekly ${sport} ${measure} must be at least its current target.`;
    }
    if (plan.recoveryRhythm !== "none" && plan.recoveryRhythm !== "manual" && (plan.weeklyBuildRate === null || plan.weeklyBuildRate < 0 || plan.weeklyBuildRate > 10)) return "Enter a build rate between 0% and 10% per build week.";
    if (plan.recoveryRhythm !== "none" && plan.recoveryRhythm !== "manual" && (!Number.isFinite(plan.recoveryWeekPercent ?? 75) || (plan.recoveryWeekPercent ?? 75) < 50 || (plan.recoveryWeekPercent ?? 75) > 100)) return "Set recovery-week volume between 50% and 100% of build-week volume.";
    if (plan.recoveryRhythm === "custom" && (!Number.isInteger(plan.customBuildWeeks) || (plan.customBuildWeeks ?? 0) < 1 || (plan.customBuildWeeks ?? 0) > 12)) return "Choose between 1 and 12 build weeks before recovery.";
    if (!maxSessionMinutesInput.trim() || !Number.isFinite(Number(maxSessionMinutesInput)) || Number(maxSessionMinutesInput) < 15 || Number(maxSessionMinutesInput) > 600) return "Enter a workout time limit between 15 and 600 minutes.";
    if (includeIntensity) {
      if (easyPaceInput.trim() && parsedEasyPace === null) return `Enter an easy pace as minutes:seconds per ${easyPaceUnit}, from 2:00 to 30:00.`;
      if (ftpInput.trim() && (!Number.isInteger(Number(ftpInput)) || Number(ftpInput) < 50 || Number(ftpInput) > 1000)) return "Enter a cycling FTP between 50 and 1,000 watts.";
      if (maxHeartRateInput.trim() && (!Number.isInteger(Number(maxHeartRateInput)) || Number(maxHeartRateInput) < 80 || Number(maxHeartRateInput) > 240)) return "Enter a maximum heart rate between 80 and 240 bpm.";
      if (maxHeartRateInput.trim() && (["run", "bike"] as const).some((sport) => !validHeartRateBounds(zoneUpperBoundInputs[sport]))) return "Set at least three increasing upper heart-rate zone limits for both running and cycling.";
    }
    if (!Number.isInteger(plan.sessionsPerWeek) || plan.sessionsPerWeek < 3 || plan.sessionsPerWeek > 14) return "Choose between 3 and 14 weekly training sessions.";
    if (!Number.isInteger(plan.restDaysPerWeek) || plan.restDaysPerWeek < 0 || plan.restDaysPerWeek > 4) return "Choose between 0 and 4 weekly rest days.";
    if (plan.restDays.length !== plan.restDaysPerWeek) return "Match your selected rest-day count to the rest days in your schedule.";
    const dayCapacity = (7 - plan.restDays.length) * 2;
    if (plan.sessionsPerWeek > dayCapacity) return `With ${plan.restDays.length} rest days, the week can fit up to ${dayCapacity} sessions at two per day. Reduce sessions or rest days.`;
    if (includeSchedule) {
      if (plan.manualSessions.length === 0) return "Add the sessions you want in your typical week.";
      if (plan.manualSessions.length > dayCapacity || plan.manualSessions.some((session) => plan.manualSessions.filter((item) => item.day === session.day).length > 2)) return "Keep the schedule to two workouts per day or fewer.";
      for (const sport of ["swim", "bike", "run"] as const) {
        if (!plan.manualSessions.some((session) => session.sport === sport)) return `Add at least one ${sport} session to your triathlon week.`;
      }
      if (plan.primaryFocus === "balanced") {
        const bikeSessions = plan.manualSessions.filter((session) => session.sport === "bike").length;
        const runSessions = plan.manualSessions.filter((session) => session.sport === "run").length;
        if (runSessions > bikeSessions) return "A balanced week needs at least as many bike sessions as run sessions.";
      } else if (plan.primaryFocus === "run") {
        const bikeSessions = plan.manualSessions.filter((session) => session.sport === "bike").length;
        const runSessions = plan.manualSessions.filter((session) => session.sport === "run").length;
        if (runSessions < bikeSessions) return "A run-focused week needs at least as many run sessions as bike sessions.";
      }
      const qualityDays = generatedWorkouts.sessions.filter((session) => session.quality).map((session) => weekdays.indexOf(session.day));
      if (qualityDays.some((day, index) => qualityDays.slice(index + 1).some((otherDay) => Math.min(Math.abs(day - otherDay), weekdays.length - Math.abs(day - otherDay)) <= 1))) {
        return "Keep at least one full recovery day between interval workouts. Change rest days or move weekday sessions to make room.";
      }
      if (generatedWorkouts.capacityWarnings.length > 0 && plan.volumeBasis === "time") return "Adjust your weekly targets or schedule so each sport fits the available session time.";
    }
    return null;
  };

  const importMaxHeartRate = async () => {
    setImportingMaxHeartRate(true);
    try {
      const settings = await dataApi.intervalsAthleteSettings();
      const maxHeartRate = settings.maxHeartRate ?? settings.run?.maxHeartRate ?? settings.bike?.maxHeartRate;
      if (!maxHeartRate && !settings.run?.zones && !settings.bike?.zones) {
        toast("Intervals.icu did not return a max heart rate or sport zones. Check your Intervals.icu sport settings.");
        return;
      }
      const nextMax = maxHeartRate ? Math.round(maxHeartRate) : parsedMaxHeartRate;
      const defaults = nextMax ? heartRateZoneUpperBoundsFromMax(nextMax) : [];
      const normalizeZones = (zones: number[] | null | undefined, existing: string[]) => {
        const imported = zones && zones.length >= 3 && zones.length <= 10
          && zones.every((value, index) => Number.isInteger(value) && value >= 30 && value <= 240 && (index === 0 || value > zones[index - 1]))
          ? zones
          : null;
        return (imported ?? (validHeartRateBounds(existing) ? existing.map(Number) : defaults)).map(String);
      };
      const nextBounds = {
        run: normalizeZones(settings.run?.zones, zoneUpperBoundInputs.run),
        bike: normalizeZones(settings.bike?.zones, zoneUpperBoundInputs.bike),
      };
      const nextZoneNames = {
        run: settings.run?.zoneNames?.length === nextBounds.run.length ? settings.run.zoneNames : plan.heartRateZoneNames?.run,
        bike: settings.bike?.zoneNames?.length === nextBounds.bike.length ? settings.bike.zoneNames : plan.heartRateZoneNames?.bike,
      };
      if (nextMax) setMaxHeartRateInput(String(nextMax));
      setZoneUpperBoundInputs(nextBounds);
      updatePlan({
        ...(nextMax ? { maxHeartRate: nextMax } : {}),
        heartRateZoneUpperBounds: {
          ...plan.heartRateZoneUpperBounds,
          ...(validHeartRateBounds(nextBounds.run) ? { run: nextBounds.run.map(Number) } : {}),
          ...(validHeartRateBounds(nextBounds.bike) ? { bike: nextBounds.bike.map(Number) } : {}),
        },
        heartRateZoneNames: nextZoneNames,
      });
      const hasRunZones = Boolean(settings.run?.zones && settings.run.zones.length >= 3 && settings.run.zones.length <= 10);
      const hasBikeZones = Boolean(settings.bike?.zones && settings.bike.zones.length >= 3 && settings.bike.zones.length <= 10);
      const importedCount = Number(hasRunZones) + Number(hasBikeZones);
      toast(importedCount ? `Imported max HR${nextMax ? ` (${nextMax} bpm)` : ""} and ${importedCount === 2 ? "run and bike" : hasRunZones ? "run" : "bike"} HR zones.` : "Imported max HR. Adjust the estimated sport zones below if needed.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not import heart-rate settings from Intervals.icu.");
    } finally {
      setImportingMaxHeartRate(false);
    }
  };

  const updateHeartRateZoneBound = (sport: "run" | "bike", index: number, value: string) => {
    const next = { ...zoneUpperBoundInputs, [sport]: zoneUpperBoundInputs[sport].map((item, itemIndex) => itemIndex === index ? value : item) };
    setZoneUpperBoundInputs(next);
    const bounds = validHeartRateBounds(next[sport]);
    if (bounds) updatePlan({ heartRateZoneUpperBounds: { ...plan.heartRateZoneUpperBounds, [sport]: bounds } });
  };

  const continueToWeekBuilder = (e: React.FormEvent) => {
    e.preventDefault();
    const message = personalValidationMessage();
    if (message) {
      toast(message);
      return;
    }
    setStep("week-builder");
  };

  const continueToSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    const message = validationMessage(false, false);
    if (message) {
      toast(message);
      return;
    }
    updatePlan({ manualSessions: buildInitialWeeklySchedule(plan) });
    setStep("schedule");
  };

  const continueToRefinements = () => {
    const message = validationMessage(true, false);
    if (message) {
      toast(message);
      return;
    }
    setStep("refinements");
  };

  const review = () => {
    const message = validationMessage();
    if (message) {
      toast(message);
      return;
    }
    setStep("review");
  };

  const canSaveChanges = Boolean(forceSetup && athlete.preferences.plan.generatedAt);
  const saveChanges = async () => {
    if (!canSaveChanges || saving) return;
    const message = step === "setup"
      ? personalValidationMessage()
      : step === "week-builder"
        ? validationMessage(false, false)
        : step === "schedule"
          ? validationMessage(true, false)
          : validationMessage();
    if (message) {
      toast(message);
      return;
    }
    setSaving(true);
    try {
      const saved = await saveAthlete(form);
      setForm(saved);
      toast("Plan changes saved.");
      onSaved?.();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save plan changes.");
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    const message = validationMessage();
    if (message) {
      toast(message);
      const planMessage = validationMessage(true, false);
      const setupMessage = validationMessage(false, false);
      setStep(generatedWorkouts.capacityWarnings.length > 0 || planMessage ? "schedule" : setupMessage ? "setup" : "refinements");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveAthlete({
        ...form,
        preferences: {
          ...form.preferences,
          plan: { ...plan, trainingBaseline: generatedWorkouts.trainingBaseline, manualSessions: generatedWorkouts.sessions, generatedAt: new Date().toISOString() },
        },
      });
      setForm(saved);
      setStep("generated");
      toast("Workouts generated and saved.");
      onSaved?.();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save the plan overview.");
    } finally {
      setSaving(false);
    }
  };

  const scheduleAdvice: string[] = [];
  const intervalSessions = generatedWorkouts.sessions.filter((session) => session.quality);
  for (let left = 0; left < intervalSessions.length; left++) {
    for (let right = left + 1; right < intervalSessions.length; right++) {
      const first = intervalSessions[left];
      const second = intervalSessions[right];
      const gap = Math.abs(weekdays.indexOf(first.day) - weekdays.indexOf(second.day));
      const firstSport = first.sport[0].toUpperCase() + first.sport.slice(1);
      const secondSport = second.sport[0].toUpperCase() + second.sport.slice(1);
      if (gap === 0) {
        scheduleAdvice.push(`${firstSport} and ${secondSport} interval sessions are both scheduled on ${first.day}. Consider separating them.`);
      } else if (gap === 1 || gap === weekdays.length - 1) {
        scheduleAdvice.push(`${firstSport} and ${secondSport} interval sessions are on consecutive days (${first.day} and ${second.day}). Consider moving one to leave more recovery.`);
      }
    }
  }
  for (const sport of ["swim", "bike", "run"] as const) {
    const sportDays = new Set(plan.manualSessions.filter((session) => session.sport === sport).map((session) => session.day));
    let runStart = -1;
    for (let i = 0; i <= weekdays.length; i++) {
      const inRun = i < weekdays.length && sportDays.has(weekdays[i]);
      if (inRun && runStart === -1) runStart = i;
      if (!inRun && runStart !== -1) {
        const runEnd = i - 1;
        if (runEnd - runStart >= 2) {
          const span = runEnd - runStart === 1
            ? `${weekdays[runStart]} and ${weekdays[runEnd]}`
            : `${weekdays[runStart]}–${weekdays[runEnd]}`;
          const label = `${sport[0].toUpperCase()}${sport.slice(1)}`;
          scheduleAdvice.push(`${label} sessions are scheduled ${span}. Consider spacing them if recovery or access is a concern.`);
        }
        runStart = -1;
      }
    }
  }
  const calendarDays = weekdays.map((day, index) => {
    const date = new Date();
    const offset = (8 - date.getDay()) % 7 || 7;
    date.setDate(date.getDate() + offset + index);
    const daySessions = generatedWorkouts.sessions.filter((session) => session.day === day);
    const labels = daySessions.length
      ? daySessions.map((session) => `${session.title} · ${session.duration}`)
      : [plan.restDays.includes(day) ? "Rest day" : "No workout planned"];
    return { day, date, labels, workouts: daySessions, training: daySessions.length > 0, restDay: plan.restDays.includes(day) && daySessions.length === 0 };
  });
  const sports = ["swim", "bike", "run"] as const;
  const currentVolumeSummary = sports.map((sport) => {
    const target = plan.volumeBasis === "time" ? plan.timeTargets[sport] : plan.distanceTargets[sport];
    const unit = plan.volumeBasis === "time" ? "h" : sport === "swim" ? (form.preferences.units === "metric" ? "m" : "yd") : (form.preferences.units === "metric" ? "km" : "mi");
    return `${sport} ${target.weekly ?? "—"} ${unit}`;
  }).join(" · ");
  const peakVolumeSummary = sports.map((sport) => {
    const target = plan.volumeBasis === "time" ? plan.timeTargets[sport] : plan.distanceTargets[sport];
    const unit = plan.volumeBasis === "time" ? "h" : sport === "swim" ? (form.preferences.units === "metric" ? "m" : "yd") : (form.preferences.units === "metric" ? "km" : "mi");
    return target.peak === null ? `${sport} auto` : `${sport} ${target.peak} ${unit}`;
  }).join(" · ");
  const currentTimeTotal = sports.reduce((total, sport) => total + (plan.timeTargets[sport].weekly ?? 0), 0);
  const hasAutomaticPeak = sports.some((sport) => plan.timeTargets[sport].peak === null);
  const peakTimeTotal = sports.reduce((total, sport) => total + (plan.timeTargets[sport].peak ?? 0), 0);

  return (
    <div className="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
      {step === "setup" ? (
        <form onSubmit={continueToWeekBuilder}>
          <SectionTitle eyebrow="Plan builder · 1 of 5" title="Information about you" action={onCancel ? <Button onClick={onCancel} variant="ghost" testId="button-cancel-plan-builder"><X size={15} /> Cancel</Button> : undefined} />
          <p className="mb-5 text-xs text-muted-foreground"><span aria-hidden="true" className="font-bold text-red-600">*</span> Required</p>
          <section className="mb-5 rounded-2xl border border-border p-5" aria-labelledby="triathlon-experience-title">
            <div className="mb-4">
              <p id="triathlon-experience-title" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">What is your triathlon experience? <span aria-hidden="true" className="text-sm text-red-600">*</span></p>
              <p className="mt-1 text-xs text-muted-foreground">Choose the level that best matches your recent swim, bike, and run training.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3" role="group" aria-labelledby="triathlon-experience-title">
              {[
                { value: "beginner" as const, title: "Beginner / first-timer", timeline: "20–24 weeks", detail: "New to triathlon or building a consistent base across all three sports." },
                { value: "intermediate" as const, title: "Intermediate", timeline: "12–16 weeks", detail: "Consistent multi-sport training with some triathlon or endurance race experience." },
                { value: "advanced" as const, title: "Advanced / experienced", timeline: "6–12 weeks", detail: "A strong, established base and prior long-course or equivalent endurance experience." },
              ].map((option) => <button type="button" key={option.value} aria-pressed={plan.triathlonExperience === option.value} onClick={() => updatePlan({ triathlonExperience: option.value })} data-testid={`button-triathlon-experience-${option.value}`} className={`rounded-xl border p-4 text-left transition ${plan.triathlonExperience === option.value ? "border-accent bg-accent/10" : "border-border hover:border-accent/50"}`}>
                <span className="block text-sm font-bold">{option.title}</span>
                <span className="mt-1 block text-xs font-semibold text-muted-foreground">Typical runway · {option.timeline}</span>
                <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">{option.detail}</span>
              </button>)}
            </div>
          </section>
          <div className="mb-5 rounded-2xl border border-border p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">What are you training for?</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {[{ value: "race" as const, title: "A race or event", description: "Build toward a date with a gradual peak." }, { value: "consistency" as const, title: "Train consistently", description: "Maintain a sustainable weekly rhythm without a race date." }].map((option) => <button type="button" key={option.value} aria-pressed={plan.goalMode === option.value} onClick={() => setForm((current) => ({
                ...current,
                ...(option.value === "consistency" ? { event: "", distance: "", raceDate: "", raceTime: "" } : {}),
                preferences: { ...current.preferences, plan: { ...current.preferences.plan, goalMode: option.value } },
              }))} className={`rounded-xl border p-4 text-left transition ${plan.goalMode === option.value ? "border-accent bg-accent/10" : "border-border hover:border-accent/50"}`}>
                <span className="block text-sm font-bold">{option.title}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{option.description}</span>
              </button>)}
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {plan.goalMode === "race" && <section className="race-setup-enter md:col-span-2 rounded-2xl border border-border p-5">
              <div className="mb-4 border-b border-border pb-4">
                <p className="text-sm font-bold">Race details</p>
                <p className="mt-1 text-xs text-muted-foreground">Race distance and date are required to tailor the plan. The race name and goal time are optional.</p>
              </div>
              <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="plan-race-name" className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground"><span>Race name</span><span className="text-[10px] font-medium normal-case tracking-normal">Optional</span></label>
                  <input id="plan-race-name" type="text" value={form.event} onChange={(e) => setForm({ ...form, event: e.target.value })} data-testid="input-plan-race-name" placeholder="e.g., Lake Placid Triathlon" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
                </div>
                <div>
                  <label htmlFor="plan-distance" className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground"><span>Race distance</span><span aria-hidden="true" className="text-sm font-bold normal-case tracking-normal text-red-600">*</span></label>
                  <select id="plan-distance" value={form.distance} onChange={(e) => setForm({ ...form, distance: e.target.value })} data-testid="input-plan-distance" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent">
                    <option value="">Select a distance</option>
                    <option value="Half Ironman">Half Ironman (70.3)</option>
                    <option value="Ironman">Ironman (140.6)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="plan-race-date" className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground"><span>Race date</span><span aria-hidden="true" className="text-sm font-bold normal-case tracking-normal text-red-600">*</span></label>
                  <input id="plan-race-date" type="date" min={todayIsoDate} value={form.raceDate} onChange={(e) => setForm({ ...form, raceDate: e.target.value })} data-testid="input-plan-race-date" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
                  {raceTimelineWarning && <p role="status" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">{raceTimelineWarning}</p>}
                  {form.raceDate && form.raceDate < todayIsoDate && <p role="alert" className="mt-2 text-xs font-medium text-destructive">Choose a future race date.</p>}
                </div>
                <div>
                  <label htmlFor="plan-race-time" className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground"><span>Goal race time</span><span className="text-[10px] font-medium normal-case tracking-normal">Optional</span></label>
                  <input id="plan-race-time" value={form.raceTime} onChange={(e) => setForm({ ...form, raceTime: e.target.value })} data-testid="input-plan-race-time" type="text" inputMode="numeric" placeholder="4:30:00" pattern="\d{1,3}:[0-5]\d:[0-5]\d" title="Use hours:minutes:seconds, for example 4:30:00." className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
                  <p className="mt-1 text-[11px] text-muted-foreground">Hours:minutes:seconds</p>
                </div>
              </div>
            </section>}
          </div>
          <div className="mt-8 flex justify-between gap-3 border-t border-border pt-6">{canSaveChanges ? <Button type="button" variant="secondary" onClick={() => void saveChanges()} disabled={saving} testId="button-save-plan-changes">{saving ? "Saving…" : "Save changes"}</Button> : <span />}<Button type="submit" testId="button-continue-to-week-builder"><ArrowRight size={16} /> Continue to Week Builder</Button></div>
        </form>
      ) : step === "week-builder" ? (
        <form onSubmit={continueToSchedule}>
          <SectionTitle eyebrow="Plan builder · 2 of 5" title="Week builder" action={onCancel ? <Button onClick={onCancel} variant="ghost" testId="button-cancel-plan-builder"><X size={15} /> Cancel</Button> : undefined} />
          <p className="mb-6 max-w-3xl text-sm leading-relaxed text-muted-foreground">Set your weekly training targets and availability. We’ll use these to draft a week you can arrange on the next step.</p>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="md:col-span-2 rounded-2xl border border-border p-5">
              <div className="mb-4 border-b border-border pb-4">
                <p className="text-sm font-bold">{plan.goalMode === "race" ? "Required weekly targets by sport" : "Required typical weekly targets by sport"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{plan.goalMode === "race" ? "Set starting time by sport. Blank peak targets build at your chosen rate through the final build week." : "Set a sustainable weekly training-time target for each sport."}</p>
              </div>
              <div className="grid gap-4 md:grid-cols-3">{sports.map((sport) => {
                const target = plan.timeTargets[sport];
                return <div key={sport} className="rounded-xl bg-secondary/40 p-4">
                  <p className="text-sm font-bold capitalize">{sport}</p>
                  <label htmlFor={`volume-${sport}`} className="mt-3 flex items-center justify-between gap-2 text-[11px] font-semibold text-muted-foreground"><span>{plan.goalMode === "race" ? "Starting weekly target (hours)" : "Weekly target (hours)"}</span><span aria-hidden="true" className="text-sm font-bold text-red-600">*</span></label>
                  <input id={`volume-${sport}`} type="number" min="0.1" step="0.1" value={target.weekly ?? ""} onChange={(e) => updatePlan({ timeTargets: { ...plan.timeTargets, [sport]: { ...target, weekly: e.target.value ? Number(e.target.value) : null } } })} data-testid={`input-current-${sport}-time`} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm hide-number-controls" />
                  {plan.goalMode === "race" && <>
                    <label htmlFor={`peak-${sport}`} className="mt-3 block text-[11px] font-semibold text-muted-foreground">Peak weekly target (hours · optional)</label>
                    <input id={`peak-${sport}`} type="number" min="0.1" step="0.1" value={target.peak ?? ""} onChange={(e) => updatePlan({ timeTargets: { ...plan.timeTargets, [sport]: { ...target, peak: e.target.value ? Number(e.target.value) : null } } })} data-testid={`input-peak-${sport}-time`} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm hide-number-controls" />
                  </>}
                </div>;
              })}</div>
            </div>
            <section className="md:col-span-2 rounded-2xl border border-border p-5">
              <div className="mb-4"><p className="text-sm font-bold">Progression &amp; recovery</p></div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="plan-recovery-rhythm" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Build and recovery</label>
                  <select id="plan-recovery-rhythm" value={plan.recoveryRhythm === "manual" ? "none" : plan.recoveryRhythm} onChange={(e) => updatePlan({ recoveryRhythm: e.target.value as RecoveryRhythm })} data-testid="select-recovery-rhythm" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm">
                    <option value="none">No build · repeat weekly schedule</option>
                    <option value="2:1">2 build weeks, then recovery</option>
                    <option value="3:1">3 build weeks, then recovery (recommended)</option>
                    <option value="4:1">4 build weeks, then recovery</option>
                    <option value="custom">Custom build weeks</option>
                  </select>
                  {plan.recoveryRhythm === "custom" && <div className="mt-3"><label htmlFor="plan-custom-build-weeks" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Build weeks before recovery</label><input id="plan-custom-build-weeks" type="number" min="1" max="12" step="1" value={plan.customBuildWeeks ?? 3} onChange={(e) => updatePlan({ customBuildWeeks: e.target.value === "" ? 0 : Number(e.target.value) })} data-testid="input-custom-build-weeks" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm hide-number-controls" /></div>}
                </div>
                <div>
                  <label htmlFor="plan-build-rate" className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground"><span>Build rate (%/week)</span>{plan.recoveryRhythm !== "manual" && plan.recoveryRhythm !== "none" && <span aria-hidden="true" className="text-sm font-bold text-red-600">*</span>}</label>
                  <input id="plan-build-rate" type="number" min="0" max="10" step="0.5" required={plan.recoveryRhythm !== "manual" && plan.recoveryRhythm !== "none"} disabled={plan.recoveryRhythm === "manual" || plan.recoveryRhythm === "none"} value={plan.weeklyBuildRate ?? ""} onChange={(e) => updatePlan({ weeklyBuildRate: e.target.value === "" ? null : Number(e.target.value) })} data-testid="input-weekly-build-rate" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm hide-number-controls disabled:opacity-50" />
                </div>
                <div>
                  <label htmlFor="plan-recovery-percent" className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground"><span>Recovery volume (% of build week)</span>{plan.recoveryRhythm !== "manual" && plan.recoveryRhythm !== "none" && <span aria-hidden="true" className="text-sm font-bold text-red-600">*</span>}</label>
                  <input id="plan-recovery-percent" type="number" min="50" max="100" step="5" required={plan.recoveryRhythm !== "manual" && plan.recoveryRhythm !== "none"} disabled={plan.recoveryRhythm === "manual" || plan.recoveryRhythm === "none"} value={plan.recoveryWeekPercent ?? 75} onChange={(e) => updatePlan({ recoveryWeekPercent: e.target.value === "" ? 75 : Number(e.target.value) })} data-testid="input-recovery-week-percent" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm hide-number-controls disabled:opacity-50" />
                </div>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">{plan.recoveryRhythm === "none" || plan.recoveryRhythm === "manual"
                ? "Keeps weekly targets level without a build/recovery cycle. Race plans still taper before race week."
                : <>Build by {plan.weeklyBuildRate ?? 5}% per week{(plan.weeklyBuildRate ?? 5) === 5 ? " (suggested)" : ""}; reduce recovery weeks to {plan.recoveryWeekPercent ?? 75}% of the final build week{(plan.recoveryWeekPercent ?? 75) === 75 ? " (suggested)" : ""}. Interval sessions shift to easier aerobic work.</>}</p>
            </section>
            <section className="md:col-span-2 rounded-2xl border border-border p-5">
              <div className="mb-4"><p className="text-sm font-bold">Weekly structure <span className="text-xs font-medium text-muted-foreground">· defaults provided</span></p><p className="mt-1 text-xs text-muted-foreground">Your sport focus, available sessions and rest days start with defaults. Change them to match your week.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="plan-primary-focus" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Primary focus</label>
                  <select id="plan-primary-focus" value={plan.primaryFocus} onChange={(e) => updatePlan({ primaryFocus: e.target.value as PlanPreferences["primaryFocus"] })} data-testid="select-primary-focus" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="balanced">Balanced</option><option value="swim">Swim focused</option><option value="bike">Bike focused</option><option value="run">Run focused</option></select>
                  <p className="mt-1 text-[11px] text-muted-foreground">Emphasize one sport while keeping all three in your week.</p>
                </div>
                <div>
                  <label htmlFor="plan-sessions-per-week" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Maximum available sessions per week</label>
                  <select id="plan-sessions-per-week" value={plan.sessionsPerWeek ?? 6} onChange={(e) => updatePlan({ sessionsPerWeek: Number(e.target.value) })} data-testid="select-sessions-per-week" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm">
                    {Array.from({ length: 12 }, (_, index) => index + 3).map((count) => <option key={count} value={count}>{count} sessions</option>)}
                  </select>
                  <p className="mt-1 text-[11px] text-muted-foreground">We’ll schedule up to this many workouts, using fewer when that’s enough to meet your targets.</p>
                </div>
                <div>
                  <label htmlFor="plan-rest-days-per-week" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Rest days per week</label>
                  <select id="plan-rest-days-per-week" value={plan.restDaysPerWeek ?? plan.restDays.length} onChange={(e) => {
                    const count = Number(e.target.value);
                    const preferenceOrder = ["Mon", "Wed", "Fri", "Tue", "Thu", "Sat", "Sun"];
                    const nextRestDays = plan.restDays.slice(0, count);
                    for (const day of preferenceOrder) {
                      if (nextRestDays.length >= count) break;
                      if (!nextRestDays.includes(day)) nextRestDays.push(day);
                    }
                    updatePlan({ restDays: nextRestDays, restDaysPerWeek: count });
                  }} data-testid="select-rest-days-per-week" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm">
                    {Array.from({ length: 5 }, (_, count) => <option key={count} value={count}>{count} {count === 1 ? "rest day" : "rest days"}</option>)}
                  </select>
                  <p className="mt-1 text-[11px] text-muted-foreground">We’ll leave this many days open in the draft schedule.</p>
                </div>
                <div>
                  <label htmlFor="plan-max-session-minutes" className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground"><span>Maximum time available per workout</span><span aria-hidden="true" className="text-sm font-bold normal-case tracking-normal text-red-600">*</span></label>
              <div className="relative mt-2">
                <input id="plan-max-session-minutes" type="number" min={15} max={600} step={1} value={maxSessionMinutesInput} onFocus={(e) => e.currentTarget.select()} onChange={(e) => {
                  const value = e.target.value;
                  setMaxSessionMinutesInput(value);
                  if (value.trim() && Number.isFinite(Number(value))) updatePlan({ maxSessionMinutes: Number(value) });
                }} data-testid="input-max-session-minutes" className="h-11 w-full rounded-lg border border-input bg-background px-3 pr-20 text-sm hide-number-controls" />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">minutes</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">This is an availability ceiling. Generated workouts are at least 15 minutes and can be shorter than the weekly target suggests.</p>
                </div>
              </div>
            </section>
          </div>
          <div className="mt-8 flex justify-between gap-3 border-t border-border pt-6"><Button type="button" onClick={() => setStep("setup")} variant="secondary" testId="button-back-to-information"><ArrowLeft size={15} /> Back to Information about you</Button><div className="flex gap-3">{canSaveChanges && <Button type="button" variant="secondary" onClick={() => void saveChanges()} disabled={saving} testId="button-save-plan-changes">{saving ? "Saving…" : "Save changes"}</Button>}<Button type="submit" testId="button-build-weekly-schedule"><ArrowRight size={16} /> Build weekly schedule</Button></div></div>
        </form>
      ) : step === "schedule" ? (
        <div>
          <SectionTitle eyebrow="Plan builder · 3 of 5" title="Build your weekly schedule" action={onCancel ? <Button onClick={onCancel} variant="ghost" testId="button-cancel-plan-builder"><X size={15} /> Cancel</Button> : undefined} />
          <p className="mb-6 max-w-3xl text-sm leading-relaxed text-muted-foreground">We’ve drafted {plan.manualSessions.length} workouts from your weekly targets and availability. Drag sessions to arrange your week; edit their sports or minutes, add or remove workouts, and mark rest days. Scroll sideways on smaller screens.</p>
          <CapacityWarning warnings={generatedWorkouts.capacityWarnings} volumeBasis={plan.volumeBasis} />
          {generatedWorkouts.historyAdjustments.length > 0 && <div role="status" className="mb-5 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"><p className="font-semibold">Starting volume adjusted to recent training</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{generatedWorkouts.historyAdjustments.map(({ sport, startingMinutes, rampTargetMinutes, completedWeeks }) => <li key={sport}>{sport[0].toUpperCase() + sport.slice(1)} starts at {formatWeeklyMinutes(startingMinutes)}/week (median of {completedWeeks} logged weeks), {buildWeeksBeforeRecovery(plan.recoveryRhythm, plan.customBuildWeeks) === null ? "then repeats your weekly schedule without progression." : <>then builds toward {formatWeeklyMinutes(rampTargetMinutes)}/week, with a recovery week after {buildWeeksBeforeRecovery(plan.recoveryRhythm, plan.customBuildWeeks)} build weeks.</>}</li>)}</ul></div>}
            {scheduleAdvice.length > 0 && <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4 text-xs leading-relaxed text-orange-950"><p className="font-bold">A few things to consider</p><ul className="mt-2 list-disc space-y-1 pl-4">{scheduleAdvice.map((item) => <li key={item}>{item}</li>)}</ul><p className="mt-2 text-orange-900/75">These are coaching prompts, not blockers. Rearrange sessions if you want more recovery between key workouts.</p></div>}
          <div className="mt-8 border-t border-border pt-6">
            <div className="mb-4"><p className="text-sm font-bold">Your training week</p></div>
            <div className="overflow-x-auto pb-3">
              <div className="grid min-w-[840px] grid-cols-7 gap-2">
                {weekdays.map((day) => {
                  const daySessions = generatedWorkouts.sessions.filter((session) => session.day === day);
                  const restDay = plan.restDays.includes(day) && daySessions.length === 0;
                  return <section key={day} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
                    event.preventDefault();
                    const sessionId = event.dataTransfer.getData("text/plain") || draggingSessionId;
                    if (!sessionId) return;
                    const nextRestDays = plan.restDays.filter((rest) => rest !== day);
                    updatePlan({ restDays: nextRestDays, restDaysPerWeek: nextRestDays.length, manualSessions: plan.manualSessions.map((item) => item.id === sessionId ? { ...item, day } : item) });
                    setDraggingSessionId(null);
                  }} className={`min-h-48 rounded-xl border p-2 ${restDay ? "border-slate-300 bg-slate-100 text-slate-600" : "border-border bg-secondary/20"}`}>
                    <div className="mb-3 border-b border-border/70 pb-3">
                      <p className="text-xs font-bold">{day}</p>
                      <button type="button" aria-pressed={restDay} disabled={daySessions.length > 0 || (!restDay && plan.restDays.length >= 4)} onClick={() => {
                        const nextRestDays = restDay ? plan.restDays.filter((item) => item !== day) : [...plan.restDays, day];
                        updatePlan({ restDays: nextRestDays, restDaysPerWeek: nextRestDays.length });
                      }} data-testid={`button-rest-${day.toLowerCase()}`} className={`mt-2 flex w-full items-center justify-center whitespace-nowrap rounded-full border px-1 py-1 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${restDay ? "border-slate-300 bg-slate-200 text-slate-700" : "border-border bg-background text-muted-foreground"}`}>{restDay ? "Rest day" : "Set rest"}</button>
                    </div>
                    <div className="space-y-3">
                      {daySessions.map((session) => <article key={session.id} draggable onDragStart={(event) => { event.dataTransfer.setData("text/plain", session.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setDragImage(event.currentTarget, event.nativeEvent.offsetX, event.nativeEvent.offsetY); setDraggingSessionId(session.id); }} onDragEnd={() => setDraggingSessionId(null)} className={`cursor-grab rounded-xl border border-border bg-background p-2 active:cursor-grabbing ${draggingSessionId === session.id ? "opacity-50 ring-2 ring-accent" : ""}`}>
                        <div className="flex items-center gap-1">
                          <select aria-label={`${day} session sport`} value={session.sport} onChange={(e) => updatePlan({ manualSessions: plan.manualSessions.map((item) => item.id === session.id ? { ...item, sport: e.target.value as typeof item.sport, durationOverrideMinutes: undefined, title: item.title === `${item.sport[0].toUpperCase()}${item.sport.slice(1)} session` ? `${e.target.value[0].toUpperCase()}${e.target.value.slice(1)} session` : item.title } : item) })} data-testid={`select-session-sport-${session.id}`} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-1 text-[10px]"><option value="swim">Swim</option><option value="bike">Bike</option><option value="run">Run</option></select>
                          <IconButton label={`remove ${session.sport} on ${day}`} disabled={plan.manualSessions.length <= 3} onClick={() => {
                            const manualSessions = plan.manualSessions.filter((item) => item.id !== session.id);
                            updatePlan({ manualSessions, sessionsPerWeek: manualSessions.length });
                          }}><Trash2 size={13} /></IconButton>
                        </div>
                        <p className="mt-2 text-[11px] font-semibold leading-tight">{session.title}</p>
                        <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                          <input
                            id={`session-duration-${session.id}`}
                            type="number"
                            min={15}
                            max={(() => {
                              const configuredLimit = Math.max(15, plan.maxSessionMinutes || 90);
                              const sportTarget = Math.min(
                                weeklyTargetMinutes(plan, session.sport, "weekly", sessions),
                                generatedWorkouts.trainingBaseline[session.sport]?.startingMinutes ?? Number.POSITIVE_INFINITY,
                              );
                              const otherSessionMinutes = generatedWorkouts.sessions
                                .filter((item) => item.sport === session.sport && item.id !== session.id)
                                .reduce((total, item) => total + (item.durationMinutes ?? 0), 0);
                              const remainingTarget = Math.max(15, sportTarget - otherSessionMinutes);
                              const recommendedLimit = session.quality ? recommendedSessionCap(plan, session.sport, true) : configuredLimit;
                              return Math.max(15, session.durationMinutes ?? 15, Math.min(configuredLimit, recommendedLimit, Math.ceil(remainingTarget / 5) * 5));
                            })()}
                            step={5}
                            value={session.durationMinutes ?? ""}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              updatePlan({ manualSessions: plan.manualSessions.map((item) => item.id === session.id
                                ? { ...item, durationOverrideMinutes: value && Number.isFinite(Number(value)) ? Number(value) : undefined }
                                : item) });
                            }}
                            aria-label={`${day} ${session.sport} session duration in minutes`}
                            data-testid={`input-session-duration-${session.id}`}
                            className="h-6 w-12 rounded-md border border-input bg-background px-1 text-[10px] text-foreground"
                          />
                          <span>min · {session.intensity}</span>
                        </div>
                      </article>)}
                      <Button type="button" variant="secondary" onClick={() => {
                        const sport = (["swim", "bike", "run"] as const).find((item) => !plan.manualSessions.some((session) => session.sport === item)) ?? "swim";
                        const nextRestDays = plan.restDays.filter((restDay) => restDay !== day);
                        const manualSessions = [...plan.manualSessions, { id: crypto.randomUUID(), day, sport, title: `${sport[0].toUpperCase()}${sport.slice(1)} session`, duration: "", intensity: "Endurance", quality: false }];
                        updatePlan({ restDays: nextRestDays, restDaysPerWeek: nextRestDays.length, manualSessions, sessionsPerWeek: manualSessions.length });
                      }} disabled={plan.manualSessions.length >= 14} testId={`button-add-session-${day.toLowerCase()}`} className="h-8 w-full whitespace-nowrap px-1 text-[10px]"><Plus size={12} /> Add</Button>
                    </div>
                  </section>;
                })}
              </div>
            </div>
          </div>
          <div className="mt-7 flex justify-between gap-3 border-t border-border pt-6">
            <Button onClick={() => setStep("week-builder")} variant="secondary" testId="button-back-plan-details"><ArrowLeft size={15} /> Back to Week Builder</Button>
            <div className="flex gap-3">{canSaveChanges && <Button type="button" variant="secondary" onClick={() => void saveChanges()} disabled={saving} testId="button-save-plan-changes">{saving ? "Saving…" : "Save changes"}</Button>}<Button onClick={continueToRefinements} disabled={plan.volumeBasis === "time" && generatedWorkouts.capacityWarnings.length > 0} testId="button-continue-to-refinements"><ArrowRight size={16} /> Continue to workout refinements</Button></div>
          </div>
        </div>
      ) : step === "refinements" ? (
        <div>
          <SectionTitle eyebrow="Plan builder · 4 of 5" title="Refine workout targets" action={onCancel ? <Button onClick={onCancel} variant="ghost" testId="button-cancel-plan-builder"><X size={15} /> Cancel</Button> : undefined} />
          <p className="mb-6 max-w-3xl text-sm leading-relaxed text-muted-foreground">These optional personal metrics make pace, power, and heart-rate guidance more specific. If you don’t know them yet, you can add them as you progress through your workouts.</p>
          <section className="rounded-2xl border border-border p-5">
            <div className="mb-4"><p className="text-sm font-bold">Workout intensity metrics <span className="text-xs font-medium text-muted-foreground">· optional</span></p><p className="mt-1 text-xs text-muted-foreground">Add any metrics you know to personalize workout targets. Leave unknown values blank; effort cues still work without them.</p></div>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <label htmlFor="plan-easy-run-pace" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Easy running pace · min:sec/{easyPaceUnit}</label>
                <input id="plan-easy-run-pace" type="text" inputMode="numeric" value={easyPaceInput} onChange={(event) => { const value = event.target.value; setEasyPaceInput(value); updatePlan({ easyRunPaceSecondsPerKm: value.trim() ? paceSecondsPerKmFromInput(value, easyPaceUnit) : null }); }} placeholder="9:51" aria-describedby="plan-easy-run-help" data-testid="input-plan-easy-run-pace" className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" />
                <p id="plan-easy-run-help" className="mt-1 text-[11px] text-muted-foreground">Conversational pace. Personalizes easy runs and interval rep targets.</p>
                {easyPaceInput.trim() && !parsedEasyPace && <p role="alert" className="mt-2 text-xs font-medium text-destructive">Enter a pace from 2:00 to 30:00, for example 9:51.</p>}
                <div className="mt-3 divide-y divide-border rounded-lg border border-border px-3">{displayedTrainingPaces.map((pace) => <div key={pace.id} className="flex items-center justify-between gap-3 py-2 text-xs"><span><span className="font-semibold">{pace.label}</span><span className="ml-2 text-muted-foreground">{pace.repRange}</span></span><span className={`shrink-0 font-semibold tabular-nums ${parsedEasyPace ? "" : "text-muted-foreground"}`}>{pace.formatted}</span></div>)}</div>
              </div>
              <div>
                <label htmlFor="plan-ftp-watts" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Cycling FTP · watts</label>
                <div className="mt-2 flex items-center gap-2"><input id="plan-ftp-watts" type="number" min="50" max="1000" step="1" value={ftpInput} onChange={(event) => { const value = event.target.value; setFtpInput(value); updatePlan({ ftpWatts: value.trim() && Number.isInteger(Number(value)) && Number(value) >= 50 && Number(value) <= 1000 ? Number(value) : null }); }} placeholder="e.g. 220" aria-describedby="plan-ftp-help" data-testid="input-plan-ftp-watts" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" /><span className="text-sm text-muted-foreground">W</span></div>
                <p id="plan-ftp-help" className="mt-1 text-[11px] text-muted-foreground">Adds power targets to bike workouts. Leave blank to use effort cues.</p>
                <div className="mt-3 divide-y divide-border rounded-lg border border-border px-3">{displayedBikePowerZones.map((zone) => <div key={zone.id} className="flex items-center justify-between gap-3 py-2 text-xs"><span><span className="font-semibold">{zone.id.toUpperCase()} · {zone.label}</span><span className="ml-2 text-muted-foreground">{zone.percentRange}</span></span><span className={`shrink-0 font-semibold tabular-nums ${parsedBikeFtp ? "" : "text-muted-foreground"}`}>{zone.formatted}</span></div>)}</div>
                {detectedBikeFtp && <Button type="button" variant="secondary" onClick={() => { const value = Math.round(detectedBikeFtp); setFtpInput(String(value)); updatePlan({ ftpWatts: value }); }} className="mt-2 h-9 rounded-lg border border-accent/30 bg-accent/5 px-3 text-xs font-semibold text-foreground hover:border-accent hover:bg-accent/10"><Bike size={14} /> Use Intervals.icu eFTP · {Math.round(detectedBikeFtp)} W</Button>}
                {ftpInput.trim() && (!Number.isInteger(Number(ftpInput)) || Number(ftpInput) < 50 || Number(ftpInput) > 1000) && <p role="alert" className="mt-2 text-xs font-medium text-destructive">Enter FTP from 50 to 1,000 watts.</p>}
              </div>
              <div className="md:col-span-2 border-t border-border pt-5">
                <div className="grid gap-5 md:grid-cols-[minmax(12rem,0.7fr)_1.3fr] md:items-start">
                  <div>
                    <label htmlFor="plan-max-heart-rate" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Maximum heart rate · bpm</label>
                    <input id="plan-max-heart-rate" type="number" min="80" max="240" step="1" value={maxHeartRateInput} onChange={(event) => { const value = event.target.value; setMaxHeartRateInput(value); const max = value.trim() && Number.isInteger(Number(value)) && Number(value) >= 80 && Number(value) <= 240 ? Number(value) : null; if (max) { const defaults = heartRateZoneUpperBoundsFromMax(max); const nextBounds = { run: defaults, bike: defaults }; setZoneUpperBoundInputs({ run: defaults.map(String), bike: defaults.map(String) }); updatePlan({ maxHeartRate: max, heartRateZoneUpperBounds: nextBounds, heartRateZoneNames: undefined }); } else updatePlan({ maxHeartRate: null }); }} placeholder="e.g. 185" aria-describedby="plan-max-hr-help" data-testid="input-plan-max-heart-rate" className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm" />
                    <p id="plan-max-hr-help" className="mt-1 text-[11px] text-muted-foreground">Used for personalized aerobic heart-rate guidance.</p>
                    {connection.intervalsConfigured && <Button type="button" variant="secondary" onClick={() => void importMaxHeartRate()} disabled={importingMaxHeartRate} className="mt-2">{importingMaxHeartRate ? "Importing…" : "Import from Intervals.icu"}</Button>}
                    {maxHeartRateInput.trim() && !displayedHeartRateZones.length && <p role="alert" className="mt-2 text-xs font-medium text-destructive">Enter a max heart rate from 80 to 240 bpm.</p>}
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Adjust sport heart-rate zones</p>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">{(["run", "bike"] as const).map((sport) => {
                      const upperBounds = validHeartRateBounds(zoneUpperBoundInputs[sport]);
                      const hasValidMax = parsedMaxHeartRate !== null && Number.isInteger(parsedMaxHeartRate) && parsedMaxHeartRate >= 80 && parsedMaxHeartRate <= 240;
                      const zones = hasValidMax
                        ? heartRateZonesFromMax(parsedMaxHeartRate, upperBounds, plan.heartRateZoneNames?.[sport])
                        : Array.from({ length: Math.max(HEART_RATE_ZONE_BANDS.length, zoneUpperBoundInputs[sport].length) }, (_, index) => ({ zone: index + 1, label: plan.heartRateZoneNames?.[sport]?.[index] || HEART_RATE_ZONE_BANDS[index]?.label || `Custom ${index + 1}`, lower: 0, upper: 0 }));
                      return <div key={sport} className="rounded-xl border border-border p-3"><p className="mb-2 text-xs font-semibold capitalize">{sport}</p><div className="space-y-1.5">{zones.map((zone) => {
                        const inputValue = zoneUpperBoundInputs[sport][zone.zone - 1] || (hasValidMax ? String(zone.upper) : "");
                        const rangeLabel = !hasValidMax ? "—" : zone.zone === 1 ? `up to ${zone.upper}` : `${zone.lower}–${zone.upper}`;
                        return <label key={zone.zone} className="grid grid-cols-[1fr_5.5rem] items-center gap-2 text-xs"><span>Z{zone.zone} · {zone.label}<span className="ml-1 text-muted-foreground">({rangeLabel} bpm)</span></span><span className="flex items-center gap-1"><input aria-label={`${sport} Zone ${zone.zone} upper heart rate`} type="number" min="30" max="240" step="1" value={inputValue} placeholder="—" onChange={(event) => updateHeartRateZoneBound(sport, zone.zone - 1, event.target.value)} className="h-8 w-full rounded-md border border-input bg-background px-2 text-right tabular-nums placeholder:text-muted-foreground" /><span className="text-muted-foreground">bpm</span></span></label>;
                      })}</div></div>;
                    })}</div>
                    {displayedHeartRateZones.length > 0 && (["run", "bike"] as const).some((sport) => !validHeartRateBounds(zoneUpperBoundInputs[sport])) && <p role="alert" className="mt-2 text-xs text-destructive">Set at least three increasing upper limits from 30 to 240 bpm for each sport.</p>}
                  </div>
                </div>
              </div>
            </div>
          </section>
          <div className="mt-7 flex justify-between gap-3 border-t border-border pt-6">
            <Button onClick={() => setStep("schedule")} variant="secondary" testId="button-back-plan-schedule"><ArrowLeft size={15} /> Back to weekly schedule</Button>
            <div className="flex gap-3">{canSaveChanges && <Button type="button" variant="secondary" onClick={() => void saveChanges()} disabled={saving} testId="button-save-plan-changes">{saving ? "Saving…" : "Save changes"}</Button>}<Button onClick={review} testId="button-review-plan"><ArrowRight size={16} /> Review plan</Button></div>
          </div>
        </div>
      ) : (
        <div>
          <SectionTitle eyebrow={step === "generated" ? "Plan outline" : "Plan builder · 5 of 5"} title={step === "generated" ? "Your plan overview" : "Review your plan"} action={step === "generated" ? <div className="flex shrink-0 flex-col items-end gap-2 self-start sm:flex-row [&>button]:h-12 [&>button]:min-h-12 [&>button]:w-48 [&>button]:whitespace-nowrap"><Button onClick={() => setStep("setup")} variant="secondary" testId="button-edit-plan-preferences"><Pencil size={15} /> Edit preferences</Button><Button onClick={() => setStep("schedule")} variant="secondary" testId="button-edit-plan-schedule"><Pencil size={15} /> Edit schedule</Button><Button onClick={() => setStep("refinements")} variant="secondary" testId="button-edit-plan-refinements"><Pencil size={15} /> Edit workout metrics</Button></div> : undefined} />
          <p className="mb-4 text-sm text-muted-foreground">Your targets, weekly schedule, and workout guidance are set. Open a workout to see its details.</p>
          <CapacityWarning warnings={generatedWorkouts.capacityWarnings} volumeBasis={plan.volumeBasis} />
          {raceTimelineWarning && <div role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">{raceTimelineWarning}</div>}
          {generatedWorkouts.historyAdjustments.length > 0 && <div role="status" className="mb-5 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"><p className="font-semibold">Starting volume adjusted to recent training</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{generatedWorkouts.historyAdjustments.map(({ sport, startingMinutes, rampTargetMinutes, completedWeeks }) => <li key={sport}>{sport[0].toUpperCase() + sport.slice(1)} starts at {formatWeeklyMinutes(startingMinutes)}/week (median of {completedWeeks} logged weeks), {buildWeeksBeforeRecovery(plan.recoveryRhythm, plan.customBuildWeeks) === null ? "then repeats your weekly schedule without progression." : <>then builds toward {formatWeeklyMinutes(rampTargetMinutes)}/week, with a recovery week after {buildWeeksBeforeRecovery(plan.recoveryRhythm, plan.customBuildWeeks)} build weeks.</>}</li>)}</ul></div>}
          <div className={`mb-5 grid gap-x-6 gap-y-3 border-y border-border py-4 sm:grid-cols-2 ${plan.goalMode === "race" ? "xl:grid-cols-4" : ""}`}>
            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Weekly volume</p><p className="mt-1 text-sm font-semibold">{plan.volumeBasis === "time" ? `${currentTimeTotal.toFixed(1)} h total` : "By sport"}</p><p className="text-xs capitalize text-muted-foreground">{currentVolumeSummary}</p></div>
            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Plan structure</p><p className="mt-1 text-sm font-semibold">{plan.primaryFocus === "balanced" ? "Balanced" : `${plan.primaryFocus[0].toUpperCase()}${plan.primaryFocus.slice(1)} focused`} · {plan.manualSessions.length} of {plan.sessionsPerWeek} available sessions</p><p className="text-xs text-muted-foreground">{plan.goalMode === "consistency" ? "Ongoing · " : ""}{plan.restDays.length ? `Rest ${plan.restDays.join(", ")}` : "No rest day marked"} · up to {plan.maxSessionMinutes} min/workout</p></div>
            {plan.goalMode === "race" && <><div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Peak volume</p><p className="mt-1 text-sm font-semibold">{plan.volumeBasis === "time" ? hasAutomaticPeak ? "Automatic by build rate" : `${peakTimeTotal.toFixed(1)} h total` : "By sport"}</p><p className="text-xs capitalize text-muted-foreground">{peakVolumeSummary} · {plan.weeklyBuildRate}% weekly build</p></div><div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Race</p><p className="mt-1 text-sm font-semibold">{weeksToRace === null ? "Date not set" : `${weeksToRace} weeks away`}</p><p className="text-xs text-muted-foreground">{form.distance} · {form.raceDate}{form.raceTime ? ` · Goal ${form.raceTime}` : ""}</p><p className="mt-1 text-xs capitalize text-muted-foreground">{plan.triathlonExperience} triathlon experience</p></div></>}
          </div>
          <section className="mb-5 rounded-xl border border-border bg-secondary/20 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-xs font-semibold">Progression &amp; recovery</p><p className="text-[11px] text-muted-foreground">{buildWeeksBeforeRecovery(plan.recoveryRhythm, plan.customBuildWeeks) === null ? "No build · weekly schedule repeats" : `${buildWeeksBeforeRecovery(plan.recoveryRhythm, plan.customBuildWeeks)} build weeks + recovery · ${plan.weeklyBuildRate ?? 5}% build · ${plan.recoveryWeekPercent ?? 75}% recovery`}</p></div>
          </section>
          <section className="mb-5 rounded-xl border border-border p-4">
            <p className="text-xs font-semibold">Workout intensity metrics</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Easy run pace</p><p className="mt-1 text-sm font-medium">{plan.easyRunPaceSecondsPerKm ? formatRunPace(plan.easyRunPaceSecondsPerKm, plan.distanceTargets.run.unit) : "Not set · effort cues"}</p></div>
              <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Cycling FTP</p><p className="mt-1 text-sm font-medium">{plan.ftpWatts ? `${plan.ftpWatts} W` : "Not set · effort cues"}</p></div>
              <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Maximum heart rate</p><p className="mt-1 text-sm font-medium">{plan.maxHeartRate ? `${plan.maxHeartRate} bpm` : "Not set"}</p></div>
            </div>
            <div className="mt-4 grid gap-4 border-t border-border pt-3 sm:grid-cols-2">{(["run", "bike"] as const).map((sport) => {
              const bounds = plan.heartRateZoneUpperBounds?.[sport];
              const zones = plan.maxHeartRate
                ? heartRateZonesFromMax(plan.maxHeartRate, bounds, plan.heartRateZoneNames?.[sport])
                : (bounds ?? []).map((upper, index) => ({ zone: index + 1, label: plan.heartRateZoneNames?.[sport]?.[index] || `Zone ${index + 1}`, lower: 0, upper }));
              return <div key={sport}><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{sport} heart-rate zones</p>{zones.length ? <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">{zones.map((zone) => <span key={zone.zone}>Z{zone.zone} {zone.label} · {plan.maxHeartRate ? zone.zone === 1 ? `up to ${zone.upper}` : `${zone.lower}–${zone.upper}` : `up to ${zone.upper}`} bpm</span>)}</div> : <p className="mt-1 text-[11px] text-muted-foreground">Not set</p>}</div>;
            })}</div>
          </section>
          <div className="mt-5">
            <div className="mb-3">
              <p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">Weekly calendar</p>
              <h2 className="display text-2xl">Weekly schedule</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
              {calendarDays.map(({ day, date, labels, workouts, training, restDay }) => <div key={day} className={`min-h-32 rounded-2xl border p-3 ${restDay ? "border-slate-300 bg-slate-100 text-slate-600" : training ? "border-border bg-background" : "border-dashed border-border bg-secondary/40"}`}>
                <p className="text-xs font-bold">{day}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{prettyDate(iso(date))}</p>
                <div className="mt-3 space-y-2">{workouts.length ? workouts.map((workout) => <details key={workout.id} className="rounded-lg bg-primary/5 px-2 py-1.5 text-[11px]"><summary className="cursor-pointer font-semibold text-primary">{workout.title} · {workoutTargetLabel(plan, workout, sessions, form.preferences.units)}</summary><p className="mt-2 whitespace-pre-line text-[10px] leading-relaxed text-muted-foreground">{workoutDescriptionForDisplay(plan, workout, sessions, form.preferences.units)}</p></details>) : labels.map((label) => <span key={label} className={`block rounded-lg px-2 py-1.5 text-[11px] font-semibold ${restDay ? "bg-slate-200 text-slate-700" : "bg-secondary text-muted-foreground"}`}>{label}</span>)}</div>
              </div>)}
            </div>
          </div>
          <div className={`mt-7 flex gap-3 border-t border-border pt-6 ${step === "generated" ? "justify-end" : "justify-between"}`}>
            {step === "generated" ? <Badge tone="green"><CheckCircle2 size={14} /> Workouts saved</Badge> : <><Button onClick={() => setStep("refinements")} variant="secondary" testId="button-back-plan-intensity-metrics"><ArrowLeft size={15} /> Back to workout intensity metrics</Button><Button onClick={() => void generate()} disabled={saving || (plan.volumeBasis === "time" && generatedWorkouts.capacityWarnings.length > 0)} testId="button-generate-plan"><Sparkles size={16} /> {saving ? "Generating…" : "Generate workouts & save"}</Button></>}
          </div>
          {step === "generated" && <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Your generated workout prescriptions are saved to this app’s Training calendar on the days you selected. Distance is an optional estimate for display; the plan is built around time.</p>}
        </div>
      )}
    </div>
  );
}

function PlanPage() {
  const { athlete, sessions, saveAthlete, toast } = useApp();
  const plan = athlete.preferences.plan;
  const hasSavedPlan = Boolean(plan.generatedAt);
  const [showPlanBuilder, setShowPlanBuilder] = useState(() => Boolean(readPlanBuilderDraft(athlete.id)));
  const [confirmDeletePlan, setConfirmDeletePlan] = useState(false);
  const [deletingPlan, setDeletingPlan] = useState(false);
  const planBuilderRef = useRef<HTMLDivElement | null>(null);
  const planPageRef = useRef<HTMLDivElement | null>(null);
  const observedGeneratedAt = useRef(plan.generatedAt);
  const closePlanBuilder = useCallback(() => {
    clearPlanBuilderDraft(athlete.id);
    setShowPlanBuilder(false);
    requestAnimationFrame(() => planPageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [athlete.id]);
  const deleteCurrentPlan = async () => {
    setDeletingPlan(true);
    try {
      await saveAthlete({
        ...athlete,
        preferences: {
          ...athlete.preferences,
          plan: { ...defaultPlanPreferences, goalMode: plan.goalMode, generatedAt: null, manualSessions: [] },
        },
      });
      clearPlanBuilderDraft(athlete.id);
      setConfirmDeletePlan(false);
      setShowPlanBuilder(false);
      toast("Current plan deleted.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not delete the current plan.");
    } finally {
      setDeletingPlan(false);
    }
  };
  useEffect(() => {
    if (plan.generatedAt && plan.generatedAt !== observedGeneratedAt.current) closePlanBuilder();
    observedGeneratedAt.current = plan.generatedAt;
  }, [plan.generatedAt, closePlanBuilder]);
  useEffect(() => {
    if (showPlanBuilder) {
      planBuilderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [showPlanBuilder]);
  const sports = ["swim", "bike", "run"] as const;
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weeklyTargets = sports.map((sport) => {
    const target = plan.volumeBasis === "time" ? plan.timeTargets[sport] : plan.distanceTargets[sport];
    const unit = plan.volumeBasis === "time" ? Number(target.weekly) === 1 ? "hour" : "hours" : sport === "swim" ? (athlete.preferences.units === "metric" ? "m" : "yd") : (athlete.preferences.units === "metric" ? "km" : "mi");
    return `${sport} ${target.weekly ?? "—"} ${unit}`;
  }).join(" · ");
  const peakTargets = sports.map((sport) => {
    const target = plan.volumeBasis === "time" ? plan.timeTargets[sport] : plan.distanceTargets[sport];
    const unit = plan.volumeBasis === "time" ? "h" : sport === "swim" ? (athlete.preferences.units === "metric" ? "m" : "yd") : (athlete.preferences.units === "metric" ? "km" : "mi");
    return target.peak === null ? `${sport} auto` : `${sport} ${target.peak} ${unit}`;
  }).join(" · ");
  const workoutBaselines = `${plan.easyRunPaceSecondsPerKm ? `Run ≤ ${formatRunPace(plan.easyRunPaceSecondsPerKm, plan.distanceTargets.run.unit)}` : "Run pace not set"} · ${plan.ftpWatts ? `Bike FTP ${plan.ftpWatts} W` : "FTP not set"} · ${plan.maxHeartRate ? `Max HR ${plan.maxHeartRate} bpm` : "Max HR not set"}`;
  const currentPlanWeek = hasSavedPlan ? planWeekForDate(plan, shift(0), athlete.raceDate) : null;
  const currentCycleStep = currentPlanWeek && (currentPlanWeek.phase === "recovery" || currentPlanWeek.phase === "build")
    ? cyclePositionForWeek(plan.recoveryRhythm, currentPlanWeek.progressionIndex, plan.customBuildWeeks)
    : null;
  const cycleSteps = progressionCycleSteps(plan.recoveryRhythm, plan.recoveryWeekPercent ?? 75, plan.customBuildWeeks);
  const progressionSummary = buildWeeksBeforeRecovery(plan.recoveryRhythm, plan.customBuildWeeks) === null
    ? "No build · weekly schedule repeats"
    : `${buildWeeksBeforeRecovery(plan.recoveryRhythm, plan.customBuildWeeks)} build weeks + recovery · ${plan.weeklyBuildRate ?? 5}% build · ${plan.recoveryWeekPercent ?? 75}% recovery${currentPlanWeek?.phase === "settle-in" ? " · Settle-in week: no increase" : ""}`;

  return (
    <div ref={planPageRef} className="space-y-4">
      <PageHeader eyebrow="Build your future" title="Training plan" />
      {hasSavedPlan ? <section className="space-y-5">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div><p className="mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Current plan settings</p><h2 className="display mt-2 text-2xl">{plan.goalMode === "consistency" ? "Train consistently" : `${athlete.event || "Race"}${athlete.distance ? ` ${athlete.distance === "Half Ironman" ? "70.3" : athlete.distance === "Ironman" ? "140.6" : athlete.distance}` : ""}`}</h2><p className="mt-1 text-sm text-muted-foreground">{plan.goalMode === "consistency" ? "No race date" : athlete.raceDate ? prettyDate(athlete.raceDate) : "No race date set"}{plan.goalMode === "race" && athlete.raceTime ? ` · Goal ${athlete.raceTime}` : ""}</p></div>
            <div className="flex flex-wrap items-center justify-end gap-2 self-end sm:shrink-0">
              <Button onClick={() => setShowPlanBuilder(true)} testId="button-edit-plan"><Pencil size={15} /> Edit plan</Button>
              <Button variant="ghost" onClick={() => setConfirmDeletePlan(true)} testId="button-delete-plan" className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"><Trash2 size={15} /> Delete plan</Button>
            </div>
          </div>
          <div className="mt-6 grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
            <p className="text-sm"><span className="block text-xs text-muted-foreground">Current weekly targets</span><span className="capitalize">{weeklyTargets}</span></p>
            <p className="text-sm"><span className="block text-xs text-muted-foreground">{plan.goalMode === "race" ? "Peak weekly targets" : "Training goal"}</span><span className="capitalize">{plan.goalMode === "race" ? peakTargets : "Maintain a consistent weekly rhythm"}</span></p>
            <p className="text-sm"><span className="block text-xs text-muted-foreground">Progression</span>{progressionSummary}</p>
            <p className="text-sm"><span className="block text-xs text-muted-foreground">Primary focus</span>{plan.primaryFocus === "balanced" ? "Balanced" : `${plan.primaryFocus[0].toUpperCase()}${plan.primaryFocus.slice(1)} focused`}</p>
            <p className="text-sm"><span className="block text-xs text-muted-foreground">Rest days ({plan.restDaysPerWeek}/week)</span>{plan.restDays.join(", ") || "None marked"}</p>
            <p className="text-sm"><span className="block text-xs text-muted-foreground">Weekly schedule</span>{plan.manualSessions.length}/{plan.sessionsPerWeek} available workouts · max {plan.maxSessionMinutes} min each</p>
            <p className="text-sm"><span className="block text-xs text-muted-foreground">Workout baselines</span>{workoutBaselines}</p>
          </div>
          <div className="mt-5 border-t border-border pt-5">
            <div className="mb-3">
              <p className="text-xs font-semibold text-foreground">Progression &amp; recovery</p>
              <p className="text-[11px] text-muted-foreground">{progressionSummary}</p>
            </div>
            <div className={`grid grid-cols-2 gap-2 ${cycleSteps.length === 3 ? "sm:grid-cols-3" : cycleSteps.length === 4 ? "sm:grid-cols-4" : cycleSteps.length === 5 ? "sm:grid-cols-5" : "sm:grid-cols-1"}`} aria-label="Training progression cycle">{cycleSteps.map((step, index) => {
              const isCurrent = currentCycleStep === index;
              return <div key={step.label} aria-current={isCurrent ? "step" : undefined} className={`rounded-lg border px-3 py-2 ${isCurrent ? "border-accent bg-accent/10 ring-1 ring-accent/20" : step.label === "Recovery" ? "border-slate-200 bg-slate-50/80" : "border-border bg-secondary/30"}`}>
                <p className={`text-xs font-semibold ${isCurrent ? "text-primary" : "text-foreground"}`}>{step.label}{isCurrent ? <span className="ml-1.5 text-[10px] font-medium text-muted-foreground">· This week</span> : null}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{step.detail}</p>
              </div>;
            })}</div>
          </div>
          <div className="mt-5 border-t border-border pt-5">
            <p className="mb-3 text-xs font-semibold text-muted-foreground">Weekly schedule</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">{weekdays.map((day) => {
              const daySessions = plan.manualSessions.filter((session) => session.day === day);
              const isRest = plan.restDays.includes(day) && daySessions.length === 0;
              return <div key={day} className={`rounded-lg border p-2 ${isRest ? "border-slate-300 bg-slate-100 text-slate-600" : "border-border bg-secondary/30"}`}>
                <p className="text-[11px] font-bold">{day}</p>
                {daySessions.length ? <div className="mt-1 space-y-2">{daySessions.map((session) => <div key={session.id}><p className="text-xs font-semibold leading-tight">{session.title.replace(/\s+session$/i, "")}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{workoutTargetLabel(plan, session, sessions, athlete.preferences.units)} · {session.intensity}</p></div>)}</div> : <p className="mt-1 text-xs">{isRest ? "Rest" : "Open"}</p>}
              </div>;
            })}</div>
          </div>
        </div>
      </section> : !showPlanBuilder ? <section className="flex min-h-[340px] flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card/80 px-6 py-12 text-center shadow-sm md:min-h-[420px] md:px-12">
        <CalendarDays size={28} className="text-accent" aria-hidden="true" />
        <h2 className="display mt-5 text-3xl md:text-4xl">Let’s start planning</h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Create a training plan that fits your goals, weekly schedule, and availability.</p>
        <Button onClick={() => { clearPlanBuilderDraft(athlete.id); setShowPlanBuilder(true); }} testId="button-create-plan" className="mt-6 min-h-12 px-8"><Sparkles size={16} /> Create plan</Button>
      </section> : null}
      {showPlanBuilder && <div id="plan-builder" ref={planBuilderRef} className="scroll-mt-24"><PlanGoalEditor forceSetup onSaved={closePlanBuilder} onCancel={closePlanBuilder} /></div>}
      <Dialog open={confirmDeletePlan} onOpenChange={(open) => { if (!deletingPlan) setConfirmDeletePlan(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete current plan?</DialogTitle>
            <DialogDescription>This clears the plan settings and workouts generated in this app. Your profile and Intervals.icu workouts are not deleted.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={deletingPlan} onClick={() => setConfirmDeletePlan(false)}>Keep plan</Button>
            <Button variant="danger" disabled={deletingPlan} onClick={() => void deleteCurrentPlan()} testId="button-confirm-delete-plan"><Trash2 size={15} /> {deletingPlan ? "Deleting…" : "Delete plan"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UnitPreferencePanel() {
  const { athlete, saveAthlete, toast } = useApp();
  const [saving, setSaving] = useState(false);
  const units = athlete.preferences.units;
  const updateUnits = async (nextUnits: UnitSystem) => {
    if (nextUnits === units || saving) return;
    const plan = athlete.preferences.plan;
    const factorToMeters: Record<string, number> = { m: 1, km: 1000, yd: 0.9144, mi: 1609.344 };
    const convert = (value: number | null, from: string, to: string) => {
      if (value === null || from === to) return value;
      const converted = value * factorToMeters[from] / factorToMeters[to];
      return Number(converted.toFixed(to === "m" || to === "yd" ? 0 : 1));
    };
    const swimUnit = nextUnits === "metric" ? "m" as const : "yd" as const;
    const distanceUnit = nextUnits === "metric" ? "km" as const : "mi" as const;
    const previousDistances = plan.distanceTargets;
    const distanceTargets = {
      swim: { ...previousDistances.swim, weekly: convert(previousDistances.swim.weekly, previousDistances.swim.unit, swimUnit), peak: convert(previousDistances.swim.peak, previousDistances.swim.unit, swimUnit), unit: swimUnit },
      bike: { ...previousDistances.bike, weekly: convert(previousDistances.bike.weekly, previousDistances.bike.unit, distanceUnit), peak: convert(previousDistances.bike.peak, previousDistances.bike.unit, distanceUnit), unit: distanceUnit },
      run: { ...previousDistances.run, weekly: convert(previousDistances.run.weekly, previousDistances.run.unit, distanceUnit), peak: convert(previousDistances.run.peak, previousDistances.run.unit, distanceUnit), unit: distanceUnit },
    };
    setSaving(true);
    try {
      await saveAthlete({ ...athlete, preferences: { ...athlete.preferences, units: nextUnits, plan: { ...plan, distanceTargets } } });
      toast(`Measurements set to ${nextUnits === "metric" ? "metric" : "imperial"}.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save the measurement setting.");
    } finally {
      setSaving(false);
    }
  };
  const imperial = units === "imperial";
  return <div className="rounded-3xl border border-border bg-card p-4 shadow-sm md:p-5">
    <p className="mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Preferences</p>
    <div className="mt-2 grid gap-5 sm:grid-cols-2 sm:gap-4">
      <div className="min-w-0">
        <h2 className="display text-lg">Measurement units</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Choose metric or imperial units for distances and pace.</p>
        <div className="mt-3 flex items-center gap-2">
          <span className={`text-sm font-semibold ${!imperial ? "text-foreground" : "text-muted-foreground"}`}>Metric</span>
          <button type="button" role="switch" aria-checked={imperial} aria-label="Use imperial measurements" disabled={saving} onClick={() => void updateUnits(imperial ? "metric" : "imperial")} className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${imperial ? "bg-primary" : "bg-slate-300"}`} data-testid="switch-measurement-units">
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${imperial ? "translate-x-6" : "translate-x-1"}`} />
          </button>
          <span className={`text-sm font-semibold ${imperial ? "text-foreground" : "text-muted-foreground"}`}>Imperial</span>
          {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
        </div>
      </div>
      <CalendarBlurPreferencePanel />
    </div>
  </div>;
}

function formatRecoveryDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function ProfilePage() {
  const { athlete, connection, saveAthlete, toast } = useApp();
  const [maxHeartRateInput, setMaxHeartRateInput] = useState(athlete.preferences.plan.maxHeartRate ? String(athlete.preferences.plan.maxHeartRate) : "");
  const [recoveryInput, setRecoveryInput] = useState(() => {
    const recovery = athlete.preferences.plan.runIntervalRecoverySeconds ?? { short: 60, medium: 90, long: 120 };
    return { short: formatRecoveryDuration(recovery.short), medium: formatRecoveryDuration(recovery.medium), long: formatRecoveryDuration(recovery.long) };
  });
  const [easyRunPaceInput, setEasyRunPaceInput] = useState(() => {
    const pace = athlete.preferences.plan.easyRunPaceSecondsPerKm;
    return pace ? formatRunPace(pace, athlete.preferences.plan.distanceTargets.run.unit).replace(/\/(?:mi|km)$/, "") : "";
  });
  const [savingTrainingSettings, setSavingTrainingSettings] = useState(false);
  const [importingMaxHeartRate, setImportingMaxHeartRate] = useState(false);
  const initials = athlete.name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2) || "A";
  const easyPaceUnit: RunPaceUnit = athlete.preferences.plan.distanceTargets.run.unit;
  const easyPaceSecondsPerKm = easyRunPaceInput.trim()
    ? paceSecondsPerKmFromInput(easyRunPaceInput, easyPaceUnit)
    : null;
  const displayedTrainingPaces = getRunTrainingPaces(easyPaceSecondsPerKm, easyPaceUnit);
  const saveTrainingSettings = async (maxHeartRate = maxHeartRateInput, recoveryDraft = recoveryInput) => {
    const parsedMaxHeartRate = maxHeartRate.trim() ? Number(maxHeartRate) : null;
    if (parsedMaxHeartRate !== null && (!Number.isInteger(parsedMaxHeartRate) || parsedMaxHeartRate < 80 || parsedMaxHeartRate > 240)) {
      toast("Enter a max heart rate between 80 and 240 bpm.");
      return false;
    }
    const parseRecovery = (value: string) => {
      const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());
      if (!match) return null;
      const seconds = Number(match[1]) * 60 + Number(match[2]);
      return seconds >= 15 && seconds <= 600 ? seconds : null;
    };
    const short = parseRecovery(recoveryDraft.short);
    const medium = parseRecovery(recoveryDraft.medium);
    const long = parseRecovery(recoveryDraft.long);
    const paceUnit: RunPaceUnit = athlete.preferences.plan.distanceTargets.run.unit;
    const easyRunPaceSecondsPerKm = easyRunPaceInput.trim()
      ? paceSecondsPerKmFromInput(easyRunPaceInput, paceUnit)
      : null;
    if (easyRunPaceInput.trim() && easyRunPaceSecondsPerKm === null) {
      toast(`Enter your easy pace as minutes:seconds per ${paceUnit}, from 2:00 to 30:00.`);
      return false;
    }
    if (short === null || medium === null || long === null) {
      toast("Enter each recovery as minutes:seconds, from 0:15 to 10:00.");
      return false;
    }
    setSavingTrainingSettings(true);
    try {
      const plan = { ...athlete.preferences.plan, maxHeartRate: parsedMaxHeartRate, runIntervalRecoverySeconds: { short, medium, long }, easyRunPaceSecondsPerKm };
      await saveAthlete({ ...athlete, preferences: { ...athlete.preferences, plan } });
      toast("Training settings saved.");
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save training settings.");
      return false;
    } finally {
      setSavingTrainingSettings(false);
    }
  };
  const importMaxHeartRate = async () => {
    setImportingMaxHeartRate(true);
    try {
      const settings = await dataApi.intervalsAthleteSettings();
      if (!settings.maxHeartRate) {
        toast("Intervals.icu did not return a max heart rate. Enter it manually instead.");
        return;
      }
      const value = String(Math.round(settings.maxHeartRate));
      setMaxHeartRateInput(value);
      await saveTrainingSettings(value);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not import max heart rate from Intervals.icu.");
    } finally {
      setImportingMaxHeartRate(false);
    }
  };
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Account" title="Profile" description="View your athlete profile and current training goal." />
      <section className="max-w-3xl">
        <SectionTitle eyebrow="Athlete profile" title="Your training profile" />
        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-600 text-lg font-bold text-slate-200">{initials}</span>
            <div>
              <h2 className="text-lg font-bold">{athlete.name || "Athlete"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{athlete.sport} athlete</p>
            </div>
          </div>
          <div className="mt-6 border-t border-border pt-5">
            <p className="text-xs font-medium text-muted-foreground">Training goal</p>
            <p className="mt-1 text-base font-semibold">{athlete.preferences.plan.goalMode === "consistency" ? "Train consistently" : athlete.distance || "No race distance set"}</p>
            <p className="mt-1 text-sm text-muted-foreground">{athlete.preferences.plan.goalMode === "consistency" ? "Year-round · no target race" : athlete.raceDate ? prettyDate(athlete.raceDate) : "No race date set"}{athlete.preferences.plan.goalMode === "race" && athlete.raceTime ? ` · Goal ${athlete.raceTime}` : ""}</p>
          </div>
          <Link href="/plan" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline" data-testid="link-edit-plan-profile">Edit athlete and training details in Plan <ArrowRight size={15} /></Link>
        </div>
      </section>
      <section className="max-w-3xl">
        <SectionTitle eyebrow="Training settings" title="Workout targets" />
        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
          <div>
            <h2 className="text-base font-bold">Run interval recovery</h2>
            <p className="mt-1 text-sm text-muted-foreground">Set easy-jog recovery by rep length for newly generated run intervals.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {([
                ["short", "Short reps · 1:31–4:30"],
                ["medium", "Medium reps · 4:31–8:00"],
                ["long", "Long reps · 8:01+"],
              ] as const).map(([key, label]) => <label key={key} className="text-xs font-semibold text-muted-foreground">{label}<input aria-label={`${label} recovery`} inputMode="numeric" value={recoveryInput[key]} onChange={(event) => setRecoveryInput((current) => ({ ...current, [key]: event.target.value }))} placeholder="1:00" className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal text-foreground" /></label>)}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Reps of 1:30 or less always get 0:30 recovery. Long reps over 13 minutes use a 3:00 jog.</p>
          </div>
          <div className="mt-6 border-t border-border pt-5">
            <h2 className="text-base font-bold">Running pace targets</h2>
            <p className="mt-1 text-sm text-muted-foreground">Set your adjustable easy pace; estimated training paces are calculated from it. No race result is needed.</p>
            <label htmlFor="easy-run-pace" className="mt-4 block max-w-xs text-xs font-semibold text-muted-foreground">Easy pace · run at or slower than
              <div className="mt-1.5 flex items-center gap-2"><input id="easy-run-pace" type="text" inputMode="numeric" value={easyRunPaceInput} onChange={(event) => setEasyRunPaceInput(event.target.value)} placeholder="9:51" aria-describedby="easy-run-pace-help" data-testid="input-easy-run-pace" className="h-10 w-28 rounded-lg border border-input bg-background px-3 text-sm font-normal text-foreground" /><span className="text-sm">/{easyPaceUnit}</span></div>
            </label>
            <p id="easy-run-pace-help" className="mt-1 text-[11px] text-muted-foreground">Enter minutes:seconds per {easyPaceUnit}. The pace guide is a starting point; adjust it to match your comfortable conversational effort.</p>
            {easyRunPaceInput.trim() && !easyPaceSecondsPerKm && <p role="alert" className="mt-2 text-xs font-medium text-destructive">Enter a pace from 2:00 to 30:00 per {easyPaceUnit}, for example 9:51.</p>}
            <div className="mt-4 divide-y divide-border rounded-xl border border-border px-3">
              {displayedTrainingPaces.map((pace) => <div key={pace.id} className="flex items-center justify-between gap-4 py-2.5 text-sm"><div><p className="font-semibold">{pace.label}</p><p className="text-[11px] text-muted-foreground">{pace.repRange}</p></div><span className={`shrink-0 font-semibold tabular-nums ${easyPaceSecondsPerKm ? "" : "text-muted-foreground"}`}>{pace.formatted}</span></div>)}
            </div>
          </div>
          <div className="mt-6 border-t border-border pt-5">
            <h2 className="text-base font-bold">Heart rate training</h2>
            <p className="mt-1 text-sm text-muted-foreground">Add your max HR to show an approximate aerobic heart-rate guide in easy run prescriptions.</p>
            <label className="mt-4 block max-w-xs text-xs font-semibold text-muted-foreground">Maximum heart rate (bpm)<input type="number" min="80" max="240" step="1" value={maxHeartRateInput} onChange={(event) => setMaxHeartRateInput(event.target.value)} placeholder="e.g. 185" className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal text-foreground" /></label>
            {connection.intervalsConfigured && <Button variant="secondary" onClick={() => void importMaxHeartRate()} disabled={importingMaxHeartRate || savingTrainingSettings} className="mt-3"><HeartPulse size={15} /> {importingMaxHeartRate ? "Importing…" : "Import from Intervals.icu"}</Button>}
          </div>
          <div className="mt-6 flex justify-end border-t border-border pt-5"><Button onClick={() => void saveTrainingSettings()} disabled={savingTrainingSettings || importingMaxHeartRate}><Save size={15} /> {savingTrainingSettings ? "Saving…" : "Save training settings"}</Button></div>
        </div>
      </section>
    </div>
  );
}

type ColorTheme = "lagoon" | "ocean" | "ember" | "dracula";
const COLOR_THEME_KEY = "triathlon-coach-color-theme";
const colorThemeOptions: Array<{ id: ColorTheme; name: string; description: string; colors: [string, string, string] }> = [
  { id: "lagoon", name: "Lagoon", description: "Sea-glass green with cool aqua accents.", colors: ["#244a4d", "#53b6a9", "#eff7f5"] },
  { id: "ocean", name: "Ocean", description: "Cool blue surfaces with a clear aqua accent.", colors: ["#24405c", "#42b8d0", "#f1f6fb"] },
  { id: "ember", name: "Ember", description: "Warm stone surfaces with a muted terracotta accent.", colors: ["#573b39", "#dc846f", "#fbf3ed"] },
  { id: "dracula", name: "Dracula", description: "A dark coding-inspired palette with lavender, cyan, and vivid pink accents.", colors: ["#282a36", "#bd93f9", "#44475a"] },
];

function ColorThemePanel() {
  const [selected, setSelected] = useState<ColorTheme>(() => {
    try {
      const saved = localStorage.getItem(COLOR_THEME_KEY);
      return colorThemeOptions.some((theme) => theme.id === saved) ? saved as ColorTheme : "lagoon";
    } catch { return "lagoon"; }
  });
  const selectTheme = (theme: ColorTheme) => {
    setSelected(theme);
    document.documentElement.dataset.colorTheme = theme;
    try { localStorage.setItem(COLOR_THEME_KEY, theme); } catch { /* The selection still applies for this session. */ }
  };
  return <section className="rounded-3xl border border-border bg-card p-5 shadow-sm md:p-6">
    <p className="mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Appearance</p>
    <h2 className="display mt-2 text-2xl">Interface colors</h2>
    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Choose a coordinated palette for the page backgrounds, panels, buttons, highlights, and navigation.</p>
    <div className="mt-5 grid grid-cols-1 gap-3">
      {colorThemeOptions.map((theme) => <button type="button" key={theme.id} aria-pressed={selected === theme.id} onClick={() => selectTheme(theme.id)} className={`rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 ${selected === theme.id ? "border-accent ring-2 ring-accent/30" : "border-border hover:border-accent/60"}`} data-testid={`button-color-theme-${theme.id}`}>
        <span className="flex h-10 items-center gap-2">
          {theme.colors.map((color, index) => <span key={color} className="h-8 w-8 rounded-full border border-black/10 shadow-sm" style={{ backgroundColor: color, marginLeft: index ? "-0.35rem" : undefined }} />)}
          {selected === theme.id && <CheckCircle2 size={16} className="ml-auto text-primary" />}
        </span>
        <span className="mt-3 block text-sm font-bold">{theme.name}</span>
        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{theme.description}</span>
      </button>)}
    </div>
  </section>;
}

function CalendarBlurPreferencePanel() {
  const { athlete, saveAthlete, toast } = useApp();
  const [saving, setSaving] = useState(false);
  const enabled = athlete.preferences.calendarBlurEnabled;
  const update = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveAthlete({ ...athlete, preferences: { ...athlete.preferences, calendarBlurEnabled: !enabled } });
      toast(`Calendar week blur ${enabled ? "off" : "on"}.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save the calendar display setting.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="min-w-0">
    <h2 className="display text-lg">Blur other calendar weeks</h2>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">In the training calendar, weeks outside the current one stay blurred until you scroll.</p>
    <div className="mt-3 flex items-center gap-3">
      <span className="text-sm font-semibold text-muted-foreground">{enabled ? "On" : "Off"}</span>
      <button type="button" role="switch" aria-checked={enabled} aria-label="Blur other calendar weeks" disabled={saving} onClick={() => void update()} className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${enabled ? "bg-primary" : "bg-slate-300"}`} data-testid="switch-calendar-blur">
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
      </button>
      {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
    </div>
  </div>;
}

function IntervalsCredentialsForm({ configured, athleteId, onSaved }: { configured: boolean; athleteId: string; onSaved: () => void }) {
  const [id, setId] = useState(athleteId === "0" ? "" : athleteId);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (athleteId !== "0") setId(athleteId); }, [athleteId]);
  const save = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setBusy(true); setError(""); setNotice(""); try { await dataApi.saveIntervalsCredentials(id.trim(), key.trim()); setKey(""); setNotice("Intervals.icu connected to your account."); onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save credentials."); } finally { setBusy(false); } };
  const remove = async () => { setBusy(true); setError(""); try { await dataApi.removeIntervalsCredentials(); setId(""); setKey(""); setNotice("Intervals.icu disconnected."); onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove connection."); } finally { setBusy(false); } };
  return <form onSubmit={save} className="mt-3 rounded-2xl border border-border bg-background/60 p-4">
    <h3 className="text-sm font-bold">{configured ? "Update your connection" : "Connect your account"}</h3>
    <div className="mt-3 rounded-xl bg-secondary/60 p-3 text-xs leading-relaxed text-muted-foreground">
      <p className="font-semibold text-foreground">Find your Intervals.icu details</p>
      <ol className="mt-1 list-decimal space-y-1 pl-4">
        <li><a href="https://intervals.icu/settings" target="_blank" rel="noreferrer" className="font-semibold text-primary underline underline-offset-2">Open Intervals.icu Settings</a> and scroll to the bottom.</li>
        <li>Under <strong>Developer Settings</strong>, copy your Athlete ID and create or copy an API key.</li>
        <li>Enter both values below. Keep the leading “i” in your Athlete ID if it appears.</li>
      </ol>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold">Athlete ID<input required value={id} onChange={event=>setId(event.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-normal" placeholder="i12345" autoComplete="off"/></label><label className="text-xs font-semibold">API key<input required={!configured} value={key} onChange={event=>setKey(event.target.value)} type="password" className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-normal" placeholder={configured ? "Enter a new key to replace" : "Paste your personal key"} autoComplete="new-password"/></label></div>
    <div className="mt-3 flex flex-wrap gap-2"><Button type="submit" disabled={busy || !key.trim()}>{busy ? "Saving…" : configured ? "Save new key" : "Connect Intervals.icu"}</Button>{configured && <Button type="button" variant="secondary" disabled={busy} onClick={()=>void remove()}>Disconnect</Button>}</div>
    {notice && <p role="status" className="mt-3 text-xs text-emerald-700">{notice}</p>}{error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
  </form>;
}

function SettingsPage() {
  return <div className="space-y-8">
    <PageHeader eyebrow="Account" title="Settings" description="Personalize the interface, choose measurement units, and manage the services connected to your training data." />
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(16rem,.9fr)]">
      <div className="min-w-0"><ColorThemePanel /></div>
      <div className="min-w-0"><UnitPreferencePanel /></div>
    </div>
    <section className="min-w-0">
      <SectionTitle eyebrow="Data connections" title="Connected services" />
      <ConnectionsPanel />
    </section>
  </div>;
}

function ConnectionsPanel() {
  const { connection, databaseConnected, refresh, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const sync = async () => {
    setBusy(true);
    try {
      await refresh();
      toast("Data refreshed. Check connection status below.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not refresh data.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <div className="grid min-w-0 gap-6">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
          <div className="flex flex-col justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-center">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <Link2 size={21} />
              </span>
              <div>
                <h2 className="text-lg font-bold">Intervals.icu</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {connection.intervalsConfigured ? `Athlete ${connection.athleteId}` : "Required connection not set up"}
                </p>
              </div>
            </div>
            {connection.intervalsConfigured && !connection.intervalsError ? <Badge tone="green"><CheckCircle2 size={13} /> Connected</Badge> : <Badge tone="amber"><Info size={13} /> {connection.intervalsConfigured ? "Needs attention" : "Optional"}</Badge>}
            <Button onClick={() => void sync()} disabled={busy} testId="button-sync-data">
              <RefreshCw size={16} className={busy ? "animate-spin" : ""} /> {busy ? "Syncing…" : "Sync now"}
            </Button>
          </div>
          <div className="grid gap-7 py-7 md:grid-cols-2">
            <div>
              <p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                Supabase · {databaseConnected ? "connected" : "not connected"}
              </p>
              <ul className="mt-4 space-y-3"><li className="flex items-center gap-2 text-sm"><Check size={15} className="text-emerald-600" />Athlete profile and race goals</li><li className="flex items-center gap-2 text-sm"><Check size={15} className="text-emerald-600" />Daily check-ins and recommendation decisions</li></ul>
            </div>
            <div>
              <p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                Intervals.icu · required
              </p>
              <ul className="mt-4 space-y-3"><li className="flex items-center gap-2 text-sm"><Check size={15} className="text-emerald-600" />Planned calendar workouts</li><li className="flex items-center gap-2 text-sm"><Check size={15} className="text-emerald-600" />Completed activities</li><li className="flex items-center gap-2 text-sm text-muted-foreground"><X size={15} />Writing workouts back is not enabled</li></ul>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl bg-secondary/60 p-4">
            <ShieldCheck size={17} className="mt-0.5 text-primary" />
            <p className="text-xs leading-relaxed text-muted-foreground">
Your API key is encrypted before it is saved and only decrypted by the server when syncing your own account. It is never returned to this page.
            </p>
          </div>
          {connection.intervalsError && (
            <p role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              {connection.intervalsError}
            </p>
          )}
          <IntervalsCredentialsForm configured={connection.intervalsConfigured} athleteId={connection.athleteId} onSaved={() => void sync()} />
          {connection.intervalsConfigured && connection.lastSync && (
            <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw size={13} /> Last sync{" "}
              {new Date(connection.lastSync).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>

      </div>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="mx-auto max-w-lg py-24 text-center">
      <p className="mono text-xs uppercase tracking-[.16em] text-muted-foreground">
        404
      </p>
      <h1 className="display mt-4 text-4xl">That trail ends here.</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        The page you’re looking for doesn’t exist in this training space.
      </p>
      <Link
        href="/"
        className="mt-7 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
        data-testid="link-back-home"
      >
        Back to today <ArrowRight size={16} />
      </Link>
    </div>
  );
}

function MerlinBrand({ dark = false }: { dark?: boolean }) {
  const base = import.meta.env.BASE_URL;
  return <div className="flex items-center gap-3" aria-label="Merlin"><img src={`${base}branding/merlin-book-mark-white.png`} alt="" className={`h-9 w-10 object-contain ${dark ? "brightness-0" : ""}`} /><img src={`${base}branding/merlin-wordmark-white.png`} alt="Merlin" className={`h-9 w-28 object-contain object-left ${dark ? "brightness-0" : ""}`} /></div>;
}

function PublicSite() {
  const [path, setPath] = useLocation();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const isSignup = path === "/signup";
  const isLogin = path === "/login";
  const isReset = path === "/reset-password";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      if (isSignup) {
        const result = await signUp(email.trim(), password, name.trim());
        if (!result.session) setMessage("signup-confirmation");
      } else if (isReset && !resettingPassword) {
        await sendPasswordReset(email.trim()); setMessage("If an account exists for that address, a password reset link is on its way.");
      } else if (isReset) {
        await updatePassword(password); await signOut(); setMessage("Password updated. You can sign in with your new password."); setPassword(""); setResettingPassword(false);
      } else { await signIn(email.trim(), password); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not complete that request."); }
    finally { setBusy(false); }
  };
  const inputClass = "mt-2 w-full rounded-xl border border-white/15 bg-white/[.06] px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/40 focus:border-[#8bd0c7] focus:ring-2 focus:ring-[#8bd0c7]/20";
  return <div className="min-h-screen bg-[#111a1b] text-[#f5f8f7]">
    <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 lg:px-10"><Link href="/"><MerlinBrand /></Link>{(isLogin || isSignup || isReset) && <Link href="/" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"><ArrowLeft size={15}/>Back to home</Link>}</header>
    {!isLogin && !isSignup && !isReset ? <main>
      <section className="relative isolate overflow-hidden px-6 pb-20 pt-16 text-center sm:pt-24 lg:pb-28"><div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_10%,rgba(116,190,181,.18),transparent_52%)]"/><h1 className="display mx-auto mt-5 max-w-4xl text-5xl leading-[1.04] tracking-tight sm:text-6xl lg:text-7xl">Train with clarity.</h1><p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/65 sm:text-lg">Merlin helps triathletes at every level plan and adapt training with daily check-ins and training data from Intervals.icu. An Intervals.icu connection is required.</p><div className="mt-9 flex flex-wrap justify-center gap-3"><Link href="/signup" className="rounded-xl bg-[#a9d8d1] px-6 py-3.5 text-sm font-bold text-[#143638] shadow-[0_8px_32px_rgba(115,202,190,.18)] hover:bg-[#c0e5df]">Get started free <ArrowRight className="ml-1 inline" size={16}/></Link><Link href="/login" className="rounded-xl border border-white/15 bg-white/[.04] px-6 py-3.5 text-sm font-semibold text-white hover:bg-white/10">Log in</Link></div><p className="mt-4 text-xs text-white/45">Beta version</p></section>
    </main> : <main className="mx-auto grid min-h-[calc(100vh-80px)] max-w-6xl items-center gap-12 px-6 py-10 lg:grid-cols-[1fr_minmax(22rem,440px)] lg:px-10"><div className="hidden lg:block"><p className="mono text-[11px] uppercase tracking-[.18em] text-[#9bcfc7]">{isSignup ? "Your training, in context" : isReset ? "Account recovery" : "Welcome back"}</p><h1 className="display mt-4 max-w-xl text-5xl leading-tight">{isSignup ? "Build a training rhythm that fits your life." : isReset ? "Get back to your training." : "Your next session is waiting."}</h1></div><section className="w-full rounded-3xl border border-white/10 bg-[#1a2526] p-6 shadow-2xl sm:p-8"><Link href="/" className="lg:hidden"><MerlinBrand/></Link><h2 className="display mt-7 text-3xl">{isSignup ? "Create your account" : isReset ? "Reset your password" : "Log in to Merlin"}</h2><p className="mt-2 text-sm text-white/55">{isSignup ? "Start your free beta account." : isReset ? "Enter your email for a recovery link, or choose a new password from that email." : "Sign in to pick up where you left off."}</p><form onSubmit={submit} className="mt-7 space-y-4">{isSignup && <label className="block text-sm font-medium text-white/85">Name<input required autoComplete="name" value={name} onChange={e=>setName(e.target.value)} className={inputClass} placeholder="Your name"/></label>}<label className="block text-sm font-medium text-white/85">Email<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} className={inputClass} placeholder="you@example.com"/></label>{(!isReset || resettingPassword) && <label className="block text-sm font-medium text-white/85">Password<input required type="password" minLength={8} autoComplete={isSignup ? "new-password" : "current-password"} value={password} onChange={e=>setPassword(e.target.value)} className={inputClass} placeholder={isSignup ? "At least 8 characters" : "Your password"}/></label>}{isReset && <button type="button" onClick={()=>{setResettingPassword(!resettingPassword);setPassword("");}} className="text-xs text-[#a9d8d1]">{resettingPassword ? "Send a reset link instead" : "I have a reset link — set a new password"}</button>}{error && <p role="alert" className="rounded-xl border border-red-300/20 bg-red-950/30 px-3 py-2 text-sm text-red-200">{error}</p>}{message && <p role="status" className="rounded-xl border border-[#a9d8d1]/20 bg-[#a9d8d1]/10 px-3 py-2 text-sm leading-relaxed text-[#c0e5df]">{isSignup && message === "signup-confirmation" ? <>If this email is already registered, <Link href="/login" className="font-semibold underline underline-offset-2">log in</Link> or <Link href="/reset-password" className="font-semibold underline underline-offset-2">reset your password</Link>. Otherwise, check your inbox for a confirmation link.</> : message}</p>}<button disabled={busy||!authConfigured} className="w-full rounded-xl bg-[#a9d8d1] px-4 py-3.5 text-sm font-bold text-[#143638] transition hover:bg-[#c0e5df] disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Please wait…" : isSignup ? "Create account" : isReset ? resettingPassword ? "Update password" : "Send reset link" : "Log in"}</button>{!authConfigured && <p role="alert" className="text-xs text-amber-200">Set the Supabase URL and publishable key in the app environment to enable accounts.</p>}</form><div className="mt-5 flex flex-wrap justify-between gap-3 text-xs"><Link href={isSignup ? "/login" : "/signup"} className="text-[#a9d8d1]">{isSignup ? "Already have an account? Log in" : "New to Merlin? Create an account"}</Link>{isLogin && <Link href="/reset-password" className="text-white/55 hover:text-white">Forgot password?</Link>}{isReset && <Link href="/login" className="text-white/55 hover:text-white">Back to log in</Link>}</div></section></main>}
  </div>;
}

function EmailConfirmationPage() {
  const status = getEmailConfirmationStatus();
  const confirmed = status === "success";
  return (
    <div className="min-h-screen bg-[#111a1b] text-[#f5f8f7]">
      <header className="mx-auto max-w-7xl px-6 py-5 lg:px-10"><Link href="/"><MerlinBrand /></Link></header>
      <main className="flex min-h-[calc(100vh-80px)] items-center justify-center px-6 py-10">
        <section className="w-full max-w-md rounded-3xl border border-white/10 bg-[#1a2526] p-8 text-center shadow-2xl" aria-labelledby="confirmation-heading">
          {confirmed ? <CheckCircle2 className="mx-auto text-[#a9d8d1]" size={48} /> : <Info className="mx-auto text-[#a9d8d1]" size={48} />}
          <h1 id="confirmation-heading" className="display mt-6 text-3xl">{confirmed ? "Email confirmed" : status === "error" ? "Email link unavailable" : status === "unavailable" ? "Couldn’t check confirmation" : "Check your inbox"}</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/65">{confirmed ? "Your email address is verified. You can now log in to Merlin and start your training profile." : status === "error" ? "We couldn’t verify this link. It may have expired or already been used. If you’ve already confirmed your email, you can log in." : status === "unavailable" ? "The confirmation service couldn’t be reached. Your email may already be confirmed. Try logging in, or reopen your email link shortly." : "Open the confirmation link from your signup email to verify your address."}</p>
          <Link href="/login" className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#a9d8d1] px-4 py-3.5 text-sm font-bold text-[#143638] transition hover:bg-[#c0e5df]">Continue to login <ArrowRight size={16} /></Link>
          <Link href="/" className="mt-5 inline-block text-xs text-white/55 hover:text-white">Back to home</Link>
        </section>
      </main>
    </div>
  );
}

function PublicRouter() { return <Switch><Route path="/email-confirmed" component={EmailConfirmationPage}/><Route path="/login" component={PublicSite}/><Route path="/signup" component={PublicSite}/><Route path="/reset-password" component={PublicSite}/><Route component={PublicSite}/></Switch>; }

function App() {
  const [session, setSession] = useState(getSession);
  const [ready, setReady] = useState(false);
  const [recovering, setRecovering] = useState(isPasswordRecovery);
  useEffect(() => { let active = true; void restoreSession().then(value => { if (active) { setSession(value); setReady(true); } }).catch(() => { if (active) setReady(true); }); const update = () => { setSession(getSession()); setRecovering(isPasswordRecovery()); }; window.addEventListener("merlin-auth-change", update); window.addEventListener("storage", update); return () => { active = false; window.removeEventListener("merlin-auth-change", update); window.removeEventListener("storage", update); }; }, []);
  if (!ready) return <div className="grid min-h-screen place-items-center bg-[#111a1b] text-sm text-white/60">Loading Merlin…</div>;
  return session && !recovering ? <AuthenticatedApp/> : <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}><PublicRouter/></WouterRouter>;
}

function Router() {
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/training" component={TrainingPage} />
        <Route path="/calendar" component={TrainingPage} />
        <Route path="/check-in" component={CheckInPage} />
        <Route path="/recommendations" component={RecommendationsPage} />
        <Route path="/plan" component={PlanPage} />
        <Route path="/profile" component={ProfilePage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFoundPage} />
      </Switch>
    </AppShell>
  );
}

function AuthenticatedRoutes() {
  const [location] = useLocation();
  if (["/login", "/signup", "/reset-password"].includes(location)) return <Redirect to="/" />;
  return <Router />;
}

const queryClient = new QueryClient();
function AuthenticatedApp() {
  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLOR_THEME_KEY);
      const theme = colorThemeOptions.some((option) => option.id === saved) ? saved as ColorTheme : "lagoon";
      document.documentElement.dataset.colorTheme = theme;
      if (saved && saved !== theme) localStorage.setItem(COLOR_THEME_KEY, theme);
    } catch { /* Use the default palette when browser storage is unavailable. */ }
  }, []);
  const [athlete, setAthlete] = useState<Athlete>(emptyAthlete);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [wellness, setWellness] = useState<IntervalsWellness[]>([]);
  const [wellnessError, setWellnessError] = useState<string | null>(null);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const refreshedRecoveryRecommendationIds = useRef(new Set<string>());
  const [connection, setConnection] = useState<Connection>({ configured: false, intervalsConfigured: false, athleteId: "0" });
  const [databaseConnected, setDatabaseConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const toast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(""), 2800);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [athleteRecord, goals, checkInRecords, recommendationRecords] = await Promise.all([
        dataApi.athlete(),
        dataApi.goals(),
        dataApi.checkIns(),
        dataApi.recommendations(),
      ]);
      const intervalsResult = await Promise.allSettled([dataApi.intervalsStatus()]);
      const intervalsStatus = intervalsResult[0].status === "fulfilled" ? intervalsResult[0].value : { configured: false, athleteId: "0" };
      const preferredGoalMode = athleteRecord.preferences?.plan?.goalMode;
      const activeGoal = preferredGoalMode
        ? goals.find((goal) => goal.type === preferredGoalMode)
          ?? (preferredGoalMode === "consistency" ? goals.find((goal) => goal.type === "other" && goal.name === "Train consistently") : undefined)
        : goals.find((goal) => goal.type === "race") ?? goals.find((goal) => goal.type === "consistency") ?? goals[0];
      setAthlete(athleteFromRecord(athleteRecord, activeGoal));
      setCheckIns(checkInRecords.map(checkInFromRecord));
      setRecommendations(recommendationRecords.map(recommendationFromRecord));
      setDatabaseConnected(true);

      const [calendarResult, intervalsWellnessResult] = await Promise.allSettled([
        intervalsStatus.configured ? dataApi.intervalsCalendar(shift(-84), shift(180)) : Promise.resolve(null),
        intervalsStatus.configured ? dataApi.intervalsWellness(shift(-180), shift(0)) : Promise.resolve(null),
      ]);
      const calendar = calendarResult.status === "fulfilled" ? calendarResult.value : null;
      const wellnessResponse = intervalsWellnessResult.status === "fulfilled" ? intervalsWellnessResult.value : null;
      const intervalRecords = wellnessResponse?.records ?? [];
      const syncSucceeded = Boolean(calendar || wellnessResponse);
      const wellnessRecords = Array.from(new Map<string, IntervalsWellness>(intervalRecords.map((record) => [record.id, record] as const)).values())
        .filter((record) => Object.entries(record).some(([key, value]) => key !== "id" && value !== null && value !== undefined))
        .sort((a, b) => b.id.localeCompare(a.id));
      setSessions(calendar ? sessionsFromIntervals(calendar.events, calendar.activities) : []);
      setWellness(wellnessRecords);
      setWellnessError(wellnessRecords.length ? null : intervalsStatus.configured ? "No wellness readings are available from Intervals.icu." : "Connect your required Intervals.icu account to sync wellness metrics.");
      setConnection({
        configured: intervalsStatus.configured,
        intervalsConfigured: intervalsStatus.configured,
        athleteId: intervalsStatus.athleteId,
        lastSync: calendar?.syncedAt ?? wellnessResponse?.syncedAt,
        error: intervalsStatus.configured && !syncSucceeded ? "Connected training data could not be reached." : undefined,
        intervalsError: intervalsStatus.configured && !calendar ? "Intervals.icu could not be reached." : undefined,
      });
    } catch (error) {
      setDatabaseConnected(false);
      setLoadError(error instanceof Error ? error.message : "Could not load your Supabase data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveAthlete = async (form: Athlete) => {
    const raceTimeSeconds = form.raceTime.trim() ? parseRaceTime(form.raceTime) : null;
    if (form.raceTime.trim() && raceTimeSeconds === null) {
      throw new Error("Enter goal race time as hours:minutes:seconds, for example 4:30:00.");
    }
    const record = await dataApi.updateAthlete({
      name: form.name.trim(),
      timezone: form.timezone,
      availabilityDays: form.availability,
      preferences: form.preferences,
    });
    let savedGoal: GoalRecord | undefined;
    const goalBody = form.preferences.plan.goalMode === "consistency" ? {
      // The database goal_type enum has no consistency value; store this as an “other” goal.
      type: "other",
      name: "Train consistently",
      targetDate: null,
      targetValue: null,
      targetUnit: null,
      notes: "Year-round training plan without a target race.",
    } : {
      type: "race",
      name: form.event.trim() || (form.distance === "Ironman" ? "Race 140.6" : form.distance === "Half Ironman" ? "Race 70.3" : "Race goal"),
      targetDate: form.raceDate || null,
      targetValue: raceTimeSeconds === null ? null : String(raceTimeSeconds),
      targetUnit: form.distance.trim() || null,
      notes: null,
    };
    const goalModeChanged = form.preferences.plan.goalMode !== athlete.preferences.plan.goalMode;
    if (form.goalId && !goalModeChanged) savedGoal = await dataApi.updateGoal(form.goalId, goalBody);
    else if (goalModeChanged || form.preferences.plan.goalMode === "consistency" || form.event.trim() || form.distance.trim() || form.raceDate || form.raceTime.trim()) savedGoal = await dataApi.createGoal(goalBody);
    const next = athleteFromRecord(record, savedGoal);
    setAthlete(next);
    return next;
  };

  const checkInRecordBody = (form: Omit<CheckIn, "id">): Omit<CheckInRecord, "id"> => ({
    checkInDate: form.timestamp,
    readiness: form.readiness,
    energy: 11 - form.fatigue,
    soreness: form.soreness,
    stress: form.stress,
    sleepQuality: form.sleepQuality,
    sleepDuration: null,
    illnessSignal: form.illness === "None" ? null : form.illness,
    notes: form.note.trim() || null,
  });

  const syncCheckInRecommendation = async (checkIn: CheckIn) => {
    if (recommendations.some((item) => item.checkInId === checkIn.id && item.status === "approved")) return;
    const existing = recommendations.find((item) => item.checkInId === checkIn.id && (item.status === "pending" || item.status === "edited"));
    const todaysCheckIn = checkIn.timestamp === shift(0);
    const candidates = todaysCheckIn ? planSessionsForDates(athlete, [checkIn.timestamp], sessions) : [];
    const unmodifiedCandidates = candidates.filter((item) => !athlete.preferences.plan.workoutOverrides?.some((override) => override.workoutId === item.id));
    const hasReportedSymptom = checkIn.illness !== "None";
    const selectedWorkouts = hasReportedSymptom
      ? unmodifiedCandidates
      : [unmodifiedCandidates.find((item) => item.quality)].filter((item): item is TrainingSession => Boolean(item));
    const recommendationWorkouts = selectedWorkouts.flatMap((workout) =>
      workout.sport === "swim" || workout.sport === "bike" || workout.sport === "run"
        ? [{ ...workout, sport: workout.sport, quality: Boolean(workout.quality) }]
        : [],
    );
    const derived = deriveCheckInRecommendation(checkIn, wellness, recommendationWorkouts);
    if (!derived) {
      if (existing) {
        const dismissed = await dataApi.updateRecommendation(existing.id, { status: "dismissed" });
        const mapped = recommendationFromRecord(dismissed);
        setRecommendations((previous) => previous.map((item) => item.id === mapped.id ? mapped : item));
      }
      return;
    }
    const change: RecommendationChange[] = [
      { field: "summary", to: derived.proposedChange },
      ...derived.overrides.map((override) => ({
        workoutId: override.workoutId,
        field: "workoutOverride",
        from: athlete.preferences.plan.workoutOverrides?.find((item) => item.workoutId === override.workoutId) ?? null,
        to: override,
      })),
    ];
    const body = {
      checkInId: checkIn.id,
      status: "pending" as const,
      title: derived.title,
      reasoning: derived.reasoning,
      proposedChanges: change,
      athleteNotes: derived.athleteNotes,
    };
    const record = existing
      ? await dataApi.updateRecommendation(existing.id, body)
      : await dataApi.createRecommendation(body);
    const mapped = recommendationFromRecord(record);
    setRecommendations((previous) => existing
      ? previous.map((item) => item.id === mapped.id ? mapped : item)
      : [mapped, ...previous]);
  };

  useEffect(() => {
    if (loading) return;
    const outdated = recommendations.filter((recommendation) =>
      (recommendation.status === "pending" || recommendation.status === "edited")
      && recommendation.checkInId
      && (recommendation.proposedChange.startsWith("Replace ")
        || recommendation.evidence.startsWith("Today’s check-in:")
        || recommendation.rationale.includes("wearable data cannot determine what is causing it"))
      && !refreshedRecoveryRecommendationIds.current.has(recommendation.id),
    );
    for (const recommendation of outdated) {
      const checkIn = checkIns.find((item) => item.id === recommendation.checkInId);
      if (!checkIn || checkIn.timestamp !== shift(0)) continue;
      refreshedRecoveryRecommendationIds.current.add(recommendation.id);
      void syncCheckInRecommendation(checkIn).catch(() => {
        toast("Could not refresh the recovery-day recommendation.");
      });
    }
  }, [loading, recommendations, checkIns, syncCheckInRecommendation, toast]);

  const saveCheckIn = async (form: Omit<CheckIn, "id">) => {
    const record = await dataApi.saveCheckIn(checkInRecordBody(form));
    const saved = checkInFromRecord(record);
    setCheckIns((previous) => [saved, ...previous.filter((item) => item.timestamp !== saved.timestamp)]);
    try { await syncCheckInRecommendation(saved); }
    catch { toast("Check-in saved, but its recommendation could not be refreshed."); }
  };

  const updateCheckIn = async (id: string, form: Omit<CheckIn, "id">) => {
    const record = await dataApi.updateCheckIn(id, checkInRecordBody(form));
    const updated = checkInFromRecord(record);
    setCheckIns((previous) => previous.map((item) => item.id === id ? updated : item));
    try { await syncCheckInRecommendation(updated); }
    catch { toast("Check-in updated, but its recommendation could not be refreshed."); }
  };

  const deleteCheckIn = async (id: string) => {
    await dataApi.deleteCheckIn(id);
    setCheckIns((previous) => previous.filter((item) => item.id !== id));
  };

  const updateRecommendation = async (id: string, patch: Partial<RecommendationRecord>) => {
    const updated = await dataApi.updateRecommendation(id, patch);
    const mapped = recommendationFromRecord(updated);
    setRecommendations((previous) => previous.map((item) => item.id === id ? mapped : item));
  };

  const confirmWorkout: AppState["confirmWorkout"] = async (workoutId, date, status) => {
    const currentPlan = athlete.preferences.plan;
    const confirmations = (currentPlan.workoutConfirmations ?? []).filter((item) => item.workoutId !== workoutId);
    confirmations.push({ workoutId, date, status });
    const nextPlan = { ...currentPlan, workoutConfirmations: confirmations };
    await dataApi.updateAthlete({ preferences: { ...athlete.preferences, plan: nextPlan } });
    setAthlete((current) => ({ ...current, preferences: { ...current.preferences, plan: nextPlan } }));
  };

  const setRecommendationOverride = async (id: string, direction: "apply" | "undo") => {
    const recommendation = recommendations.find((item) => item.id === id);
    if (!recommendation) throw new Error("This recommendation is no longer available.");
    const changes = recommendation.proposedChanges.filter((item) => item.field === "workoutOverride");
    if (changes.length === 0) {
      await updateRecommendation(id, { status: direction === "apply" ? "approved" : "pending" });
      return;
    }
    const currentPlan = athlete.preferences.plan;
    const changedWorkoutIds = new Set(changes.map((change) => change.workoutId));
    const nextOverrides = (currentPlan.workoutOverrides ?? []).filter((item) => !changedWorkoutIds.has(item.workoutId));
    for (const change of changes) {
      const target = (direction === "apply" ? change.to : change.from) as PlanWorkoutOverride | null;
      if (target) nextOverrides.push(target);
    }
    const nextPlan = { ...currentPlan, workoutOverrides: nextOverrides };
    await dataApi.updateAthlete({ preferences: { ...athlete.preferences, plan: nextPlan } });
    setAthlete((current) => ({ ...current, preferences: { ...current.preferences, plan: nextPlan } }));
    try {
      await updateRecommendation(id, { status: direction === "apply" ? "approved" : "pending" });
    } catch (error) {
      await dataApi.updateAthlete({ preferences: { ...athlete.preferences, plan: currentPlan } });
      setAthlete((current) => ({ ...current, preferences: { ...current.preferences, plan: currentPlan } }));
      throw error;
    }
  };

  const value: AppState = {
    athlete,
    sessions,
    wellness,
    wellnessError,
    checkIns,
    recommendations,
    connection,
    databaseConnected,
    loading,
    loadError,
    refresh,
    saveAthlete,
    saveCheckIn,
    updateCheckIn,
    deleteCheckIn,
    updateRecommendation,
    confirmWorkout,
    applyRecommendation: (id) => setRecommendationOverride(id, "apply"),
    undoRecommendation: (id) => setRecommendationOverride(id, "undo"),
    toast,
  };
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppData.Provider value={value}>
            {loading ? (
              <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading your training data…</div>
            ) : loadError ? (
              <div className="grid min-h-screen place-items-center p-6"><div className="max-w-md rounded-2xl border border-border bg-card p-6 text-center"><h1 className="display text-2xl">Could not load your data</h1><p className="mt-3 text-sm text-muted-foreground">{loadError}</p><Button onClick={() => void refresh()} variant="secondary" testId="button-retry-data" ><RefreshCw size={15} /> Try again</Button></div></div>
            ) : (
              <AuthenticatedRoutes />
            )}
          </AppData.Provider>
        </WouterRouter>
        <Toaster />
        {toastMessage && (
          <div
            role="status"
            data-testid="status-toast"
            className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-primary px-5 py-3 text-xs font-semibold text-primary-foreground shadow-xl fade-up"
          >
            {toastMessage}
          </div>
        )}
      </TooltipProvider>
    </QueryClientProvider>
  );
}
export default App;
