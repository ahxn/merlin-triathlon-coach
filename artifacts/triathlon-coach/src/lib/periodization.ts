import type { PlanPreferences, RecoveryRhythm } from "./data-api";
import { recommendedSessionCap, weeklyTargetMinutes, workoutDetails } from "./plan-generator";

type PlannedSession = PlanPreferences["manualSessions"][number];
type Sport = PlannedSession["sport"];
type Phase = "build" | "recovery" | "taper" | "race";

export type PlanWeek = { index: number; phase: Phase; label: string };

export function buildWeeksBeforeRecovery(rhythm: RecoveryRhythm = "3:1") {
  if (rhythm === "manual") return null;
  return rhythm === "2:1" || rhythm === "4:1" ? Number(rhythm[0]) : 3;
}

export function progressionCycleSteps(rhythm: RecoveryRhythm) {
  const buildWeeks = buildWeeksBeforeRecovery(rhythm);
  if (buildWeeks === null) return [{ label: "Manual", detail: "Repeat the saved weekly schedule" }];
  return [
    ...Array.from({ length: buildWeeks }, (_, index) => ({
      label: `Build ${index + 1}/${buildWeeks}`,
      detail: index === 0 ? "Start the build" : index === buildWeeks - 1 ? "Highest build week" : "Progress gradually",
    })),
    { label: "Recovery", detail: "Less volume, easier work" },
  ];
}

export function cyclePositionForWeek(rhythm: RecoveryRhythm, weekIndex: number) {
  const buildWeeks = buildWeeksBeforeRecovery(rhythm);
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

export function planWeekForDate(plan: PlanPreferences, date: string, raceDate: string): PlanWeek | null {
  if (!plan.generatedAt || date < plan.generatedAt.slice(0, 10)) return null;
  const blockStartDate = firstTrainingDate(plan);
  const start = blockStartDate ? mondayOf(blockStartDate) : null;
  const weekStart = mondayOf(date);
  if (!start || !weekStart) return null;
  const index = Math.round((dayNumber(weekStart) - dayNumber(start)) / 7);
  if (index < 0) return null;
  if (plan.goalMode === "race" && raceDate) {
    if (date > raceDate) return null;
    const raceWeekStart = mondayOf(raceDate);
    if (raceWeekStart) {
      const weeksToRace = Math.round((dayNumber(raceWeekStart) - dayNumber(weekStart)) / 7);
      if (weeksToRace < 0) return null;
      if (weeksToRace === 0) return { index, phase: "race", label: "Race week" };
      if (weeksToRace === 1) return { index, phase: "taper", label: "Taper week" };
    }
  }
  const buildWeeks = buildWeeksBeforeRecovery(plan.recoveryRhythm ?? "3:1");
  if (buildWeeks === null) return { index, phase: "build", label: `Training week ${index + 1}` };
  const position = index % (buildWeeks + 1);
  return position === buildWeeks
    ? { index, phase: "recovery", label: "Recovery week" }
    : { index, phase: "build", label: `Build ${position + 1}/${buildWeeks}` };
}

function buildFactor(plan: PlanPreferences, index: number, sport: Sport) {
  const buildWeeks = buildWeeksBeforeRecovery(plan.recoveryRhythm ?? "3:1");
  if (buildWeeks === null) return 1;
  const cycleLength = buildWeeks + 1;
  const position = index % cycleLength;
  const steps = Math.floor(index / cycleLength) * buildWeeks + Math.min(position, buildWeeks - 1);
  const rate = Math.min(10, Math.max(0, plan.weeklyBuildRate ?? 0)) / 100;
  const baseline = plan.trainingBaseline?.[sport];
  if (baseline && baseline.startingMinutes > 0) {
    const current = weeklyTargetMinutes(plan, sport);
    const peak = plan.goalMode === "race" ? weeklyTargetMinutes(plan, sport, "peak") : current;
    const ceiling = Math.max(1, peak / baseline.startingMinutes);
    return Math.min(ceiling, (1 + rate) ** steps);
  }
  const targets = plan.volumeBasis === "time" ? plan.timeTargets[sport] : plan.distanceTargets[sport];
  const current = targets.weekly ?? 0;
  const peak = plan.goalMode === "race" ? targets.peak ?? current : current;
  const ceiling = current > 0 ? Math.max(1, peak / current) : 1;
  const initialConsistencyRamp = plan.goalMode === "consistency"
    ? (1 + rate) ** -Math.max(0, buildWeeks - 1)
    : 1;
  return Math.min(ceiling, initialConsistencyRamp * (1 + rate) ** steps);
}

function weekFactor(plan: PlanPreferences, week: PlanWeek, sport: Sport) {
  if (week.phase === "taper" || week.phase === "race") {
    // Taper from the already reached load rather than jumping to the peak target.
    const preTaper = buildFactor(plan, Math.max(0, week.index - (week.phase === "race" ? 2 : 1)), sport);
    return preTaper * (week.phase === "race" ? 0.5 : 0.7);
  }
  if (plan.recoveryRhythm === "manual") return 1;
  const factor = buildFactor(plan, week.index, sport);
  return week.phase === "recovery" ? factor * 0.75 : factor;
}

function originalMinutes(session: PlannedSession) {
  if (session.durationMinutes && session.durationMinutes > 0) return session.durationMinutes;
  const hours = Number(session.duration.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hour)/i)?.[1] ?? 0);
  const minutes = Number(session.duration.match(/(\d+)\s*min/i)?.[1] ?? 0);
  return hours * 60 + minutes || 30;
}

function easyTitle(sport: Sport) {
  return sport === "swim" ? "Easy technique swim" : sport === "bike" ? "Easy endurance ride" : "Easy aerobic run";
}

export function periodizePlannedSession(plan: PlanPreferences, session: PlannedSession, week: PlanWeek): PlannedSession {
  const factor = weekFactor(plan, week, session.sport);
  const recovery = week.phase === "recovery";
  const requestedQuality = Boolean(session.quality) && !recovery;
  const cap = recommendedSessionCap(plan, session.sport, requestedQuality);
  const minutes = Math.min(cap, Math.max(Math.min(15, cap), Math.round(originalMinutes(session) * factor / 5) * 5));
  const quality = requestedQuality && minutes >= 40;
  const describedDistance = Number(session.workoutDescription?.match(/Approximate session target:\s*([\d.]+)/)?.[1] ?? 0);
  const sportMinutes = plan.manualSessions.filter((item) => item.sport === session.sport).reduce((sum, item) => sum + originalMinutes(item), 0);
  const fallbackDistance = (plan.distanceTargets[session.sport].weekly ?? 0) * originalMinutes(session) / Math.max(1, sportMinutes);
  const distanceTarget = (describedDistance || fallbackDistance) * minutes / originalMinutes(session);
  const distanceUnit = plan.volumeBasis === "distance" ? plan.distanceTargets[session.sport].unit : "";
  const swimVariant = session.sport === "swim" && /aerobic swim/i.test(session.title) ? "endurance" : "technique";
  const description = workoutDetails(plan, session.sport, minutes, quality, distanceTarget, distanceUnit, swimVariant);
  return {
    ...session,
    title: recovery || (requestedQuality && !quality)
      ? session.sport === "swim" && /aerobic swim/i.test(session.title) ? "Easy aerobic swim" : easyTitle(session.sport)
      : session.title,
    duration: `${plan.volumeBasis === "distance" ? "~" : ""}${minutes} min`,
    durationMinutes: minutes,
    intensity: quality ? "Controlled · RPE 5–6/10" : "Easy · RPE 3–4/10",
    quality,
    workoutDescription: `${week.label}. ${description}`,
  };
}
