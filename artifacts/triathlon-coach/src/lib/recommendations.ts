export type RecommendationCheckIn = {
  readiness: number;
  fatigue: number;
  soreness: number;
  stress: number;
  sleepQuality: number | null;
  illness: string;
  timestamp: string;
};

type WellnessEntry = {
  id: string;
  hrv?: number | null;
  restingHR?: number | null;
  sleepSecs?: number | null;
  sleepScore?: number | null;
};

import type { PlanWorkoutOverride } from "@/lib/data-api";
import { historicalHrvBaseline, historicalSleepScoreBaseline, HRV_BASELINE_MIN_READINGS, SLEEP_SCORE_BASELINE_MIN_READINGS } from "@/lib/wellness-baseline";
export type { PlanWorkoutOverride } from "@/lib/data-api";

export type RecommendationWorkout = {
  id: string;
  sport: "swim" | "bike" | "run";
  title: string;
  durationMinutes?: number;
  duration: string;
  intensity: string;
  quality: boolean;
};

export type DerivedRecommendation = {
  title: string;
  reasoning: string;
  athleteNotes: string;
  proposedChange: string;
  overrides: PlanWorkoutOverride[];
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function personalOutliers(date: string, records: WellnessEntry[]) {
  const today = records.find((record) => record.id === date);
  if (!today) return [] as string[];
  const dateAt = new Date(`${date}T12:00:00`);
  dateAt.setDate(dateAt.getDate() - 30);
  const windowStart = `${dateAt.getFullYear()}-${String(dateAt.getMonth() + 1).padStart(2, "0")}-${String(dateAt.getDate()).padStart(2, "0")}`;
  const metrics = [
    { key: "hrv" as const, label: "HRV", adverse: (current: number, mean: number, sd: number) => current < mean - sd },
    { key: "restingHR" as const, label: "resting heart rate", adverse: (current: number, mean: number, sd: number) => current > mean + sd },
    { key: "sleepSecs" as const, label: "sleep duration", adverse: (current: number, mean: number, sd: number) => current < mean - sd },
    { key: "sleepScore" as const, label: "sleep score", adverse: (current: number, mean: number, sd: number) => current < mean - sd },
  ];
  return metrics.flatMap(({ key, label, adverse }) => {
    const current = today[key];
    if (!finite(current)) return [];
    if (key === "hrv" || key === "sleepScore") {
      const reference = key === "hrv" ? historicalHrvBaseline(records, date) : historicalSleepScoreBaseline(records, date);
      const minimumReadings = key === "hrv" ? HRV_BASELINE_MIN_READINGS : SLEEP_SCORE_BASELINE_MIN_READINGS;
      const referenceName = key === "hrv" ? "HRV reference" : "sleep-score reference";
      const excludedDays = key === "hrv" ? 30 : 14;
      const belowReference = reference.ready && reference.center !== null && reference.spread !== null
        && adverse(current, reference.center, reference.spread);
      if (key === "sleepScore" && current < 80) {
        const rating = current < 60 ? "poor" : "fair";
        return [`Sleep score is ${rating}${belowReference ? ` and below your long-term ${referenceName}` : ""}${reference.ready ? ` (${reference.count} readings; recent ${excludedDays} days excluded)` : ` (Garmin score band; ${reference.count}/${minimumReadings} long-term readings)`}`];
      }
      if (!reference.ready || reference.center === null || reference.spread === null) return [];
      if (belowReference) return [`${label} is below your longer-term reference (${reference.count} readings; recent ${excludedDays} days excluded)`];
      return [];
    }
    const prior = records
      .filter((record) => record.id < date && record.id >= windowStart && finite(record[key]))
      .map((record) => record[key] as number);
    if (prior.length < 7) return [];
    const mean = prior.reduce((sum, value) => sum + value, 0) / prior.length;
    const sd = Math.sqrt(prior.reduce((sum, value) => sum + (value - mean) ** 2, 0) / prior.length);
    if (adverse(current, mean, sd)) return [`${label} is outside your recent personal range (${prior.length} baseline readings)`];
    return [];
  });
}

export function deriveCheckInRecommendation(
  checkIn: RecommendationCheckIn,
  wellness: WellnessEntry[],
  workoutInput: RecommendationWorkout | RecommendationWorkout[] | undefined,
): DerivedRecommendation | null {
  const workouts = workoutInput ? (Array.isArray(workoutInput) ? workoutInput : [workoutInput]) : [];
  if (workouts.length === 0) return null;
  const selfReportFlags = [
    checkIn.readiness <= 3 ? `readiness ${checkIn.readiness}/10` : null,
    checkIn.fatigue >= 8 ? `fatigue ${checkIn.fatigue}/10` : null,
    checkIn.soreness >= 8 ? `soreness ${checkIn.soreness}/10` : null,
    checkIn.stress >= 8 ? `stress ${checkIn.stress}/10` : null,
    checkIn.sleepQuality !== null && checkIn.sleepQuality <= 3 ? `sleep quality ${checkIn.sleepQuality}/10` : null,
  ].filter((value): value is string => value !== null);
  const wearableFlags = personalOutliers(checkIn.timestamp, wellness);
  const hasReportedSymptom = checkIn.illness.trim() !== "" && checkIn.illness !== "None";
  const hasMultipleSignals = selfReportFlags.length >= 2
    || (selfReportFlags.length >= 1 && wearableFlags.length >= 1)
    || wearableFlags.length >= 2;
  if (!hasReportedSymptom && (!hasMultipleSignals || !workouts.some((item) => item.quality))) return null;

  const conciseWearableFlags = wearableFlags.map((flag) => flag
    .replace(" is below your longer-term reference", " below personal baseline")
    .replace(" is outside your recent personal range", " outside recent range")
    .replace(/\s+\([^)]*\)/g, ""));
  const evidence = [
    ...(hasReportedSymptom ? [checkIn.illness] : []),
    ...selfReportFlags,
    ...conciseWearableFlags,
  ];
  const date = checkIn.timestamp;
  if (hasReportedSymptom) {
    return {
      title: "Make today a full recovery day",
      reasoning: `You reported “${checkIn.illness}” today. Removing all scheduled sessions gives you a full rest day; Undo restores them.`,
      athleteNotes: evidence.join(" · "),
      proposedChange: "Remove all of today’s planned sessions for a recovery day",
      overrides: workouts.map((item) => ({ workoutId: item.id, date, restDay: true })),
    };
  }

  const selectedWorkout = workouts.find((item) => item.quality) ?? workouts[0];
  const minutes = selectedWorkout.durationMinutes;
  if (!minutes || minutes <= 10) return null;
  const easyMinutes = Math.max(10, Math.floor(minutes * 0.7));
  if (easyMinutes >= minutes) return null;
  return {
    title: "Ease back today",
    reasoning: "Several check-in ratings are strained and/or recovery readings have shifted from your personal baseline. Consider replacing this quality session with shorter, relaxed aerobic work. This is an optional training adjustment, not a diagnosis or a prediction of performance.",
    athleteNotes: evidence.join(" · "),
    proposedChange: `Replace ${selectedWorkout.title} with ${easyMinutes} min recovery ${selectedWorkout.sport}`,
    overrides: [{
      workoutId: selectedWorkout.id,
      date,
      title: `Recovery ${selectedWorkout.sport}`,
      durationMinutes: easyMinutes,
      intensity: "Recovery",
      workoutDescription: "Keep the effort comfortable and conversational; remove structured intensity. Finish feeling like you could continue, and stop if the warm-up or session feels worse than expected.",
    }],
  };
}
