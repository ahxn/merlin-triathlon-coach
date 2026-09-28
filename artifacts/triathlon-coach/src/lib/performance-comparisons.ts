export type PerformanceActivity = {
  id: string;
  date: string;
  performedAt?: string;
  sport: string;
  title: string;
  plannedWorkoutTitle?: string;
  workoutDescription?: string;
  status: string;
  durationMinutes?: number;
  distanceMeters?: number;
  averageHeartRate?: number;
  averagePower?: number;
  weightedAveragePower?: number;
  averageSpeed?: number;
  elevationGainMeters?: number;
  averageTemperatureC?: number;
  averageWindSpeedMps?: number;
  trainer?: boolean;
  poolLengthMeters?: number;
};

export type DailyRecoveryContext = {
  id: string;
  hrv?: number | null;
  sleepSecs?: number | null;
};

export type PerformanceInsight = {
  id: string;
  sport: string;
  headline: string;
  detail: string;
  matchedCount: number;
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function classifyWorkoutText(value: string) {
  const text = value.toLowerCase();
  if (/drill|technique|form|catch|kick/.test(text)) return "technique";
  if (/threshold|tempo|interval|track|vo2|vo₂|fartlek|repetition/.test(text)) return "quality";
  if (/long|endurance|steady|aerobic|easy|recovery|zone\s*2|z2/.test(text)) return "endurance";
  return null;
}

function workoutType(activity: PerformanceActivity) {
  return classifyWorkoutText(activity.plannedWorkoutTitle || activity.title)
    ?? classifyWorkoutText(activity.workoutDescription ?? "");
}

function localHour(activity: PerformanceActivity) {
  const value = activity.performedAt ?? "";
  const match = value.match(/T(\d{2}):\d{2}/);
  return match ? Number(match[1]) : null;
}

function close(a: number, b: number, tolerance: number) {
  return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b), 1) * tolerance;
}

function comparable(current: PerformanceActivity, prior: PerformanceActivity, type: string) {
  if (prior.status !== "completed" || prior.sport !== current.sport || prior.date >= current.date || workoutType(prior) !== type) return false;
  if (!finite(current.durationMinutes) || !finite(prior.durationMinutes) || !close(current.durationMinutes, prior.durationMinutes, 0.3)) return false;
  const currentHour = localHour(current);
  const priorHour = localHour(prior);
  if (currentHour === null || priorHour === null || Math.abs(currentHour - priorHour) > 2) return false;

  if (current.sport === "swim") {
    const currentText = `${current.plannedWorkoutTitle ?? ""} ${current.title} ${current.workoutDescription ?? ""}`.toLowerCase();
    const priorText = `${prior.plannedWorkoutTitle ?? ""} ${prior.title} ${prior.workoutDescription ?? ""}`.toLowerCase();
    const currentOpenWater = /open.water|lake|ocean|sea swim/.test(currentText);
    const priorOpenWater = /open.water|lake|ocean|sea swim/.test(priorText);
    const currentPool = finite(current.poolLengthMeters) && current.poolLengthMeters > 0;
    const priorPool = finite(prior.poolLengthMeters) && prior.poolLengthMeters > 0;
    if (currentOpenWater !== priorOpenWater || currentPool !== priorPool || (!currentOpenWater && !currentPool)) return false;
    if (currentPool && !close(current.poolLengthMeters!, prior.poolLengthMeters!, 0.05)) return false;
    if (!finite(current.distanceMeters) || !finite(prior.distanceMeters) || !close(current.distanceMeters, prior.distanceMeters, 0.2)) return false;
    if (currentOpenWater && (!finite(current.averageTemperatureC) || !finite(prior.averageTemperatureC) || Math.abs(current.averageTemperatureC - prior.averageTemperatureC) > 3)) return false;
    return true;
  }

  if (current.trainer !== prior.trainer) return false;

  // Outdoor effort comparisons need similar weather and climbing context.
  if (!current.trainer) {
    if (!finite(current.averageTemperatureC) || !finite(prior.averageTemperatureC) || Math.abs(current.averageTemperatureC - prior.averageTemperatureC) > 5) return false;
    if (!finite(current.averageWindSpeedMps) || !finite(prior.averageWindSpeedMps) || Math.abs(current.averageWindSpeedMps - prior.averageWindSpeedMps) > 3) return false;
    if (!finite(current.distanceMeters) || !finite(prior.distanceMeters) || current.distanceMeters <= 0 || prior.distanceMeters <= 0) return false;
    if (!finite(current.elevationGainMeters) || !finite(prior.elevationGainMeters)) return false;
    const currentClimb = current.elevationGainMeters / current.distanceMeters;
    const priorClimb = prior.elevationGainMeters / prior.distanceMeters;
    if (!close(currentClimb, priorClimb, 0.25)) return false;
  }
  return true;
}

function compareSport(sport: "bike" | "run" | "swim", activities: PerformanceActivity[]): PerformanceInsight | null {
  const ordered = activities
    .filter((activity) => activity.status === "completed" && activity.sport === sport && activity.date && workoutType(activity))
    .sort((a, b) => a.date.localeCompare(b.date));
  const current = ordered.at(-1);
  if (!current || !finite(current.averageHeartRate)) return null;
  const type = workoutType(current);
  if (!type) return null;
  const currentMetric = sport === "bike" ? current.weightedAveragePower ?? current.averagePower : current.averageSpeed;
  if (!finite(currentMetric) || currentMetric <= 0) return null;
  const prior = ordered.slice(0, -1).filter((activity) => comparable(current, activity, type) && finite(activity.averageHeartRate));
  if (prior.length < 3) return null;

  const powerOrSpeed = (activity: PerformanceActivity) => sport === "bike" ? activity.weightedAveragePower ?? activity.averagePower : activity.averageSpeed;
  const sameEffort = prior.filter((activity) => Math.abs(activity.averageHeartRate! - current.averageHeartRate!) <= 4 && finite(powerOrSpeed(activity)));
  if (sameEffort.length >= 3) {
    const baseline = median(sameEffort.map((activity) => powerOrSpeed(activity)!).filter(finite));
    const change = currentMetric / baseline - 1;
    if (Math.abs(change) >= 0.04) {
      const result = sport === "bike"
        ? `${Math.round(Math.abs(change) * 100)}% ${change > 0 ? "more power" : "less power"} at a similar heart rate`
        : `${Math.round(Math.abs(change) * 100)}% ${change > 0 ? "faster pace" : "slower pace"} at a similar heart rate`;
      const activityLabel = sport === "bike" ? "Ride" : sport === "run" ? "Run" : "Swim";
      return { id: current.id, sport, headline: `${activityLabel} comparison`, detail: `Your latest ${type} session showed ${result} than the median of ${sameEffort.length} similar sessions.`, matchedCount: sameEffort.length };
    }
  }

  const similarOutput = prior.filter((activity) => {
    const metric = powerOrSpeed(activity);
    return finite(metric) && close(currentMetric, metric, 0.05);
  });
  if (similarOutput.length >= 3) {
    const baselineHr = median(similarOutput.map((activity) => activity.averageHeartRate!));
    const difference = current.averageHeartRate - baselineHr;
    if (Math.abs(difference) >= 4) {
      const output = sport === "bike" ? "power" : "pace";
      const activityLabel = sport === "bike" ? "Ride" : sport === "run" ? "Run" : "Swim";
      return { id: current.id, sport, headline: `${activityLabel} comparison`, detail: `At a similar ${output}, your heart rate was ${Math.round(Math.abs(difference))} bpm ${difference < 0 ? "lower" : "higher"} than the median of ${similarOutput.length} similar sessions.`, matchedCount: similarOutput.length };
    }
  }
  return null;
}

function recoveryAssociation(sport: "bike" | "run" | "swim", activities: PerformanceActivity[], wellness: DailyRecoveryContext[]) {
  const ordered = activities
    .filter((activity) => activity.status === "completed" && activity.sport === sport && activity.date && workoutType(activity))
    .sort((a, b) => a.date.localeCompare(b.date));
  const current = ordered.at(-1);
  if (!current || !finite(current.averageHeartRate)) return null;
  const type = workoutType(current);
  if (!type) return null;
  const prior = ordered.slice(0, -1).filter((activity) => comparable(current, activity, type));
  const cohort = [...prior, current].flatMap((activity) => {
    const context = wellness.find((record) => record.id === activity.date);
    const metric = sport === "bike" ? activity.weightedAveragePower ?? activity.averagePower : activity.averageSpeed;
    if (!context || !finite(context.hrv) && !finite(context.sleepSecs) || !finite(metric) || !finite(activity.averageHeartRate) || activity.averageHeartRate <= 0) return [];
    return [{ activity, context, efficiency: metric / activity.averageHeartRate }];
  });
  if (cohort.length < 6) return null;

  const signals = [
    { key: "sleepSecs" as const, label: "sleep" },
    { key: "hrv" as const, label: "HRV" },
  ];
  for (const signal of signals) {
    const available = cohort.filter((entry) => finite(entry.context[signal.key]));
    if (available.length < 6) continue;
    const threshold = median(available.map((entry) => entry.context[signal.key]!));
    const higher = available.filter((entry) => entry.context[signal.key]! > threshold);
    const lower = available.filter((entry) => entry.context[signal.key]! < threshold);
    if (higher.length < 3 || lower.length < 3) continue;
    const change = median(higher.map((entry) => entry.efficiency)) / median(lower.map((entry) => entry.efficiency)) - 1;
    if (Math.abs(change) < 0.08) continue;
    const sportLabel = sport === "bike" ? "rides" : sport === "run" ? "runs" : "swims";
    const performanceMetric = sport === "bike" ? "power per heartbeat" : "speed relative to heart rate";
    const headline = `${sport === "bike" ? "Ride" : sport === "run" ? "Run" : "Swim"} · ${signal.label}`;
    return {
      id: `${current.id}-${signal.key}`,
      sport,
      headline,
      detail: `Across similar ${sportLabel}, ${performanceMetric} was ${Math.round(Math.abs(change) * 100)}% ${change > 0 ? "higher" : "lower"} on days above your matched-workout ${signal.label} median (${higher.length} vs ${lower.length} sessions). This is an association, not proof of cause.`,
      matchedCount: higher.length + lower.length,
    } satisfies PerformanceInsight;
  }
  return null;
}

/** Descriptive comparisons only; only reports a pattern when prior sessions closely match type and conditions. */
export function comparablePerformanceInsights(activities: PerformanceActivity[], wellness: DailyRecoveryContext[] = []): PerformanceInsight[] {
  const bike = compareSport("bike", activities);
  const run = compareSport("run", activities);
  const swim = compareSport("swim", activities);
  const recoveryPatterns = [
    recoveryAssociation("swim", activities, wellness),
    recoveryAssociation("bike", activities, wellness),
    recoveryAssociation("run", activities, wellness),
  ];
  return [...[swim, bike, run], ...recoveryPatterns].filter((insight): insight is PerformanceInsight => insight !== null).slice(0, 4);
}
