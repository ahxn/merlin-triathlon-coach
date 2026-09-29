import type { PlanPreferences, RecoveryRhythm } from "./data-api";
import { recommendedSessionCap, weeklyTargetMinutes, workoutDetails, workoutFocusLabel } from "./plan-generator";

type PlannedSession = PlanPreferences["manualSessions"][number];
type Sport = PlannedSession["sport"];
type Phase = "settle-in" | "build" | "recovery" | "taper" | "race";

export type PlanWeek = { index: number; progressionIndex: number; phase: Phase; label: string };

export function buildWeeksBeforeRecovery(rhythm: RecoveryRhythm = "3:1", customBuildWeeks = 3) {
  if (rhythm === "manual" || rhythm === "none") return null;
  if (rhythm === "custom") return Math.min(12, Math.max(1, Math.round(customBuildWeeks || 3)));
  return rhythm === "2:1" || rhythm === "4:1" ? Number(rhythm[0]) : 3;
}

export function progressionCycleSteps(rhythm: RecoveryRhythm, recoveryWeekPercent = 75, customBuildWeeks = 3) {
  const buildWeeks = buildWeeksBeforeRecovery(rhythm, customBuildWeeks);
  if (buildWeeks === null) return [{ label: "No build", detail: "Repeat the saved weekly schedule without progression" }];
  return [
    ...Array.from({ length: buildWeeks }, (_, index) => ({
      label: `Build ${index + 1}/${buildWeeks}`,
      detail: index === 0 ? "Start the build" : index === buildWeeks - 1 ? "Highest build week" : "Progress gradually",
    })),
    { label: "Recovery", detail: `${recoveryWeekPercent}% of build-week volume` },
  ];
}

export function cyclePositionForWeek(rhythm: RecoveryRhythm, weekIndex: number, customBuildWeeks = 3) {
  const buildWeeks = buildWeeksBeforeRecovery(rhythm, customBuildWeeks);
  return buildWeeks === null ? null : weekIndex % (buildWeeks + 1);
}

const dayMs = 86_400_000;
const mondayOf = (value: string) => {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
};
const dayNumber = (value: string) => Date.parse(`${value}T00:00:00Z`) / dayMs;
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function firstTrainingDate(plan: PlanPreferences) {
  const planStartDate = plan.generatedAt?.slice(0, 10);
  if (!planStartDate || plan.manualSessions.length === 0) return planStartDate ?? null;
  const scheduledDays = new Set(plan.manualSessions.map((session) => session.day));
  for (let offset = 0; offset < 7; offset++) {
    const candidate = new Date(`${planStartDate}T00:00:00Z`);
    candidate.setUTCDate(candidate.getUTCDate() + offset);
    const date = candidate.toISOString().slice(0, 10);
    const day = dayNames[candidate.getUTCDay()];
    if (scheduledDays.has(day) && !plan.restDays.includes(day)) return date;
  }
  return planStartDate;
}

function hasMissedStartWeekWorkout(plan: PlanPreferences, firstDate: string) {
  const weekStart = mondayOf(firstDate);
  if (!weekStart || firstDate <= weekStart) return false;
  const startNumber = dayNumber(weekStart);
  const firstNumber = dayNumber(firstDate);
  const scheduledDays = new Set(plan.manualSessions.map((session) => session.day));
  for (let day = startNumber; day < firstNumber; day++) {
    const date = new Date(day * dayMs).toISOString().slice(0, 10);
    const dayName = dayNames[new Date(`${date}T00:00:00Z`).getUTCDay()];
    if (scheduledDays.has(dayName) && !plan.restDays.includes(dayName)) return true;
  }
  return false;
}

export function planWeekForDate(plan: PlanPreferences, date: string, raceDate: string): PlanWeek | null {
  if (!plan.generatedAt || date < plan.generatedAt.slice(0, 10)) return null;
  const blockStartDate = firstTrainingDate(plan);
  const start = blockStartDate ? mondayOf(blockStartDate) : null;
  const weekStart = mondayOf(date);
  if (!start || !weekStart) return null;
  const index = Math.round((dayNumber(weekStart) - dayNumber(start)) / 7);
  if (index < 0) return null;
  const settleIn = plan.recoveryRhythm !== "manual" && plan.recoveryRhythm !== "none" && Boolean(blockStartDate && hasMissedStartWeekWorkout(plan, blockStartDate));
  const progressionIndex = Math.max(0, index - (settleIn ? 1 : 0));
  if (settleIn && index === 0) return { index, progressionIndex, phase: "settle-in", label: "Settle-in week" };
  if (plan.goalMode === "race" && raceDate) {
    if (date > raceDate) return null;
    const raceWeekStart = mondayOf(raceDate);
    if (raceWeekStart) {
      const weeksToRace = Math.round((dayNumber(raceWeekStart) - dayNumber(weekStart)) / 7);
      if (weeksToRace < 0) return null;
      if (weeksToRace === 0) return { index, progressionIndex, phase: "race", label: "Race week" };
      if (weeksToRace === 1) return { index, progressionIndex, phase: "taper", label: "Taper week" };
    }
  }
  const buildWeeks = buildWeeksBeforeRecovery(plan.recoveryRhythm ?? "3:1", plan.customBuildWeeks);
  if (buildWeeks === null) return { index, progressionIndex, phase: "build", label: `Training week ${index + 1}` };
  const position = progressionIndex % (buildWeeks + 1);
  return position === buildWeeks
    ? { index, progressionIndex, phase: "recovery", label: `Recovery week · ${plan.recoveryWeekPercent ?? 75}% volume` }
    : { index, progressionIndex, phase: "build", label: `Build ${position + 1}/${buildWeeks}` };
}

function buildFactor(plan: PlanPreferences, index: number, sport: Sport) {
  const buildWeeks = buildWeeksBeforeRecovery(plan.recoveryRhythm ?? "3:1", plan.customBuildWeeks);
  if (buildWeeks === null) return 1;
  const cycleLength = buildWeeks + 1;
  const position = index % cycleLength;
  const steps = Math.floor(index / cycleLength) * buildWeeks + Math.min(position, buildWeeks - 1);
  const rate = Math.min(10, Math.max(0, plan.weeklyBuildRate ?? 0)) / 100;
  const baseline = plan.trainingBaseline?.[sport];
  if (baseline && baseline.startingMinutes > 0) {
    const peakTarget = plan.volumeBasis === "time" ? plan.timeTargets[sport].peak : plan.distanceTargets[sport].peak;
    const peak = plan.goalMode === "race" && peakTarget !== null ? weeklyTargetMinutes(plan, sport, "peak") : null;
    const ceiling = peak === null ? Number.POSITIVE_INFINITY : Math.max(1, peak / baseline.startingMinutes);
    return Math.min(ceiling, (1 + rate) ** steps);
  }
  const targets = plan.volumeBasis === "time" ? plan.timeTargets[sport] : plan.distanceTargets[sport];
  const current = targets.weekly ?? 0;
  const peak = plan.goalMode === "race" ? targets.peak : current;
  const ceiling = current > 0 ? peak === null ? Number.POSITIVE_INFINITY : Math.max(1, peak / current) : 1;
  const initialConsistencyRamp = plan.goalMode === "consistency"
    ? (1 + rate) ** -Math.max(0, buildWeeks - 1)
    : 1;
  return Math.min(ceiling, initialConsistencyRamp * (1 + rate) ** steps);
}

function weekFactor(plan: PlanPreferences, week: PlanWeek, sport: Sport) {
  if (week.phase === "taper" || week.phase === "race") {
    // Taper from the already reached load rather than jumping to the peak target.
    const preTaper = buildFactor(plan, Math.max(0, week.progressionIndex - (week.phase === "race" ? 2 : 1)), sport);
    return preTaper * (week.phase === "race" ? 0.5 : 0.7);
  }
  if (plan.recoveryRhythm === "manual" || plan.recoveryRhythm === "none") return 1;
  const factor = buildFactor(plan, week.progressionIndex, sport);
  const recoveryPercent = Math.min(100, Math.max(50, plan.recoveryWeekPercent ?? 75));
  return week.phase === "recovery" ? factor * recoveryPercent / 100 : factor;
}

function originalMinutes(session: PlannedSession) {
  if (session.durationMinutes && session.durationMinutes > 0) return session.durationMinutes;
  const hours = Number(session.duration.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hour)/i)?.[1] ?? 0);
  const minutes = Number(session.duration.match(/(\d+)\s*min/i)?.[1] ?? 0);
  return hours * 60 + minutes || 30;
}

function baseTitle(sport: Sport, swimVariant: "technique" | "endurance") {
  return sport === "swim"
    ? swimVariant === "endurance" ? "Swim endurance" : "Swim technique + endurance"
    : sport === "bike" ? "Bike endurance" : "Run endurance";
}

export function periodizePlannedSession(plan: PlanPreferences, session: PlannedSession, week: PlanWeek): PlannedSession {
  const factor = weekFactor(plan, week, session.sport);
  const recovery = week.phase === "recovery";
  const requestedQuality = Boolean(session.quality) && !recovery;
  const configuredCap = requestedQuality || session.durationOverrideMinutes === undefined
    ? recommendedSessionCap(plan, session.sport, requestedQuality)
    : plan.maxSessionMinutes || 90;
  const cap = Math.max(15, configuredCap);
  const minutes = Math.max(15, Math.min(cap, Math.round(originalMinutes(session) * factor)));
  const quality = requestedQuality;
  const describedDistance = Number(session.workoutDescription?.match(/Approximate session target:\s*([\d.]+)/)?.[1] ?? 0);
  const sportMinutes = plan.manualSessions.filter((item) => item.sport === session.sport).reduce((sum, item) => sum + originalMinutes(item), 0);
  const fallbackDistance = (plan.distanceTargets[session.sport].weekly ?? 0) * originalMinutes(session) / Math.max(1, sportMinutes);
  const distanceTarget = (describedDistance || fallbackDistance) * minutes / originalMinutes(session);
  const distanceUnit = plan.volumeBasis === "distance" ? plan.distanceTargets[session.sport].unit : "";
  const swimVariant = session.sport === "swim" && /(?:aerobic swim|swim endurance)/i.test(session.title) ? "endurance" : "technique";
  const description = workoutDetails(plan, session.sport, minutes, quality, distanceTarget, distanceUnit, swimVariant);
  return {
    ...session,
    title: recovery || (requestedQuality && !quality)
      ? /^(long ride|long run)$/i.test(session.title) ? session.title
        : baseTitle(session.sport, swimVariant)
      : session.title,
    duration: `${plan.volumeBasis === "distance" ? "~" : ""}${minutes} min`,
    durationMinutes: minutes,
    intensity: workoutFocusLabel(session.sport, quality, swimVariant),
    quality,
    workoutDescription: `${week.label}. ${description}`,
  };
}
