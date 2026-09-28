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
  override: PlanWorkoutOverride;
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
    const prior = records
      .filter((record) => record.id < date && record.id >= windowStart && finite(record[key]))
      .map((record) => record[key] as number);
    if (!finite(current) || prior.length < 7) return [];
    const mean = prior.reduce((sum, value) => sum + value, 0) / prior.length;
    const sd = Math.sqrt(prior.reduce((sum, value) => sum + (value - mean) ** 2, 0) / prior.length);
    if (adverse(current, mean, sd)) return [`${label} is outside your recent personal range (${prior.length} baseline readings)`];
    return [];
  });
}

export function deriveCheckInRecommendation(
  checkIn: RecommendationCheckIn,
  wellness: WellnessEntry[],
  workout: RecommendationWorkout | undefined,
): DerivedRecommendation | null {
  if (!workout) return null;
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
  if (!hasReportedSymptom && (!hasMultipleSignals || !workout.quality)) return null;

  const evidence = [
    ...(hasReportedSymptom ? [`check-in: ${checkIn.illness}`] : []),
    ...selfReportFlags,
    ...wearableFlags,
  ];
  const date = checkIn.timestamp;
  if (hasReportedSymptom) {
    return {
      title: "Consider making today a recovery day",
      reasoning: "You reported a symptom or discomfort in today’s check-in. This suggestion follows your report; wearable data cannot determine what is causing it. You can restore the original workout with Undo.",
      athleteNotes: `Today’s check-in: ${evidence.join("; ")}. No workout-performance or environmental cause is inferred.`,
      proposedChange: `Replace ${workout.title} with a recovery day`,
      override: { workoutId: workout.id, date, restDay: true },
    };
  }

  const minutes = workout.durationMinutes;
  if (!minutes || minutes <= 10) return null;
  const easyMinutes = Math.max(10, Math.floor(minutes * 0.7));
  if (easyMinutes >= minutes) return null;
  return {
    title: "Ease back today",
    reasoning: "Several check-in ratings are strained and/or recovery readings have shifted from your personal baseline. Consider replacing this quality session with shorter, easy aerobic work. This is an optional training adjustment, not a diagnosis or a prediction of performance.",
    athleteNotes: `Today’s signals: ${evidence.join("; ")}. Wearable comparisons use your earlier readings from the past 30 days and require at least 7 readings per metric.`,
    proposedChange: `Replace ${workout.title} with ${easyMinutes} min easy ${workout.sport}`,
    override: {
      workoutId: workout.id,
      date,
      title: `Easy recovery ${workout.sport}`,
      durationMinutes: easyMinutes,
      intensity: "Easy · RPE 2–3/10",
      workoutDescription: "Keep the effort comfortable and conversational; remove structured intensity. Finish feeling like you could continue, and stop if the warm-up or session feels worse than expected.",
    },
  };
}
