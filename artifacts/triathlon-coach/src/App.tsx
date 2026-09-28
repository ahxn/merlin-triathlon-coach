import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Link,
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
  Menu,
  MoreHorizontal,
  Mountain,
  Pencil,
  Plus,
  RefreshCw,
  Footprints,
  Save,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ATHLETE_ID, dataApi, type GoalRecord, type CheckInRecord, type IntervalsActivity, type IntervalsEvent, type IntervalsActivityDetails, type IntervalsWorkoutStep, type IntervalsWorkoutValue, type IntervalsWellness, type RecommendationChange, type RecommendationRecord, type PlanPreferences, type PlanWorkoutOverride, type WorkoutConfirmation, type RecoveryRhythm } from "@/lib/data-api";
import { buildInitialWeeklySchedule, generateWeeklyWorkouts } from "@/lib/plan-generator";
import { buildWeeksBeforeRecovery, cyclePositionForWeek, periodizePlannedSession, planWeekForDate, progressionCycleSteps } from "@/lib/periodization";
import { deriveCheckInRecommendation } from "@/lib/recommendations";
import { comparablePerformanceInsights } from "@/lib/performance-comparisons";
import { estimateWorkoutDistance, workoutDescriptionForDisplay, workoutTargetLabel } from "@/lib/workout-display";

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
  athleteId: string;
  lastSync?: string;
  error?: string;
};
const defaultPlanPreferences: PlanPreferences = {
  recoveryRhythm: "3:1",
  goalMode: "race",
  volumeBasis: "time",
  workoutDisplay: "time",
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
  longRunDay: "Sun",
  longBikeDay: "Sat",
  qualityDays: ["Tue"],
  qualitySports: ["bike", "run"],
  restDays: ["Sun"],
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

type PlanBuilderDraftStep = "setup" | "schedule" | "review";
type PlanBuilderDraft = {
  version: 1;
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
    if (draft.version !== 1 || draft.athleteId !== athleteId || !draft.form?.preferences?.plan || !["setup", "schedule", "review"].includes(draft.step)) return null;
    const savedPlan = draft.form.preferences.plan;
    const recoveryRhythm = ["2:1", "3:1", "4:1", "manual"].includes(savedPlan.recoveryRhythm ?? "")
      ? savedPlan.recoveryRhythm!
      : defaultPlanPreferences.recoveryRhythm;
    return {
      ...draft,
      form: {
        ...draft.form,
        preferences: {
          ...draft.form.preferences,
          plan: {
            ...savedPlan,
            weeklyBuildRate: savedPlan.weeklyBuildRate === 7 && !savedPlan.generatedAt ? 5 : savedPlan.weeklyBuildRate ?? defaultPlanPreferences.weeklyBuildRate,
            recoveryRhythm,
          },
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
          quality: slot.quality,
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
        intensity: typeof activity.icu_training_load === "number" ? `Training load ${Math.round(activity.icu_training_load)}` : "Completed in Intervals.icu",
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
        intensity: typeof activity.icu_training_load === "number" ? `Training load ${Math.round(activity.icu_training_load)}` : "Completed in Intervals.icu",
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

const moveLegacyMondayRestPlanToSunday = (plan: PlanPreferences): PlanPreferences => {
  if (plan.restDaysPerWeek !== 1 || plan.restDays.length !== 1 || plan.restDays[0] !== "Mon") return plan;
  const previousDay: Record<string, string> = { Mon: "Sun", Tue: "Mon", Wed: "Tue", Thu: "Wed", Fri: "Thu", Sat: "Fri", Sun: "Sat" };
  return {
    ...plan,
    restDays: ["Sun"],
    manualSessions: plan.manualSessions.map((session) => ({ ...session, day: previousDay[session.day] ?? session.day })),
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
    plan: normalizeFocusedBikeRunDistribution(regeneratePlanFromLegacyExperienceSettings(moveLegacyMondayRestPlanToSunday({
      ...defaultPlanPreferences,
      ...planPreferencesWithoutLegacyExperience(record.preferences?.plan),
      recoveryRhythm: record.preferences?.plan?.recoveryRhythm ?? defaultPlanPreferences.recoveryRhythm,
      goalMode: record.preferences?.plan?.goalMode ?? (goal?.type === "consistency" ? "consistency" : goal?.type === "race" ? "race" : "race"),
      weeklyBuildRate: record.preferences?.plan?.weeklyBuildRate === 7 && !record.preferences?.plan?.generatedAt
        ? 5
        : record.preferences?.plan?.weeklyBuildRate ?? defaultPlanPreferences.weeklyBuildRate,
      workoutDisplay: record.preferences?.plan?.workoutDisplay ?? defaultPlanPreferences.workoutDisplay,
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
    }), record.preferences?.plan)),
  },
  event: goal?.type === "race" ? goal.name : "",
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
    intensity: "Easy / RPE 4",
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
    intensity: "RPE 6",
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
    intensity: "RPE 7",
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
    title: "Easy brick run",
    date: shift(5),
    duration: "22 min",
    distance: "3.5 km",
    intensity: "Easy",
    status: "planned",
  },
  {
    id: "s8",
    sport: "run",
    title: "Easy conversational run",
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
    title: "Keep tomorrow’s run easy",
    trigger: "Readiness trend",
    evidence: "Three-day readiness average is 5.8/10, down from 7.1 last week.",
    proposedChange:
      "Keep tomorrow’s run easy and remove the final progression block.",
    rationale:
      "Protects consistency while keeping the aerobic signal. Revisit after your next check-in.",
    proposedChanges: [{ field: "summary", to: "Keep tomorrow’s run easy and remove the final progression block." }],
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
  const [location] = useLocation();
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
        <div className="mb-6 px-3">
          <Link
            href="/"
            className="flex min-h-[54px] flex-col justify-center rounded-xl border border-dashed border-sidebar-border px-3 py-2 text-sidebar-foreground/55 transition hover:border-sidebar-foreground/35 hover:text-sidebar-foreground/75"
            data-testid="link-brand-placeholder"
          >
            <span className="mono text-[10px] uppercase tracking-[.16em]">Logo + brand</span>
            <span className="mt-1 text-[10px]">Add during branding</span>
          </Link>
        </div>
        <nav className="flex-1">
          {navItems.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              data-testid={`link-${label.toLowerCase().replaceAll(" ", "-")}`}
              className={`nav-link mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${isActive(href) ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm" : "text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"}`}
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
              <p className="text-sm text-sidebar-foreground/80">Intervals.icu {connection.configured ? connection.error ? "needs attention" : "synced" : "not connected"}</p>
              <p className="mt-0.5 text-[10px] leading-tight text-sidebar-foreground/55">
                {connection.lastSync
                  ? `Last sync · ${new Date(connection.lastSync).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                  : connection.error ? "Sync unavailable" : "Waiting for first sync"}
              </p>
            </div>
          </div>
          {accountItems.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              data-testid={`link-${label.toLowerCase().replaceAll(" ", "-")}`}
              className={`nav-link mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${isActive(href) ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"}`}
            >
              <Icon size={17} strokeWidth={1.8} />
              {label}
            </Link>
          ))}
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
  const todaySession =
    sessions.find((s) => s.date === shift(0) && s.status === "planned") ??
    sessions.find((s) => s.date === shift(0)) ??
    plannedWeekSessions.find((s) => s.date === shift(0));
  const todayDistance = todaySession ? formatSessionDistance(todaySession, athlete.preferences.units) : undefined;
  const weekCompleted = weekTrainingSessions.filter((s) => s.status === "completed").length;
  const daysToRace = athlete.raceDate ? Math.max(0, Math.ceil((new Date(`${athlete.raceDate}T12:00:00`).getTime() - today.getTime()) / 86400000)) : null;
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
          <div className="relative flex min-h-[220px] flex-1 flex-col overflow-hidden rounded-2xl bg-primary p-4 text-primary-foreground shadow-lg shadow-primary/10 md:p-5">
            <div className="absolute -right-16 -top-24 h-64 w-64 rounded-full border border-accent/25" />
            <div className="absolute -right-8 -top-16 h-48 w-48 rounded-full border border-accent/20" />
            <div className="relative flex flex-1 flex-col">
              <div className="flex items-center justify-between">
                <Badge tone="coral">Today’s focus</Badge>
                {todaySession?.source === "Weekly plan" && <span className="mono text-[10px] uppercase tracking-[.14em] text-primary-foreground/55">From your weekly plan</span>}
              </div>
              {todaySession ? (
                <>
                  <p className="mt-4 text-[11px] text-primary-foreground/65">
                    Your planned session
                  </p>
                  <h2 className="display mt-1 max-w-md text-2xl">
                    {todaySession.title}
                  </h2>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-primary-foreground/70">
                    <span className="inline-flex items-center gap-2">
                      <Timer size={15} />
                      {todaySession.duration}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <Gauge size={15} />
                      {todaySession.intensity}
                    </span>
                    {todayDistance && <span className="inline-flex items-center gap-2"><Activity size={15} />{todayDistance}</span>}
                  </div>
                  {todaySession.source !== "Weekly plan" && todaySession.notes && <p className="mt-3 max-w-md text-xs leading-relaxed text-primary-foreground/70">{todaySession.notes}</p>}
                  <div className="mt-auto flex flex-wrap gap-2 pt-4">
                    <Link
                      href="/training"
                      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-accent/80 bg-white/5 px-4 text-sm font-semibold text-primary-foreground/90 transition hover:bg-accent/15 hover:text-primary-foreground"
                      data-testid="link-view-calendar"
                    >
                      Full training calendar <ArrowRight size={16} />
                    </Link>
                  </div>
                </>
              ) : isPlanRestDay(athlete, shift(0)) ? (
                <div className="mt-4 rounded-xl border border-white/15 bg-white/10 p-4">
                  <p className="text-xs text-primary-foreground/65">Your weekly plan</p>
                  <h2 className="display mt-1 text-3xl">Rest day</h2>
                  <p className="mt-2 text-sm text-primary-foreground/70">Take it easy today—go for a relaxed walk, stretch a bit, and let your body recharge.</p>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-white/15 bg-white/10 p-4">
                  <p className="text-xs text-primary-foreground/65">{athlete.preferences.plan.generatedAt ? "Your weekly plan" : "Today's schedule"}</p>
                  <h2 className="display mt-1 text-2xl md:text-3xl">Nothing planned today</h2>
                  <p className="mt-2 text-sm text-primary-foreground/70">{athlete.preferences.plan.generatedAt ? "No workout is scheduled for today in your weekly plan or Intervals.icu." : "No workout is scheduled in Intervals.icu today."}</p>
                </div>
              )}
            </div>
          </div>
          <div className="flex-1 rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
            <p className="mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
              The bigger picture
            </p>
            <h2 className="display mt-2 text-2xl">{athlete.preferences.plan.goalMode === "consistency" ? "Consistent training" : athlete.event || "No race goal yet"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{athlete.preferences.plan.goalMode === "consistency" ? "No race date" : athlete.raceDate && daysToRace !== null ? `${prettyDate(athlete.raceDate)} · ${daysToRace} days to go` : "Add a target race in your athlete profile."}</p>
            <div className="mt-4 flex items-end justify-between gap-4 border-t border-border pt-4">
              <div><p className="text-xs font-medium text-muted-foreground">This week</p><p className="display mt-1 text-3xl text-foreground">{weekCompleted}/{weekTrainingSessions.length}</p></div>
              <p className="mb-1 text-right text-xs text-muted-foreground">completed / scheduled</p>
            </div>
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
    { key: "avgSleepingHR", label: "Sleeping heart rate", format: (value) => `${Math.round(value)} bpm`, direction: "higher", family: "cardio" },
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
    const sample = todayWellness.find((record) => finite(record[definition.key]));
    if (!sample) return [];
    const windowStart = shiftDate(today, -30);
    const prior = wellness
      .filter((record) => record.id < today && record.id >= windowStart && finite(record[definition.key]))
      .map((record) => record[definition.key] as number);
    const value = sample[definition.key] as number;
    const average = prior.length >= 7 ? prior.reduce((sum, item) => sum + item, 0) / prior.length : null;
    const sd = average === null ? null : Math.sqrt(prior.reduce((sum, item) => sum + (item - average) ** 2, 0) / prior.length);
    const delta = average === null ? null : value - average;
    const nearAverage = delta !== null && sd !== null && (sd === 0 ? delta === 0 : Math.abs(delta) <= sd);
    const shiftedAdversely = delta !== null && sd !== null && !nearAverage && (definition.direction === "lower" ? delta < 0 : delta > 0);
    const trendStatus = delta !== null ? classifySignalTrend(String(definition.key), delta, nearAverage) : null;
    const deltaText = delta === null ? ""
      : definition.key === "sleepSecs" ? `${Math.round(Math.abs(delta) / 60)} min`
      : definition.key === "restingHR" || definition.key === "avgSleepingHR" ? `${Math.round(Math.abs(delta))} bpm`
      : `${Math.round(Math.abs(delta) * 10) / 10} pts`;
    const change = average === null ? `Building baseline · ${prior.length}/7`
      : nearAverage ? "Near baseline"
      : `${delta! < 0 ? "−" : "+"}${deltaText}${sd && sd > 0 ? ` · ${Math.abs(delta! / sd).toFixed(1)} SD` : ""}${definition.contextOnly ? " · context" : ""}`;
    return [{
      key: definition.key,
      label: definition.label,
      current: definition.format(value),
      baseline: average === null ? "Personal baseline building" : `30-day baseline ${definition.format(average)}`,
      change,
      tone: definition.contextOnly ? "unclear" as const : shiftedAdversely ? "attention" as const : trendStatus?.tone ?? "unclear" as const,
      concern: shiftedAdversely,
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
  let briefText = "Recovery signals are near your usual range.";
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
    text = `${concernNames.join(", ")}${acuteLoadElevated ? ", with acute training load also elevated" : ""} are outside their personal baselines.`;
    matters = "Changes across more than one area are worth noticing, though they do not identify a cause or predict performance. Start conservatively and let your warm-up and how you feel guide the session.";
    briefText = `${concernNames.slice(0, 3).join(", ")}${concernNames.length > 3 ? " and other signals" : ""} shifted from your recent pattern.`;
    briefAdvice = "Start easy and scale the session if the warm-up feels unusually hard.";
  } else if (concernFamilies.size === 1) {
    tone = "caution";
    title = "A recovery signal shifted from your usual range";
    text = `${concernNames.join(", ")} moved outside your personal baseline. One change can have many explanations.`;
    matters = "A single unusual signal may or may not affect training. Use an easy warm-up and adjust the effort if it feels harder than expected.";
    briefText = `${concernNames.join(", ")} is outside your recent pattern.`;
    briefAdvice = "Check how the warm-up feels before pushing the planned effort.";
  } else if (loadOnly) {
    tone = "caution";
    title = "Recent training load is above your usual range";
    text = "Acute load is elevated against your own recent pattern. A planned build can raise load; the number alone does not mean you need to reduce training.";
    matters = "Load is useful context alongside sleep, recovery signals, and how you feel. Follow the plan if recovery and the warm-up feel normal.";
    briefText = "Acute training load is elevated; today’s recovery signals don’t show a separate shift.";
    briefAdvice = "Follow the planned session if you feel good through the warm-up.";
  } else if (!hasTodayInputs || wellnessError || !enoughEvidence) {
    tone = "caution";
    title = todayCheckIn ? "Your check-in is today’s clearest signal" : "Not enough current data to assess today";
    text = wellnessError ? "Wearable data could not be refreshed. Any older readings may not reflect today." : "Only current readings with enough personal history can inform this note; missing or incomplete data does not mean you are ready or unready.";
    matters = "Use how you feel and how the warm-up goes. The app will show only signals that are current and relevant to today’s training decision.";
    briefText = todayCheckIn ? "Your self-report is available; wearable context is limited today." : "Today’s recovery picture is incomplete or still building a baseline.";
    briefAdvice = todayCheckIn ? "Let your check-in and warm-up guide the effort." : "Use your energy and warm-up to guide today’s session.";
  }
  const toneStyle = {
    good: { card: "border-emerald-200 bg-emerald-50/70", icon: "bg-emerald-100 text-emerald-800" },
    caution: { card: "border-amber-200 bg-amber-50/75", icon: "bg-amber-100 text-amber-900" },
    warning: { card: "border-rose-200 bg-rose-50/75", icon: "bg-rose-100 text-rose-900" },
  }[tone];
  return <section className={`rounded-2xl border p-4 shadow-sm md:p-5 ${toneStyle.card}`} aria-labelledby="coach-note-title">
    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
      <div className="flex gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${toneStyle.icon}`}><Sparkles size={17} /></span>
        <div>
          <p className="mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Coach note · {latestWellnessDate ? prettyDate(latestWellnessDate) : "Today"}</p>
          <h2 id="coach-note-title" className="mt-1 text-sm font-bold">{title}</h2>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-muted-foreground">{briefText}</p>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed"><strong className="text-foreground">Try today: </strong><span className="text-muted-foreground">{briefAdvice}</span></p>
        </div>
      </div>
      <div className="ml-12 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 sm:ml-0">
        <button type="button" data-testid="button-coach-note-why" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-controls="coach-note-details" className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-foreground hover:underline">
          {expanded ? "Hide details" : "Get context"}<ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>
    </div>
    {expanded && <div id="coach-note-details" className="mt-4 border-t border-accent/20 pt-4">
      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        <div>
          <h3 className="text-xs font-bold">Signals relevant today</h3>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">Current sleep, recovery, self-report, and load-trend readings inform today’s suggestion. Yesterday’s steps add activity context; VO₂ max, FTP, and weight are longer-term stats, not daily readiness signals.</p>
          {signalBreakdown.length > 0 ? <div className="mt-2 divide-y divide-border/70">{signalBreakdown.map((item) => <div key={item.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-2 py-2 text-[11px]">
            <div className="min-w-0"><p className="truncate font-medium">{item.label}</p><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{item.baseline}</p></div>
            <div className="min-w-0 text-right"><p className="font-semibold text-foreground">{item.current}</p><span className={`mt-0.5 inline-flex max-w-full rounded-full px-2 py-0.5 text-left text-[9px] font-semibold leading-tight ${signalToneClasses[item.tone]}`}>{item.change}</span></div>
          </div>)}</div> : <p className="mt-3 rounded-lg bg-secondary/40 p-3 text-[11px] text-muted-foreground">No current recovery metrics or check-in are available.</p>}
        </div>
        <div className="rounded-xl border border-border/70 bg-card/70 p-3">
          <h3 className="text-xs font-bold">Additional context</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{text}</p>
          <h3 className="mt-3 text-xs font-bold">Why this matters</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{matters}</p>
        </div>
      </div>
      <p className="mt-4 border-t border-accent/20 pt-3 text-[10px] leading-relaxed text-muted-foreground">Personal baselines use earlier readings from the 30 days before today and require at least 7 readings per metric. They describe trends, not medical ranges; the note does not change your plan.</p>
    </div>}
  </section>;
}

type SignalTone = "favorable" | "attention" | "unclear";

const signalToneClasses: Record<SignalTone, string> = {
  favorable: "bg-emerald-50 text-emerald-800",
  attention: "bg-rose-50 text-rose-800",
  unclear: "bg-slate-100 text-slate-700",
};

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
  const { athlete, wellness, wellnessError } = useApp();
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
    const windowStart = shiftDate(sample.id, -30);
    const baseline = wellness
      .filter((record) => record.id < sample.id && record.id >= windowStart && finite(record[key]))
      .map((record) => record[key] as number);
    if (baseline.length < 7) return { sample, value: sample[key] as number, count: baseline.length, average: null as number | null, sd: null as number | null };
    const average = baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
    const sd = Math.sqrt(baseline.reduce((sum, value) => sum + (value - average) ** 2, 0) / baseline.length);
    return { sample, value: sample[key] as number, count: baseline.length, average, sd };
  };
  const formatDelta = (key: string, delta: number) => {
    const absolute = Math.abs(delta);
    const rounded = Math.round(absolute * 10) / 10;
    const amount = key === "sleepSecs" ? `${Math.round(absolute / 60)} min`
      : key === "restingHR" || key === "avgSleepingHR" ? `${Math.round(absolute)} bpm`
      : key === "steps" ? `${Math.round(absolute).toLocaleString()} steps`
      : key === "stress" || key === "fatigue" || key === "soreness" || key === "mood" || key === "motivation" || key === "readiness" ? `${rounded} pts`
      : key === "weight" || key === "tempWeight" ? `${rounded} ${athlete.preferences.units === "imperial" ? "lb" : "kg"}`
      : key === "kcalConsumed" || key === "kcal" ? `${Math.round(absolute)} kcal`
      : key === "spO2" ? `${rounded}%`
      : key === "respiration" ? `${rounded} /min`
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
    { key: "avgSleepingHR", label: "Sleeping heart rate", value: finite(valueFrom("avgSleepingHR")) ? `${Math.round(valueFrom("avgSleepingHR") as number)} bpm` : null, icon: HeartPulse, color: "text-rose-700 bg-rose-50" },
    { key: "vo2max", label: "VO₂ max", value: finite(valueFrom("vo2max")) ? `${(valueFrom("vo2max") as number).toFixed(1)}` : null, icon: Activity, color: "text-sky-700 bg-sky-50" },
    { key: "bikeEftp", label: "Estimated bike FTP", value: finite(bikeEftp) && bikeEftp > 0 ? `${Math.round(bikeEftp)} W` : null, icon: Bike, color: "text-sky-700 bg-sky-50" },
    { key: "ctl", label: "Chronic load", value: finite(valueFrom("ctl")) ? `${Math.round(valueFrom("ctl") as number)}` : null, icon: TrendingUp, color: "text-sky-700 bg-sky-50" },
    { key: "atl", label: "Acute load", value: finite(valueFrom("atl")) ? `${Math.round(valueFrom("atl") as number)}` : null, icon: Zap, color: "text-sky-700 bg-sky-50" },
    { key: "kcalConsumed", label: "Calories consumed", value: finite(valueFrom("kcalConsumed")) ? `${Math.round(valueFrom("kcalConsumed") as number)} kcal` : null, icon: Activity, color: "text-orange-700 bg-orange-50" },
    { key: "readiness", label: "Intervals readiness", value: finite(valueFrom("readiness")) ? `${Math.round(valueFrom("readiness") as number)}` : null, icon: HeartPulse, color: "text-violet-700 bg-violet-50" },
  ].filter((metric) => metric.value !== null);
  const primarySignalOrder = ["sleepSecs", "sleepScore", "hrv", "restingHR"];
  const statOrder = ["ctl", "atl", "steps", "vo2max", "bikeEftp"];
  const otherMetrics = metrics.filter((metric) => ![...primarySignalOrder, ...statOrder].includes(metric.key));
  const hasSignals = primarySignalOrder.some((key) => metrics.some((metric) => metric.key === key));
  const hasStats = statOrder.some((key) => metrics.some((metric) => metric.key === key));
  const trendByKey: Record<string, ReturnType<typeof trendFor>> = Object.fromEntries(
    metrics.map(({ key }) => [key, trendFor(key as keyof IntervalsWellness)]),
  );
  const primarySignalLabels: Record<string, string> = { sleepSecs: "Sleep duration", sleepScore: "Sleep score", hrv: "HRV", restingHR: "Resting HR" };
  const renderPrimarySignal = (key: string) => {
    const metric = metrics.find((item) => item.key === key);
    const label = metric?.label ?? primarySignalLabels[key] ?? key;
    if (!metric) return <div key={key} className="min-h-20 rounded-xl border border-border/80 bg-background p-2" aria-label={`${label} unavailable`}><p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p><p className="mt-2 text-xs text-muted-foreground">No recent reading</p></div>;
    const { value, icon: Icon, color } = metric;
    const trend = trendByKey[key];
    return <div key={key} className="rounded-xl border border-border/80 bg-background p-2">
      <div className="flex items-start justify-between gap-1"><span className="text-[10px] font-medium leading-tight text-muted-foreground">{label === "Resting heart rate" ? "Resting HR" : label}</span><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${color}`}><Icon size={12} /></span></div>
      <p className="mt-1 text-base font-semibold leading-tight tracking-tight">{value}</p>
      {trend?.average !== null && trend?.average !== undefined ? (() => {
        const delta = trend.value - trend.average;
        const nearAverage = trend.sd !== null && (trend.sd === 0 ? delta === 0 : Math.abs(delta) <= trend.sd);
        const trendStatus = classifySignalTrend(key, delta, nearAverage);
        return <div className="mt-1 space-y-0.5"><span className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold ${signalToneClasses[trendStatus.tone]}`}>{trendStatus.label}</span><p className="text-[9px] leading-tight text-muted-foreground">{formatDelta(key, delta)} vs 30-day avg</p></div>;
      })() : <p className="mt-2 text-[9px] leading-tight text-muted-foreground">{trend ? `Building baseline · ${trend.count}/7 days` : "No recent reading"}</p>}
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
      : delta !== null ? `${formatDelta(key, delta)} vs 30-day avg`
      : trend ? `Building baseline · ${trend.count}/7 days` : "No recent trend";
    return <div key={key} className="rounded-xl border border-border/80 bg-background p-2.5">
      <div className="flex items-start justify-between gap-1"><span className="text-[10px] font-medium leading-tight text-muted-foreground">{label}</span><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${color}`}><Icon size={12} /></span></div>
      <p className="mt-1 text-base font-semibold leading-tight tracking-tight">{value}</p>
      <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{context}</p>
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
                const trendLabel = trendStatus?.label ?? (trend ? `Building baseline · ${trend.count}/7 days` : "No recent trend");
                const tone = trendStatus ? signalToneClasses[trendStatus.tone] : "bg-secondary text-secondary-foreground";
                const goalEligible = !["ctl", "atl", "steps", "vo2max"].includes(key);
                const goal = goalEligible ? metricGoals[key] : undefined;
                const goalDelta = trend && goal ? (goal.direction === "atLeast" ? goal.value - trend.value : trend.value - goal.value) : null;
                const goalMet = goalDelta !== null && goalDelta <= 0;
                const goalText = !goal ? "No personal target set" : goalMet ? "Target met" : `${formatDelta(key, Math.abs(goalDelta!)).slice(1)} ${goal.direction === "atLeast" ? "to target" : "over target"}`;
                return <div key={key} className="rounded-xl border border-border/80 bg-background p-3">
                  <div className="flex items-center gap-3"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${color}`}><Icon size={15} /></span><div className="min-w-0"><p className="truncate text-xs text-muted-foreground">{label}</p><p className="text-base font-semibold">{value}</p></div></div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}>{trendLabel}</span>{delta !== null && <span className="text-[10px] text-muted-foreground">{formatDelta(key, delta)} · 30-day baseline</span>}</div>
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
      {!wellnessError && <section className="rounded-2xl border border-border bg-card p-3 shadow-sm md:p-4" aria-labelledby="training-stats-title">
        <p className="mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Training & activity</p>
        <h2 id="training-stats-title" className="display mt-1 text-2xl">Your stats</h2>
        {hasStats
          ? <div className="mt-2 grid grid-cols-2 gap-2">{statOrder.map(renderStat)}</div>
          : <p className="mt-3 rounded-xl border border-dashed border-border bg-background px-4 py-5 text-xs text-muted-foreground">Training stats will appear here when available from Intervals.icu.</p>}
      </section>}
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
  if (density === "compact") return <button type="button" onClick={() => onSelect(s)} aria-label={`View details for ${s.title}`} data-testid={`calendar-session-${s.id}`} className={`flex min-h-0 min-w-0 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${tone}`}>
    <SessionIcon sport={s.sport} compact />
    <span className={`min-w-0 flex-1 truncate text-[11px] font-bold leading-tight ${s.status === "missed" ? "text-red-900" : ""}`}>{displayTitle}</span>
    {statusMark}
  </button>;
  return (
    <button type="button" onClick={() => onSelect(s)} aria-label={`View details for ${s.title}`} data-testid={`calendar-session-${s.id}`} className={`flex h-20 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${tone}`}>
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
  const currentWeekStart = new Date(today);
  currentWeekStart.setHours(12, 0, 0, 0);
  currentWeekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const getWeekDates = (offset: number) => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(currentWeekStart);
    date.setDate(currentWeekStart.getDate() + offset * 7 + index);
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
      <div className="space-y-2">
        {daySessions.length > 1 ? <div className="flex min-w-0 flex-col gap-1.5">{daySessions.map((session) => <CalendarSessionCard key={session.id} session={session} onSelect={setSelectedSession} density="compact" />)}</div>
          : daySessions.length === 1 ? <CalendarSessionCard session={daySessions[0]} onSelect={setSelectedSession} density="normal" />
          : raceDay ? <div className="flex h-20 items-center justify-center rounded-xl bg-accent/10 text-center text-xs font-semibold text-accent-foreground">Race day</div>
          : restDay ? <div className="flex h-20 items-center justify-center rounded-xl bg-slate-100 text-center text-xs font-semibold text-slate-600" data-testid={`calendar-rest-${day}`}>Rest day</div>
          : <div className={`flex h-20 items-center justify-center rounded-xl text-center text-xs ${isPastDay ? "bg-secondary/35 text-muted-foreground" : "border border-dashed border-border bg-white/40 text-muted-foreground"}`}>{isPastDay ? "No session" : "Unplanned"}</div>}
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
          <span className="inline-flex items-center gap-2 text-[11px] font-semibold text-muted-foreground"><ChevronUp size={14} className="text-accent-foreground" /> Previous weeks</span>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button onClick={scrollToCurrent} variant="secondary" testId="button-jump-today"><CalendarDays size={16} /> Today</Button>
          </div>
        </div>
        <div ref={calendarScrollRef} onScroll={handleCalendarScroll} onWheel={handleCalendarInput} onTouchMove={handleCalendarInput} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-y-contain p-3">
          {weekEntries.map(({ offset, days }) => <section key={days[0]} ref={offset === 0 ? currentWeekRef : undefined} className={`rounded-2xl p-3 transition-[filter,opacity] duration-700 ${offset === 0 ? "bg-secondary/20" : "bg-transparent"} ${athlete.preferences.calendarBlurEnabled && !calendarHasMoved && offset !== 0 ? "blur-[2px] opacity-60" : "blur-0 opacity-100"}`}>
            <div className={`mb-3 flex items-center gap-3 ${offset === 0 ? "justify-between" : "justify-end"}`}>{offset === 0 && <p className="text-xs font-bold">Current week</p>}<p className="text-xs text-muted-foreground">Week {isoWeekNumber(days[0])}{weekPhaseLabel(days) ? ` · ${weekPhaseLabel(days)}` : ""}</p></div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-7">{days.map((day) => renderDay(day))}</div>
          </section>)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 text-[11px] font-semibold text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-normal">
            <span className="flex items-center gap-2"><X size={14} className="text-red-700" /> Missed</span>
            <span className="flex items-center gap-2"><CheckCircle2 size={14} className="text-emerald-600" /> Completed</span>
            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-400" /> Pending</span>
            <span className="flex items-center gap-2"><Info size={14} /> Select a session to view workout details</span>
            {!connection.configured && <span className="text-amber-700">Add your Intervals.icu API key in the local .env file to load workouts.</span>}
          </div>
          <span className="flex shrink-0 items-center gap-2">Upcoming weeks<ChevronDown size={14} className="text-accent-foreground" /></span>
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
            <div className="rounded-xl bg-secondary/60 p-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{selectedSession.source === "Weekly plan" ? "Distance estimate" : "Distance"}</p><p className="mt-1 text-sm font-semibold">{selectedSession.source === "Weekly plan" && (athlete.preferences.plan.workoutDisplay ?? "time") === "time" ? "Hidden" : selectedSession.plannedDistanceMeters !== undefined && selectedSession.source === "Weekly plan" ? `${selectedSession.plannedDistanceIsEstimate ? "~" : ""}${formatDistance(selectedSession.plannedDistanceMeters, athlete.preferences.units, selectedSession.sport) ?? "—"}` : formatSessionDistance(selectedSession, athlete.preferences.units) || "—"}</p></div>
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
          {selectedSession.source === "Weekly plan" && <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">This is a sport and day from your weekly plan. The detailed workout prescription has not been generated yet.</p>}
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

function CheckInRecommendationPanel({ checkIn }: { checkIn: CheckIn }) {
  const { recommendations, applyRecommendation, undoRecommendation, toast } = useApp();
  const [saving, setSaving] = useState(false);
  const recommendation = recommendations.find((item) => item.checkInId === checkIn.id && (item.status === "pending" || item.status === "edited" || item.status === "approved"));
  if (!recommendation) return null;
  const applied = recommendation.status === "approved";
  const accept = async () => {
    setSaving(true);
    try { await applyRecommendation(recommendation.id); toast("Recommendation applied to your plan."); }
    catch (error) { toast(error instanceof Error ? error.message : "Could not apply this recommendation."); }
    finally { setSaving(false); }
  };
  const undo = async () => {
    setSaving(true);
    try { await undoRecommendation(recommendation.id); toast("Plan change undone."); }
    catch (error) { toast(error instanceof Error ? error.message : "Could not undo this plan change."); }
    finally { setSaving(false); }
  };
  return <section className="rounded-2xl border border-accent/30 bg-card p-5 shadow-sm" aria-labelledby="checkin-recommendation-title">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div className="flex gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-800"><Sparkles size={17} /></span><div>
        <div className="flex flex-wrap items-center gap-2"><p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">Today’s suggestion</p><Badge tone={applied ? "green" : "amber"}>{applied ? "Applied" : "For your review"}</Badge></div>
        <h2 id="checkin-recommendation-title" className="mt-1 text-sm font-bold">{recommendation.proposedChange}</h2>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{recommendation.rationale}</p>
        <p className="mt-2 text-[11px] leading-relaxed"><span className="font-semibold">Signals used: </span><span className="text-muted-foreground">{recommendation.evidence}</span></p>
      </div></div>
      {recommendation.proposedChanges.some((change) => change.field === "workoutOverride") && <div className="flex shrink-0 gap-2">
        {applied ? <Button variant="secondary" disabled={saving} onClick={() => void undo()}><ArrowLeft size={14} /> Undo</Button> : <Button disabled={saving} onClick={() => void accept()}><Check size={15} /> {saving ? "Applying…" : "Apply change"}</Button>}
      </div>}
    </div>
  </section>;
}

function CheckInPage() {
  const { checkIns, saveCheckIn, updateCheckIn, deleteCheckIn, toast } = useApp();
  const latest = checkIns[0];
  const todayCheckIn = checkIns.find((item) => item.timestamp === shift(0));
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
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
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
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-50 text-orange-700">
              <HeartPulse size={18} />
            </span>
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
      {todayCheckIn && <CheckInRecommendationPanel checkIn={todayCheckIn} />}
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
  const [editing, setEditing] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
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
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={r.status === "edited" ? "blue" : "coral"}>{r.status === "edited" ? "Edited" : "Pending"}</Badge>
                    <span className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                      {r.trigger}
                    </span>
                  </div>
                  <h2 className="display mt-4 max-w-2xl text-2xl">
                    {r.proposedChange}
                  </h2>
                </div>
                <div className="flex shrink-0 gap-2">
                    <Button
                      onClick={() => void decide(r.id, "approved")}
                      disabled={saving}
                    testId={`button-approve-${r.id}`}
                  >
                    <Check size={16} /> {r.proposedChanges.some((change) => change.field === "workoutOverride") ? "Apply change" : "Accept"}
                  </Button>
                    <IconButton
                      label={`edit recommendation ${r.id}`}
                      onClick={() => { setEditing(editing === r.id ? null : r.id); setEditingText(r.proposedChange); }}
                  >
                    <Pencil size={16} />
                  </IconButton>
                    <IconButton
                      label={`dismiss recommendation ${r.id}`}
                      onClick={() => void decide(r.id, "dismissed")}
                  >
                    <X size={17} />
                  </IconButton>
                </div>
              </div>
              {editing === r.id && (
                <div className="mt-5 rounded-xl border border-accent/30 bg-orange-50/50 p-4">
                  <label className="text-xs font-bold uppercase tracking-wide text-orange-800">
                    Edit before approval
                  </label>
                  <textarea
                    value={editingText}
                    onChange={(event) => setEditingText(event.target.value)}
                    data-testid={`input-edit-recommendation-${r.id}`}
                    className="mt-2 w-full rounded-lg border border-orange-200 bg-card p-3 text-sm outline-none focus:border-accent"
                    rows={2}
                  />
                  <div className="mt-3 flex justify-end">
                    <Button
                      onClick={async () => {
                        const changes = r.proposedChanges.length
                          ? r.proposedChanges.map((change, index) => index === 0 ? { ...change, to: editingText } : change)
                          : [{ field: "summary", to: editingText }];
                        setSaving(true);
                        try {
                          await updateRecommendation(r.id, { status: "edited", proposedChanges: changes });
                          setEditing(null);
                          toast("Edit saved. Apply it separately when ready.");
                        } catch (error) {
                          toast(error instanceof Error ? error.message : "Could not save the edit.");
                        } finally {
                          setSaving(false);
                        }
                      }}
                      disabled={saving || !editingText.trim()}
                      variant="secondary"
                      testId={`button-save-edit-${r.id}`}
                    >
                      <Save size={15} /> Keep edit
                    </Button>
                  </div>
                </div>
              )}
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
    const peak = existing.peak ?? (weekly === null ? null : plan.goalMode === "race" ? Number((weekly * distanceRatio).toFixed(1)) : weekly);
    return [sport, { weekly, peak }];
  })) as PlanPreferences["timeTargets"];
  return { ...plan, volumeBasis: "time", timeTargets };
}

function PlanGoalEditor({ forceSetup = false, onSaved, onCancel }: { forceSetup?: boolean; onSaved?: () => void; onCancel?: () => void }) {
  const { athlete, sessions, saveAthlete, toast } = useApp();
  const initialDraft = readPlanBuilderDraft(athlete.id);
  const [form, setForm] = useState(() => {
    const initial = initialDraft?.form ?? athlete;
    return { ...initial, preferences: { ...initial.preferences, units: athlete.preferences.units, plan: { ...timeBasedPlan(initial.preferences.plan), workoutDisplay: "time" as const, distanceTargets: distanceTargetsForUnits(initial.preferences.plan, athlete.preferences.units) } } };
  });
  const [maxSessionMinutesInput, setMaxSessionMinutesInput] = useState(() => initialDraft?.maxSessionMinutesInput ?? String(athlete.preferences.plan.maxSessionMinutes ?? 0));
  const [step, setStep] = useState<"setup" | "schedule" | "review" | "generated">(() => initialDraft?.step ?? (forceSetup ? "setup" : athlete.preferences.plan.generatedAt ? "generated" : "setup"));
  const [saving, setSaving] = useState(false);
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
  const plan = form.preferences.plan;
  const generatedWorkouts = useMemo(() => generateWeeklyWorkouts(plan, sessions), [plan, sessions]);
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const updatePlan = (patch: Partial<PlanPreferences>) => setForm({
    ...form,
    preferences: { ...form.preferences, plan: { ...plan, ...patch } },
  });
  const updateWorkoutDisplay = (workoutDisplay: PlanPreferences["workoutDisplay"]) => {
    updatePlan({ workoutDisplay });
    if (step === "generated") {
      void saveAthlete({ ...form, preferences: { ...form.preferences, plan: { ...plan, workoutDisplay } } })
        .catch((error) => toast(error instanceof Error ? error.message : "Could not save workout display."));
    }
  };

  useEffect(() => {
    const draft = forceSetup ? readPlanBuilderDraft(athlete.id) : null;
    if (draft) {
      const draftPlan = timeBasedPlan(draft.form.preferences.plan);
      const hasStackedSport = draftPlan.manualSessions.some((session) => {
        const sameDay = draftPlan.manualSessions.filter((item) => item.day === session.day);
        return sameDay.length > 2 || sameDay.some((item) => item.id !== session.id && item.sport === session.sport);
      });
      const planForBuilder = draft.step !== "setup" && hasStackedSport
        ? { ...draftPlan, manualSessions: buildInitialWeeklySchedule(draftPlan) }
        : draftPlan;
      setForm({ ...draft.form, preferences: { ...draft.form.preferences, units: athlete.preferences.units, plan: { ...planForBuilder, workoutDisplay: "time" as const, distanceTargets: distanceTargetsForUnits(draft.form.preferences.plan, athlete.preferences.units) } } });
      setMaxSessionMinutesInput(draft.maxSessionMinutesInput);
      setStep(draft.step);
      return;
    }
    setForm({ ...athlete, preferences: { ...athlete.preferences, plan: { ...timeBasedPlan(athlete.preferences.plan), workoutDisplay: "time" as const, distanceTargets: distanceTargetsForUnits(athlete.preferences.plan, athlete.preferences.units) } } });
    setMaxSessionMinutesInput(String(athlete.preferences.plan.maxSessionMinutes ?? 0));
    setStep(forceSetup ? "setup" : athlete.preferences.plan.generatedAt ? "generated" : "setup");
  }, [athlete, forceSetup]);

  useEffect(() => {
    if (step === "generated") {
      clearPlanBuilderDraft(athlete.id);
      return;
    }
    writePlanBuilderDraft({ version: 1, athleteId: athlete.id, form, maxSessionMinutesInput, step });
  }, [athlete.id, form, maxSessionMinutesInput, step]);

  const validationMessage = (includeSchedule = true) => {
    if (plan.goalMode === "race" && !form.raceDate) return "Add a race date before reviewing the plan.";
    if (plan.goalMode === "race" && !form.distance) return "Choose a race distance before reviewing the plan.";
    for (const sport of ["swim", "bike", "run"] as const) {
      const targets = plan.volumeBasis === "time" ? plan.timeTargets[sport] : plan.distanceTargets[sport];
      const measure = plan.volumeBasis === "time" ? "hours" : "distance";
      if (targets.weekly === null || targets.weekly <= 0) return `Enter a current weekly ${sport} ${measure} target above zero.`;
      if (plan.goalMode === "race" && (targets.peak === null || targets.peak < targets.weekly)) return `Peak weekly ${sport} ${measure} must be at least its current target.`;
    }
    if (plan.recoveryRhythm !== "manual" && (plan.weeklyBuildRate === null || plan.weeklyBuildRate < 0 || plan.weeklyBuildRate > 10)) return "Enter a build rate between 0% and 10% per build week.";
    if (!maxSessionMinutesInput.trim() || !Number.isFinite(Number(maxSessionMinutesInput)) || Number(maxSessionMinutesInput) < 1 || Number(maxSessionMinutesInput) > 600) return "Enter a workout time limit between 1 and 600 minutes.";
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
      if (generatedWorkouts.capacityWarnings.length > 0 && plan.volumeBasis === "time") return "Adjust your weekly targets or schedule so each sport fits the available session time.";
    }
    return null;
  };

  const continueToSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    const message = validationMessage(false);
    if (message) {
      toast(message);
      return;
    }
    updatePlan({ manualSessions: buildInitialWeeklySchedule(plan) });
    setStep("schedule");
  };

  const review = () => {
    const message = validationMessage();
    if (message) {
      toast(message);
      return;
    }
    setStep("review");
  };

  const generate = async () => {
    const message = validationMessage();
    if (message) {
      toast(message);
      setStep(generatedWorkouts.capacityWarnings.length > 0 ? "schedule" : "setup");
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
  const weeksToRace = form.raceDate
    ? Math.max(0, Math.ceil((new Date(`${form.raceDate}T12:00:00`).getTime() - Date.now()) / (7 * 24 * 60 * 60 * 1000)))
    : null;
  const sports = ["swim", "bike", "run"] as const;
  const currentVolumeSummary = sports.map((sport) => {
    const target = plan.volumeBasis === "time" ? plan.timeTargets[sport] : plan.distanceTargets[sport];
    const unit = plan.volumeBasis === "time" ? "h" : sport === "swim" ? (form.preferences.units === "metric" ? "m" : "yd") : (form.preferences.units === "metric" ? "km" : "mi");
    return `${sport} ${target.weekly ?? "—"} ${unit}`;
  }).join(" · ");
  const peakVolumeSummary = sports.map((sport) => {
    const target = plan.volumeBasis === "time" ? plan.timeTargets[sport] : plan.distanceTargets[sport];
    const unit = plan.volumeBasis === "time" ? "h" : sport === "swim" ? (form.preferences.units === "metric" ? "m" : "yd") : (form.preferences.units === "metric" ? "km" : "mi");
    return `${sport} ${target.peak ?? "—"} ${unit}`;
  }).join(" · ");
  const currentTimeTotal = sports.reduce((total, sport) => total + (plan.timeTargets[sport].weekly ?? 0), 0);
  const peakTimeTotal = sports.reduce((total, sport) => total + (plan.timeTargets[sport].peak ?? 0), 0);

  return (
    <div className="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
      {step === "setup" ? (
        <form onSubmit={continueToSchedule}>
          <SectionTitle eyebrow="Plan builder · 1 of 3" title={forceSetup ? "Create or rebuild your plan" : "Plan setup"} action={onCancel ? <Button onClick={onCancel} variant="ghost" testId="button-cancel-plan-builder"><X size={15} /> Cancel</Button> : undefined} />
          <p className="mb-6 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Choose an event to build toward or set up a year-round consistency plan. Then choose your weekly swim, bike, and run targets and lay out your typical week.
          </p>
          <div className="mb-5 rounded-2xl border border-border p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">What are you training for?</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {[{ value: "race" as const, title: "A race or event", description: "Build toward a date with a gradual peak." }, { value: "consistency" as const, title: "Train consistently", description: "Maintain a sustainable weekly rhythm without a race date." }].map((option) => <button type="button" key={option.value} aria-pressed={plan.goalMode === option.value} onClick={() => setForm((current) => ({
                ...current,
                ...(option.value === "consistency" ? { event: "", distance: "", raceDate: "", raceTime: "" } : {}),
                preferences: { ...current.preferences, plan: { ...current.preferences.plan, goalMode: option.value } },
              }))} className={`rounded-xl border p-4 text-left transition ${plan.goalMode === option.value ? "border-accent bg-orange-50/70" : "border-border hover:border-accent/50"}`}>
                <span className="block text-sm font-bold">{option.title}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{option.description}</span>
              </button>)}
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {plan.goalMode === "race" && <>
            <div>
              <label htmlFor="plan-race-date" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Race date</label>
              <input id="plan-race-date" type="date" value={form.raceDate} onChange={(e) => setForm({ ...form, raceDate: e.target.value })} data-testid="input-plan-race-date" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
            </div>
            <div>
              <label htmlFor="plan-race-time" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Goal race time</label>
              <input id="plan-race-time" value={form.raceTime} onChange={(e) => setForm({ ...form, raceTime: e.target.value })} data-testid="input-plan-race-time" type="text" inputMode="numeric" placeholder="4:30:00" pattern="\d{1,3}:[0-5]\d:[0-5]\d" title="Use hours:minutes:seconds, for example 4:30:00." className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent" />
              <p className="mt-1 text-[11px] text-muted-foreground">Hours:minutes:seconds · optional</p>
            </div>
            <div>
              <label htmlFor="plan-distance" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Race distance</label>
              <select id="plan-distance" value={form.distance} onChange={(e) => setForm({ ...form, distance: e.target.value })} data-testid="input-plan-distance" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent">
                <option value="">Select a distance</option>
                <option value="Half Ironman">Half Ironman (70.3)</option>
                <option value="Ironman">Ironman (140.6)</option>
              </select>
            </div>
            </>}
            <div className="md:col-span-2 rounded-2xl border border-border p-5">
              <div className="mb-4 border-b border-border pb-4">
                <p className="text-sm font-bold">{plan.goalMode === "race" ? "Weekly targets by sport" : "Typical weekly targets by sport"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{plan.goalMode === "race" ? "Set weekly training time for each sport; the plan builds toward your peak." : "Set a sustainable weekly training-time target for each sport."}</p>
              </div>
              <div className="grid gap-4 md:grid-cols-3">{sports.map((sport) => {
                const target = plan.timeTargets[sport];
                return <div key={sport} className="rounded-xl bg-secondary/40 p-4">
                  <p className="text-sm font-bold capitalize">{sport}</p>
                  <label htmlFor={`volume-${sport}`} className="mt-3 block text-[11px] font-semibold text-muted-foreground">{plan.goalMode === "race" ? "Starting weekly target (hours)" : "Weekly target (hours)"}</label>
                  <input id={`volume-${sport}`} type="number" min="0.1" step="0.1" value={target.weekly ?? ""} onChange={(e) => updatePlan({ timeTargets: { ...plan.timeTargets, [sport]: { ...target, weekly: e.target.value ? Number(e.target.value) : null } } })} data-testid={`input-current-${sport}-time`} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm hide-number-controls" />
                  {plan.goalMode === "race" && <>
                    <label htmlFor={`peak-${sport}`} className="mt-3 block text-[11px] font-semibold text-muted-foreground">Peak weekly target (hours)</label>
                    <input id={`peak-${sport}`} type="number" min="0.1" step="0.1" value={target.peak ?? ""} onChange={(e) => updatePlan({ timeTargets: { ...plan.timeTargets, [sport]: { ...target, peak: e.target.value ? Number(e.target.value) : null } } })} data-testid={`input-peak-${sport}-time`} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm hide-number-controls" />
                  </>}
                </div>;
              })}</div>
              <p className="mt-3 text-[11px] text-muted-foreground">After generating your plan, you can switch the workout display to estimated distances.</p>
            </div>
            <section className="md:col-span-2 rounded-2xl border border-border p-5">
              <div className="mb-4"><p className="text-sm font-bold">Progression &amp; recovery</p><p className="mt-1 text-xs text-muted-foreground">Set build rate and recovery rhythm.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="plan-recovery-rhythm" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Build and recovery</label>
                  <select id="plan-recovery-rhythm" value={plan.recoveryRhythm} onChange={(e) => updatePlan({ recoveryRhythm: e.target.value as RecoveryRhythm })} data-testid="select-recovery-rhythm" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm">
                    <option value="2:1">2 build weeks, then recovery</option>
                    <option value="3:1">3 build weeks, then recovery (recommended)</option>
                    <option value="4:1">4 build weeks, then recovery</option>
                    <option value="manual">Manual · repeat weekly schedule</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="plan-build-rate" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Build rate (%/week) · 5% suggested</label>
                  <input id="plan-build-rate" type="number" min="0" max="10" step="0.5" disabled={plan.recoveryRhythm === "manual"} value={plan.weeklyBuildRate ?? ""} onChange={(e) => updatePlan({ weeklyBuildRate: e.target.value === "" ? null : Number(e.target.value) })} data-testid="input-weekly-build-rate" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm hide-number-controls disabled:opacity-50" />
                </div>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">{plan.recoveryRhythm === "manual"
                ? "Repeats your weekly schedule without automatic progression."
                : `+${plan.weeklyBuildRate ?? 5}% per build week, capped at your ${plan.goalMode === "race" ? "peak" : "weekly"} target. Recovery weeks use ~75% of prior volume.`}</p>
            </section>
            <section className="md:col-span-2 rounded-2xl border border-border p-5">
              <div className="mb-4"><p className="text-sm font-bold">Weekly structure</p><p className="mt-1 text-xs text-muted-foreground">Set your training emphasis and how many sessions fit your week.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="plan-primary-focus" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Primary focus</label>
                  <select id="plan-primary-focus" value={plan.primaryFocus} onChange={(e) => updatePlan({ primaryFocus: e.target.value as PlanPreferences["primaryFocus"] })} data-testid="select-primary-focus" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="balanced">Balanced</option><option value="swim">Swim focused</option><option value="bike">Bike focused</option><option value="run">Run focused</option></select>
                  <p className="mt-1 text-[11px] text-muted-foreground">Emphasize one sport while keeping all three in your week.</p>
                </div>
                <div>
                  <label htmlFor="plan-sessions-per-week" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Available sessions per week</label>
                  <select id="plan-sessions-per-week" value={plan.sessionsPerWeek ?? 6} onChange={(e) => updatePlan({ sessionsPerWeek: Number(e.target.value) })} data-testid="select-sessions-per-week" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm">
                    {Array.from({ length: 12 }, (_, index) => index + 3).map((count) => <option key={count} value={count}>{count} sessions</option>)}
                  </select>
                  <p className="mt-1 text-[11px] text-muted-foreground">We’ll draft this many workouts across your week.</p>
                </div>
                <div>
                  <label htmlFor="plan-rest-days-per-week" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Rest days per week</label>
                  <select id="plan-rest-days-per-week" value={plan.restDaysPerWeek ?? plan.restDays.length} onChange={(e) => {
                    const count = Number(e.target.value);
                    const preferenceOrder = ["Sun", "Mon", "Wed", "Fri", "Tue", "Thu", "Sat"];
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
                  <label htmlFor="plan-max-session-minutes" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Maximum time available per workout</label>
              <div className="relative mt-2">
                <input id="plan-max-session-minutes" type="number" min={1} max={600} step={1} value={maxSessionMinutesInput} onFocus={(e) => e.currentTarget.select()} onChange={(e) => {
                  const value = e.target.value;
                  setMaxSessionMinutesInput(value);
                  if (value.trim() && Number.isFinite(Number(value))) updatePlan({ maxSessionMinutes: Number(value) });
                }} data-testid="input-max-session-minutes" className="h-11 w-full rounded-lg border border-input bg-background px-3 pr-20 text-sm hide-number-controls" />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">minutes</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">This is an availability ceiling, not a target duration. Workouts can be shorter based on sport and weekly volume.</p>
                </div>
              </div>
              <p className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground">Workout intervals use sport-specific defaults: swim by distance, bike and run by time. Balanced plans prioritize bike intervals and try to leave recovery between interval days.</p>
            </section>
          </div>
          <div className="mt-8 flex justify-end"><Button type="submit" testId="button-build-weekly-schedule"><ArrowRight size={16} /> Build weekly schedule</Button></div>
        </form>
      ) : step === "schedule" ? (
        <div>
          <SectionTitle eyebrow="Plan builder · 2 of 3" title="Build your weekly schedule" />
          <p className="mb-6 max-w-3xl text-sm leading-relaxed text-muted-foreground">We’ve drafted {plan.manualSessions.length} workouts from your weekly targets and availability. Drag them to arrange your week; you can change sports, add sessions, or remove any that don’t fit.</p>
          {generatedWorkouts.capacityWarnings.length > 0 && <div role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">{plan.volumeBasis === "distance" ? "Estimated time may exceed your session limits" : "Targets exceed current schedule capacity"}</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{generatedWorkouts.capacityWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><p className="mt-2 text-xs">{plan.volumeBasis === "distance" ? "Estimates use typical speeds when recent pace data is unavailable. Adjust targets or session lengths if needed; this won’t block saving." : "Extend an easy long session if it fits your time limit, or add a session or lower the target."}</p></div>}
          {generatedWorkouts.historyAdjustments.length > 0 && <div role="status" className="mb-5 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"><p className="font-semibold">Starting volume adjusted to recent training</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{generatedWorkouts.historyAdjustments.map(({ sport, startingMinutes, rampTargetMinutes, completedWeeks }) => <li key={sport}>{sport[0].toUpperCase() + sport.slice(1)} starts at {formatWeeklyMinutes(startingMinutes)}/week (median of {completedWeeks} logged weeks), {plan.recoveryRhythm === "manual" ? "then repeats your weekly schedule until you change it." : <>then builds toward {formatWeeklyMinutes(rampTargetMinutes)}/week, with a recovery week after {buildWeeksBeforeRecovery(plan.recoveryRhythm)} build weeks.</>}</li>)}</ul></div>}
          <div className="mt-8 border-t border-border pt-6">
            <div className="mb-4"><p className="text-sm font-bold">Your training week</p><p className="mt-1 text-xs text-muted-foreground">Monday through Sunday · scroll sideways on smaller screens. Add a sport to a day, mark rest days, or drag sessions to adjust spacing.</p></div>
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
                          <select aria-label={`${day} session sport`} value={session.sport} onChange={(e) => updatePlan({ manualSessions: plan.manualSessions.map((item) => item.id === session.id ? { ...item, sport: e.target.value as typeof item.sport, title: item.title === `${item.sport[0].toUpperCase()}${item.sport.slice(1)} session` ? `${e.target.value[0].toUpperCase()}${e.target.value.slice(1)} session` : item.title } : item) })} data-testid={`select-session-sport-${session.id}`} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-1 text-[10px]"><option value="swim">Swim</option><option value="bike">Bike</option><option value="run">Run</option></select>
                          <IconButton label={`remove ${session.sport} on ${day}`} disabled={plan.manualSessions.length <= 3} onClick={() => {
                            const manualSessions = plan.manualSessions.filter((item) => item.id !== session.id);
                            updatePlan({ manualSessions, sessionsPerWeek: manualSessions.length });
                          }}><Trash2 size={13} /></IconButton>
                        </div>
                        <p className="mt-2 text-[11px] font-semibold leading-tight">{session.title}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{session.duration} · {session.intensity}</p>
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
            {scheduleAdvice.length > 0 && <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4 text-xs leading-relaxed text-orange-950"><p className="font-bold">A few things to consider</p><ul className="mt-2 list-disc space-y-1 pl-4">{scheduleAdvice.map((item) => <li key={item}>{item}</li>)}</ul><p className="mt-2 text-orange-900/75">These are coaching prompts, not blockers. Rearrange sessions if you want more recovery between key workouts.</p></div>}
          </div>
          <div className="mt-7 flex justify-between gap-3 border-t border-border pt-6">
            <Button onClick={() => setStep("setup")} variant="secondary" testId="button-back-plan-details"><ArrowLeft size={15} /> Back to plan details</Button>
            <Button onClick={review} disabled={plan.volumeBasis === "time" && generatedWorkouts.capacityWarnings.length > 0} testId="button-review-plan"><ArrowRight size={16} /> Review weekly plan</Button>
          </div>
        </div>
      ) : (
        <div>
          <SectionTitle eyebrow={step === "generated" ? "Plan outline" : "Plan builder · 3 of 3"} title={step === "generated" ? "Your plan overview" : "Review your plan"} action={<div className="flex shrink-0 flex-col items-end gap-2 self-start sm:flex-row [&>button]:h-12 [&>button]:min-h-12 [&>button]:w-48 [&>button]:whitespace-nowrap"><Button onClick={() => setStep("setup")} variant="secondary" testId="button-edit-plan-preferences"><Pencil size={15} /> Edit preferences</Button><Button onClick={() => setStep("schedule")} variant="secondary" testId="button-edit-plan-schedule"><Pencil size={15} /> Edit schedule</Button></div>} />
          <p className="mb-4 text-sm text-muted-foreground">Targets and schedule are set. Open a workout to see its details.</p>
          {generatedWorkouts.capacityWarnings.length > 0 && <div role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">{plan.volumeBasis === "distance" ? "Estimated time may exceed your session limits" : "Targets exceed current schedule capacity"}</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{generatedWorkouts.capacityWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><p className="mt-2 text-xs">{plan.volumeBasis === "distance" ? "Estimates use typical speeds when recent pace data is unavailable. Adjust targets or session lengths if needed; this won’t block saving." : "Extend an easy long session if it fits your time limit, or add a session or lower the target."}</p></div>}
          {generatedWorkouts.historyAdjustments.length > 0 && <div role="status" className="mb-5 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"><p className="font-semibold">Starting volume adjusted to recent training</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{generatedWorkouts.historyAdjustments.map(({ sport, startingMinutes, rampTargetMinutes, completedWeeks }) => <li key={sport}>{sport[0].toUpperCase() + sport.slice(1)} starts at {formatWeeklyMinutes(startingMinutes)}/week (median of {completedWeeks} logged weeks), {plan.recoveryRhythm === "manual" ? "then repeats your weekly schedule until you change it." : <>then builds toward {formatWeeklyMinutes(rampTargetMinutes)}/week, with a recovery week after {buildWeeksBeforeRecovery(plan.recoveryRhythm)} build weeks.</>}</li>)}</ul></div>}
          <div className={`mb-5 grid gap-x-6 gap-y-3 border-y border-border py-4 sm:grid-cols-2 ${plan.goalMode === "race" ? "xl:grid-cols-4" : ""}`}>
            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Weekly volume</p><p className="mt-1 text-sm font-semibold">{plan.volumeBasis === "time" ? `${currentTimeTotal.toFixed(1)} h total` : "By sport"}</p><p className="text-xs capitalize text-muted-foreground">{currentVolumeSummary}</p></div>
            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Plan structure</p><p className="mt-1 text-sm font-semibold">{plan.primaryFocus === "balanced" ? "Balanced" : `${plan.primaryFocus[0].toUpperCase()}${plan.primaryFocus.slice(1)} focused`} · {plan.sessionsPerWeek} sessions/week</p><p className="text-xs text-muted-foreground">{plan.goalMode === "consistency" ? "Ongoing · " : ""}{plan.restDays.length ? `Rest ${plan.restDays.join(", ")}` : "No rest day marked"} · up to {plan.maxSessionMinutes} min/workout</p></div>
            {plan.goalMode === "race" && <><div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Peak volume</p><p className="mt-1 text-sm font-semibold">{plan.volumeBasis === "time" ? `${peakTimeTotal.toFixed(1)} h total` : "By sport"}</p><p className="text-xs capitalize text-muted-foreground">{peakVolumeSummary} · {plan.weeklyBuildRate}% weekly build</p></div><div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Race</p><p className="mt-1 text-sm font-semibold">{weeksToRace === null ? "Date not set" : `${weeksToRace} weeks away`}</p><p className="text-xs text-muted-foreground">{form.distance} · {form.raceDate}{form.raceTime ? ` · Goal ${form.raceTime}` : ""}</p></div></>}
          </div>
          <section className="mb-5 rounded-xl border border-border bg-secondary/20 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-xs font-semibold">Progression &amp; recovery</p><p className="text-[11px] text-muted-foreground">{plan.recoveryRhythm === "manual" ? "Manual · weekly schedule repeats" : `${buildWeeksBeforeRecovery(plan.recoveryRhythm)} build weeks + recovery · ${plan.weeklyBuildRate ?? 5}% per build week`}</p></div>
          </section>
          <div className="mt-5">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div><p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">Weekly calendar</p><h2 className="display text-2xl">Weekly schedule</h2></div>
              {step === "generated" && <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Workout display
                <select aria-label="Workout display" value={plan.workoutDisplay ?? "time"} onChange={(event) => updateWorkoutDisplay(event.target.value as PlanPreferences["workoutDisplay"])} data-testid="select-generated-workout-display" className="h-9 rounded-lg border border-input bg-background px-2 text-xs font-normal normal-case tracking-normal text-foreground">
                  <option value="time">Time</option><option value="distance">Distance estimate</option><option value="both">Time &amp; estimate</option>
                </select>
              </label>}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
              {calendarDays.map(({ day, date, labels, workouts, training, restDay }) => <div key={day} className={`min-h-32 rounded-2xl border p-3 ${restDay ? "border-slate-300 bg-slate-100 text-slate-600" : training ? "border-border bg-background" : "border-dashed border-border bg-secondary/40"}`}>
                <p className="text-xs font-bold">{day}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{prettyDate(iso(date))}</p>
                <div className="mt-3 space-y-2">{workouts.length ? workouts.map((workout) => <details key={workout.id} className="rounded-lg bg-primary/5 px-2 py-1.5 text-[11px]"><summary className="cursor-pointer font-semibold text-primary">{workout.title} · {workoutTargetLabel(plan, workout, sessions, form.preferences.units)}</summary><p className="mt-2 whitespace-pre-line text-[10px] leading-relaxed text-muted-foreground">{workoutDescriptionForDisplay(plan, workout, sessions, form.preferences.units)}</p></details>) : labels.map((label) => <span key={label} className={`block rounded-lg px-2 py-1.5 text-[11px] font-semibold ${restDay ? "bg-slate-200 text-slate-700" : "bg-secondary text-muted-foreground"}`}>{label}</span>)}</div>
              </div>)}
            </div>
          </div>
          <div className="mt-7 flex justify-end gap-3 border-t border-border pt-6">
            {step === "generated" ? <Badge tone="green"><CheckCircle2 size={14} /> Workouts saved</Badge> : <Button onClick={() => void generate()} disabled={saving || (plan.volumeBasis === "time" && generatedWorkouts.capacityWarnings.length > 0)} testId="button-generate-plan"><Sparkles size={16} /> {saving ? "Generating…" : "Generate workouts & save"}</Button>}
          </div>
          {step === "generated" && <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Your generated workout prescriptions are saved to this app’s Training calendar on the days you selected. Distance is an optional estimate for display; the plan is built around time.</p>}
        </div>
      )}
    </div>
  );
}

function upcomingProgressionPreview(plan: PlanPreferences, raceDate: string, importedSessions: TrainingSession[]) {
  const todayMondayOffset = -((today.getDay() + 6) % 7);
  const dateAtOffset = (offset: number) => {
    const date = new Date(today);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const planStartDate = plan.generatedAt?.slice(0, 10) ?? dateAtOffset(0);
  const dayOffset: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return Array.from({ length: 5 }, (_, weekOffset) => {
    const mondayOffset = todayMondayOffset + weekOffset * 7;
    const monday = dateAtOffset(mondayOffset);
    const sunday = dateAtOffset(mondayOffset + 6);
    const referenceDate = monday < planStartDate && sunday >= planStartDate ? planStartDate : monday;
    const week = planWeekForDate(plan, referenceDate, raceDate);
    if (!week) return null;
    const plannedSessions = plan.manualSessions.flatMap((session) => {
      const sessionDate = dateAtOffset(mondayOffset + dayOffset[session.day]);
      if (sessionDate < planStartDate || (plan.goalMode === "race" && raceDate && sessionDate >= raceDate)) return [];
      if (importedSessions.some((item) => item.date === sessionDate && item.sport === session.sport)) return [];
      return [periodizePlannedSession(plan, session, week)];
    });
    const totalMinutes = plannedSessions.reduce((total, session) => total + (session.durationMinutes ?? 0), 0);
    return { label: week.label, weekOf: prettyDate(monday), totalMinutes, sessionCount: plannedSessions.length };
  });
}

function PlanPage() {
  const { athlete, sessions, connection, saveAthlete, toast } = useApp();
  const plan = athlete.preferences.plan;
  const hasSavedPlan = Boolean(plan.generatedAt);
  const [showPlanBuilder, setShowPlanBuilder] = useState(() => Boolean(readPlanBuilderDraft(athlete.id)));
  const [confirmDeletePlan, setConfirmDeletePlan] = useState(false);
  const [deletingPlan, setDeletingPlan] = useState(false);
  const [progressionDialogOpen, setProgressionDialogOpen] = useState(false);
  const [progressionRhythmDraft, setProgressionRhythmDraft] = useState<RecoveryRhythm>(plan.recoveryRhythm);
  const [progressionRateDraft, setProgressionRateDraft] = useState(String(plan.weeklyBuildRate ?? 5));
  const [savingProgression, setSavingProgression] = useState(false);
  const planBuilderRef = useRef<HTMLDivElement | null>(null);
  const planPageRef = useRef<HTMLDivElement | null>(null);
  const observedGeneratedAt = useRef(plan.generatedAt);
  const closePlanBuilder = useCallback(() => {
    clearPlanBuilderDraft(athlete.id);
    setShowPlanBuilder(false);
    requestAnimationFrame(() => planPageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [athlete.id]);
  const openProgressionDialog = () => {
    setProgressionRhythmDraft(plan.recoveryRhythm);
    setProgressionRateDraft(String(plan.weeklyBuildRate ?? 5));
    setProgressionDialogOpen(true);
  };
  const saveProgressionSettings = async () => {
    const rate = Number(progressionRateDraft);
    if (progressionRhythmDraft !== "manual" && (!Number.isFinite(rate) || rate < 0 || rate > 10)) {
      toast("Enter a build rate between 0% and 10% per build week.");
      return;
    }
    setSavingProgression(true);
    try {
      const nextPlan = {
        ...plan,
        recoveryRhythm: progressionRhythmDraft,
        weeklyBuildRate: progressionRhythmDraft === "manual" ? plan.weeklyBuildRate ?? 5 : rate,
      };
      await saveAthlete({ ...athlete, preferences: { ...athlete.preferences, plan: nextPlan } });
      setProgressionDialogOpen(false);
      toast("Progression updated. Your weekly schedule and completed activities were preserved.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save progression settings.");
    } finally {
      setSavingProgression(false);
    }
  };
  const saveWorkoutDisplay = async (workoutDisplay: PlanPreferences["workoutDisplay"]) => {
    if (workoutDisplay === plan.workoutDisplay) return;
    try {
      await saveAthlete({ ...athlete, preferences: { ...athlete.preferences, plan: { ...plan, workoutDisplay } } });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save workout display.");
    }
  };
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
    return `${sport} ${target.peak ?? "—"} ${unit}`;
  }).join(" · ");
  const mondayOffset = -((today.getDay() + 6) % 7);
  const sessionsThisWeek = sessions.filter((session) => session.date >= shift(mondayOffset) && session.date <= shift(mondayOffset + 6));
  const currentTrainingDescription = connection.configured
    ? `${sessionsThisWeek.length} ${sessionsThisWeek.length === 1 ? "session" : "sessions"} this week`
    : "Connect Intervals.icu to bring your current training calendar into the app.";
  const currentPlanWeek = hasSavedPlan ? planWeekForDate(plan, shift(0), athlete.raceDate) : null;
  const currentCycleStep = currentPlanWeek && (currentPlanWeek.phase === "recovery" || currentPlanWeek.phase === "build")
    ? cyclePositionForWeek(plan.recoveryRhythm, currentPlanWeek.index)
    : null;
  const cycleSteps = progressionCycleSteps(plan.recoveryRhythm);
  const progressionSummary = plan.recoveryRhythm === "manual"
    ? "Manual · weekly schedule repeats"
    : `${buildWeeksBeforeRecovery(plan.recoveryRhythm)} build weeks + recovery · ${plan.weeklyBuildRate ?? 5}% per build week`;

  return (
    <div ref={planPageRef} className="space-y-4">
      <PageHeader eyebrow="Build your future" title="Training plan" />
      {hasSavedPlan ? <section className="space-y-5">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div><p className="mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Current plan settings</p><h2 className="display mt-2 text-2xl">{plan.goalMode === "consistency" ? "Train consistently" : athlete.distance || "Training structure"}</h2><p className="mt-1 text-sm text-muted-foreground">{plan.goalMode === "consistency" ? "No race date" : athlete.event || "Current training plan"}{plan.goalMode === "race" && athlete.raceDate ? ` · ${prettyDate(athlete.raceDate)}` : ""}{plan.goalMode === "race" && athlete.raceTime ? ` · Goal ${athlete.raceTime}` : ""}</p></div>
            <div className="flex self-end items-center gap-2 sm:shrink-0"><Badge tone="green"><CheckCircle2 size={13} /> Saved</Badge><Button onClick={() => setShowPlanBuilder(true)} testId="button-edit-plan"><Pencil size={15} /> Edit plan</Button><DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="More plan actions" className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><MoreHorizontal size={18} /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setConfirmDeletePlan(true)} data-testid="button-delete-plan" className="text-rose-700 focus:text-rose-700"><Trash2 size={15} /> Delete plan</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
          </div>
          <div className="mt-6 grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
            <p className="text-sm"><span className="block text-xs text-muted-foreground">Current weekly targets</span><span className="capitalize">{weeklyTargets}</span></p>
            <p className="text-sm"><span className="block text-xs text-muted-foreground">{plan.goalMode === "race" ? "Peak weekly targets" : "Training goal"}</span><span className="capitalize">{plan.goalMode === "race" ? peakTargets : "Maintain a consistent weekly rhythm"}</span></p>
            <p className="text-sm"><span className="block text-xs text-muted-foreground">Progression</span>{progressionSummary}</p>
            <p className="text-sm"><span className="block text-xs text-muted-foreground">Primary focus</span>{plan.primaryFocus === "balanced" ? "Balanced" : `${plan.primaryFocus[0].toUpperCase()}${plan.primaryFocus.slice(1)} focused`}</p>
            <p className="text-sm"><span className="block text-xs text-muted-foreground">Rest days ({plan.restDaysPerWeek}/week)</span>{plan.restDays.join(", ") || "None marked"}</p>
            <p className="text-sm"><span className="block text-xs text-muted-foreground">Workout display</span>{plan.workoutDisplay === "both" ? "Time & estimated distance" : plan.workoutDisplay === "distance" ? "Estimated distance" : "Time"} · {plan.sessionsPerWeek} workouts/week · max {plan.maxSessionMinutes} min each</p>
          </div>
          <div className="mt-5 border-t border-border pt-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div><p className="text-xs font-semibold text-foreground">Progression &amp; recovery</p><p className="text-[11px] text-muted-foreground">{progressionSummary}</p></div>
              <Button variant="secondary" onClick={openProgressionDialog} testId="button-adjust-progression"><SlidersHorizontal size={14} /> Adjust</Button>
            </div>
            <div className={`grid grid-cols-2 gap-2 ${cycleSteps.length === 3 ? "sm:grid-cols-3" : cycleSteps.length === 4 ? "sm:grid-cols-4" : cycleSteps.length === 5 ? "sm:grid-cols-5" : "sm:grid-cols-1"}`} aria-label="Training progression cycle">{cycleSteps.map((step, index) => {
              const isCurrent = currentCycleStep === index;
              return <div key={step.label} aria-current={isCurrent ? "step" : undefined} className={`rounded-lg border px-3 py-2 ${isCurrent ? "border-accent bg-accent/10 ring-1 ring-accent/20" : step.label === "Recovery" ? "border-slate-200 bg-slate-50/80" : "border-border bg-secondary/30"}`}>
                <p className={`text-xs font-semibold ${isCurrent ? "text-accent-foreground" : "text-foreground"}`}>{step.label}{isCurrent ? <span className="ml-1.5 text-[10px] font-medium text-muted-foreground">· This week</span> : null}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{step.detail}</p>
              </div>;
            })}</div>
          </div>
          <div className="mt-5 border-t border-border pt-5">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <p className="text-xs font-semibold text-muted-foreground">Weekly schedule</p>
              <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Workout display
                <select aria-label="Workout display" value={plan.workoutDisplay ?? "time"} onChange={(event) => void saveWorkoutDisplay(event.target.value as PlanPreferences["workoutDisplay"])} data-testid="select-saved-workout-display" className="h-9 rounded-lg border border-input bg-background px-2 text-xs font-normal normal-case tracking-normal text-foreground">
                  <option value="time">Time</option><option value="distance">Distance estimate</option><option value="both">Time &amp; estimate</option>
                </select>
              </label>
            </div>
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
      </section> : !showPlanBuilder ? <section className="space-y-5">
        {connection.configured ? <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4"><Activity size={17} className="mt-0.5 text-accent" /><div><p className="text-sm font-semibold">Current training</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{currentTrainingDescription}</p></div></div> : <div className="rounded-2xl border border-dashed border-border bg-card p-6"><p className="text-sm font-semibold">No training plan yet</p><p className="mt-1 text-xs text-muted-foreground">Create a plan to set your training goals and weekly schedule.</p></div>}
        <button type="button" onClick={() => setShowPlanBuilder(true)} data-testid="button-create-plan" className="group flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-center text-primary-foreground shadow-md transition duration-200 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-lg active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2">
          <Sparkles size={16} />
          <span className="display text-lg">Create plan</span>
        </button>
      </section> : null}
      {showPlanBuilder && <div id="plan-builder" ref={planBuilderRef} className="scroll-mt-24"><PlanGoalEditor forceSetup onSaved={closePlanBuilder} onCancel={closePlanBuilder} /></div>}
      <Dialog open={progressionDialogOpen} onOpenChange={(open) => { if (!savingProgression) setProgressionDialogOpen(open); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Progression &amp; recovery</DialogTitle>
            <DialogDescription>Adjust how the generated plan builds. Saving changes only progression settings; your weekly workout schedule and completed activities stay as they are.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="saved-recovery-rhythm" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Build and recovery rhythm</label><select id="saved-recovery-rhythm" value={progressionRhythmDraft} onChange={(event) => setProgressionRhythmDraft(event.target.value as RecoveryRhythm)} data-testid="select-saved-recovery-rhythm" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="2:1">2 build weeks, then recovery</option><option value="3:1">3 build weeks, then recovery (recommended)</option><option value="4:1">4 build weeks, then recovery</option><option value="manual">Manual · repeat weekly schedule</option></select></div>
            <div><label htmlFor="saved-build-rate" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Build rate (% per build week) · 5% suggested</label><input id="saved-build-rate" type="number" min="0" max="10" step="0.5" disabled={progressionRhythmDraft === "manual"} value={progressionRateDraft} onChange={(event) => setProgressionRateDraft(event.target.value)} data-testid="input-saved-build-rate" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-50" /></div>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{progressionRhythmDraft === "manual" ? "The saved weekly schedule repeats without automatic volume increases or recovery weeks." : `Build weeks increase planned volume by ${progressionRateDraft || 0}% until the ${plan.goalMode === "race" ? "peak" : "current weekly"} target. 5% is a modest app starting point, not a universal rule; adjust based on recent training and recovery. Recovery weeks use about 75% of the preceding build week.`}</p>
          <div className="rounded-xl border border-border bg-secondary/20 p-4">
            <p className="mb-3 text-xs font-semibold">Next five weeks · generated schedule estimate</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {[{ title: "Current", plan }, { title: "After saving", plan: { ...plan, recoveryRhythm: progressionRhythmDraft, weeklyBuildRate: progressionRhythmDraft === "manual" ? plan.weeklyBuildRate ?? 5 : Number(progressionRateDraft) || 0 } }].map((preview) => <div key={preview.title}><p className="mb-2 text-[11px] font-semibold text-muted-foreground">{preview.title}</p><div className="space-y-1.5">{upcomingProgressionPreview(preview.plan, athlete.raceDate, sessions).map((week, index) => week ? <div key={`${week.weekOf}-${index}`} className="flex justify-between gap-2 rounded-md bg-background px-2.5 py-1.5 text-[11px]"><span className="min-w-0 truncate font-medium">{week.weekOf} · {week.label}<span className="ml-1 font-normal text-muted-foreground">({week.sessionCount} sessions)</span></span><span className="shrink-0 text-muted-foreground">{formatWeeklyMinutes(week.totalMinutes)}</span></div> : <div key={`empty-${index}`} className="rounded-md bg-background px-2.5 py-1.5 text-[11px] text-muted-foreground">No planned training</div>)}</div></div>)}
            </div>
            <p className="mt-3 text-[10px] text-muted-foreground">This preview estimates generated workout time. Weekly targets cap increases; saving only updates progression settings, preserving your schedule and completed workouts.</p>
          </div>
          <div className="flex justify-end gap-2"><Button variant="secondary" disabled={savingProgression} onClick={() => setProgressionDialogOpen(false)}>Cancel</Button><Button disabled={savingProgression} onClick={() => void saveProgressionSettings()} testId="button-save-progression">{savingProgression ? "Saving…" : "Save progression"}</Button></div>
        </DialogContent>
      </Dialog>
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

function ProfilePage() {
  const { athlete } = useApp();
  const initials = athlete.name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2) || "A";
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
          <Link href="/plan" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-accent-foreground hover:underline" data-testid="link-edit-plan-profile">Edit athlete and training details in Plan <ArrowRight size={15} /></Link>
        </div>
      </section>
    </div>
  );
}

type ColorTheme = "lagoon" | "ocean" | "forest" | "ember";
const COLOR_THEME_KEY = "triathlon-coach-color-theme";
const colorThemeOptions: Array<{ id: ColorTheme; name: string; description: string; colors: [string, string, string] }> = [
  { id: "lagoon", name: "Lagoon", description: "The original sea-glass and coral palette.", colors: ["#244a4d", "#ed967e", "#eff7f5"] },
  { id: "ocean", name: "Ocean", description: "Cool blue surfaces with a clear aqua accent.", colors: ["#24405c", "#42b8d0", "#f1f6fb"] },
  { id: "forest", name: "Forest", description: "Deep evergreen with soft leaf-green accents.", colors: ["#29493d", "#8bbf82", "#f1f6ef"] },
  { id: "ember", name: "Ember", description: "Warm stone surfaces with a muted terracotta accent.", colors: ["#573b39", "#dc846f", "#fbf3ed"] },
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
          {selected === theme.id && <CheckCircle2 size={16} className="ml-auto text-accent-foreground" />}
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
    <h2 className="display text-lg">Blur other weeks</h2>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Blur weeks outside the current one; scrolling clears the blur.</p>
    <div className="mt-3 flex items-center gap-3">
      <span className="text-sm font-semibold text-muted-foreground">{enabled ? "On" : "Off"}</span>
      <button type="button" role="switch" aria-checked={enabled} aria-label="Blur other calendar weeks" disabled={saving} onClick={() => void update()} className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${enabled ? "bg-primary" : "bg-slate-300"}`} data-testid="switch-calendar-blur">
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
      </button>
      {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
    </div>
  </div>;
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
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,.75fr)]">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
          <div className="flex flex-col justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-center">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <Link2 size={21} />
              </span>
              <div>
                <h2 className="text-lg font-bold">Intervals.icu</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {connection.configured ? `Athlete ${connection.athleteId}` : "API key not configured"}
                </p>
              </div>
            </div>
            {connection.configured && !connection.error ? <Badge tone="green"><CheckCircle2 size={13} /> Connected</Badge> : <Badge tone="amber"><Info size={13} /> {connection.configured ? "Needs attention" : "Setup needed"}</Badge>}
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
                Intervals.icu · read-only for now
              </p>
              <ul className="mt-4 space-y-3"><li className="flex items-center gap-2 text-sm"><Check size={15} className="text-emerald-600" />Planned calendar workouts</li><li className="flex items-center gap-2 text-sm"><Check size={15} className="text-emerald-600" />Completed activities</li><li className="flex items-center gap-2 text-sm text-muted-foreground"><X size={15} />Writing workouts back is not enabled</li></ul>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl bg-secondary/60 p-4">
            <ShieldCheck size={17} className="mt-0.5 text-primary" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              The Intervals.icu API key stays in your ignored local .env file and is only read by the server. It is never sent to this browser page.
            </p>
          </div>
          {connection.error && (
            <p role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Intervals.icu could not be reached: {connection.error}
            </p>
          )}
          {!connection.configured && (
            <div className="mt-4 rounded-xl border border-dashed border-border p-4 text-sm">
              <p className="font-semibold">Connect your Intervals.icu account</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>Create a personal API key in Intervals.icu account settings.</li>
                <li>Add it as <code>INTERVALS_API_KEY=your_key</code> in the repo-root <code>.env</code> file. Do not paste it into chat or this page.</li>
                <li>Restart the local API server, then select Sync now.</li>
              </ol>
            </div>
          )}
          {connection.lastSync && (
            <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw size={13} /> Last sync{" "}
              {new Date(connection.lastSync).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>
        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <Info size={16} className="text-muted-foreground" />
              <p className="text-sm font-bold">Backend-only database access</p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              The browser talks to your local API. The API reads and writes Supabase, while workouts are read from Intervals.icu. User authentication is not implemented yet; keep this app private on your computer.
            </p>
          </div>
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

const queryClient = new QueryClient();
function App() {
  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLOR_THEME_KEY);
      if (colorThemeOptions.some((theme) => theme.id === saved)) document.documentElement.dataset.colorTheme = saved!;
    } catch { /* Use the default palette when browser storage is unavailable. */ }
  }, []);
  const [athlete, setAthlete] = useState<Athlete>(emptyAthlete);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [wellness, setWellness] = useState<IntervalsWellness[]>([]);
  const [wellnessError, setWellnessError] = useState<string | null>(null);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [connection, setConnection] = useState<Connection>({ configured: false, athleteId: "0" });
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
      const [athleteRecord, goals, checkInRecords, recommendationRecords, intervalsStatus] = await Promise.all([
        dataApi.athlete(),
        dataApi.goals(),
        dataApi.checkIns(),
        dataApi.recommendations(),
        dataApi.intervalsStatus(),
      ]);
      const preferredGoalMode = athleteRecord.preferences?.plan?.goalMode;
      const activeGoal = preferredGoalMode
        ? goals.find((goal) => goal.type === preferredGoalMode)
          ?? (preferredGoalMode === "consistency" ? goals.find((goal) => goal.type === "other" && goal.name === "Train consistently") : undefined)
        : goals.find((goal) => goal.type === "race") ?? goals.find((goal) => goal.type === "consistency") ?? goals[0];
      setAthlete(athleteFromRecord(athleteRecord, activeGoal));
      setCheckIns(checkInRecords.map(checkInFromRecord));
      setRecommendations(recommendationRecords.map(recommendationFromRecord));
      setDatabaseConnected(true);

      if (intervalsStatus.configured) {
        const [calendarResult, wellnessResult] = await Promise.allSettled([
          dataApi.intervalsCalendar(shift(-84), shift(180)),
          dataApi.intervalsWellness(shift(-84), shift(0)),
        ]);
        if (calendarResult.status === "fulfilled") {
          setSessions(sessionsFromIntervals(calendarResult.value.events, calendarResult.value.activities));
          setConnection({ configured: true, athleteId: intervalsStatus.athleteId, lastSync: calendarResult.value.syncedAt });
        } else {
          setSessions([]);
          setConnection({ configured: true, athleteId: intervalsStatus.athleteId, error: calendarResult.reason instanceof Error ? calendarResult.reason.message : "Could not load Intervals.icu data." });
        }
        if (wellnessResult.status === "fulfilled") {
          setWellness(wellnessResult.value.records.filter((record) => record && typeof record.id === "string").sort((a, b) => b.id.localeCompare(a.id)));
          setWellnessError(null);
        } else {
          setWellness([]);
          setWellnessError(wellnessResult.reason instanceof Error ? wellnessResult.reason.message : "Could not load Intervals.icu wellness data.");
        }
      } else {
        setSessions([]);
        setWellness([]);
        setWellnessError("Connect Intervals.icu to sync wellness metrics.");
        setConnection({ configured: false, athleteId: intervalsStatus.athleteId });
      }
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
      name: form.event.trim() || "Race goal",
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
    const workout = candidates.find((item) => item.quality && !athlete.preferences.plan.workoutOverrides?.some((override) => override.workoutId === item.id))
      ?? (checkIn.illness !== "None" ? candidates.find((item) => !athlete.preferences.plan.workoutOverrides?.some((override) => override.workoutId === item.id)) : undefined);
    const recommendationWorkout = workout && (workout.sport === "swim" || workout.sport === "bike" || workout.sport === "run")
      ? { ...workout, sport: workout.sport, quality: Boolean(workout.quality) }
      : undefined;
    const derived = deriveCheckInRecommendation(checkIn, wellness, recommendationWorkout);
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
      { workoutId: derived.override.workoutId, field: "workoutOverride", from: athlete.preferences.plan.workoutOverrides?.find((item) => item.workoutId === derived.override.workoutId) ?? null, to: derived.override },
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
    const change = recommendation.proposedChanges.find((item) => item.field === "workoutOverride");
    if (!change) {
      await updateRecommendation(id, { status: direction === "apply" ? "approved" : "pending" });
      return;
    }
    const target = (direction === "apply" ? change.to : change.from) as PlanWorkoutOverride | null;
    const currentPlan = athlete.preferences.plan;
    const nextOverrides = (currentPlan.workoutOverrides ?? []).filter((item) => item.workoutId !== change.workoutId);
    if (target) nextOverrides.push(target);
    const nextPlan = { ...currentPlan, workoutOverrides: nextOverrides };
    await dataApi.updateAthlete({ preferences: { ...athlete.preferences, plan: nextPlan } });
    setAthlete((current) => ({ ...current, preferences: { ...current.preferences, plan: nextPlan } }));
    try {
      await updateRecommendation(id, { status: direction === "apply" ? "approved" : "pending" });
    } catch (error) {
      const rollbackOverrides = (currentPlan.workoutOverrides ?? []).filter((item) => item.workoutId !== change.workoutId);
      const prior = currentPlan.workoutOverrides?.find((item) => item.workoutId === change.workoutId);
      if (prior) rollbackOverrides.push(prior);
      const rollbackPlan = { ...currentPlan, workoutOverrides: rollbackOverrides };
      await dataApi.updateAthlete({ preferences: { ...athlete.preferences, plan: rollbackPlan } });
      setAthlete((current) => ({ ...current, preferences: { ...current.preferences, plan: rollbackPlan } }));
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
              <Router />
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
