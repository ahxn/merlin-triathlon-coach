type HrvRecord = { id: string; hrv?: number | null };
type SleepScoreRecord = { id: string; sleepScore?: number | null };

export const HRV_BASELINE_MIN_READINGS = 21;
export const HRV_BASELINE_WINDOW_DAYS = 90;
export const HRV_RECENT_EXCLUSION_DAYS = 30;
export const SLEEP_SCORE_BASELINE_MIN_READINGS = 21;
export const SLEEP_SCORE_BASELINE_WINDOW_DAYS = 90;
export const SLEEP_SCORE_RECENT_EXCLUSION_DAYS = 0;

function shiftIsoDate(date: string, days: number) {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function historicalMetricBaseline<T extends { id: string }>(
  records: T[],
  readMetric: (record: T) => unknown,
  date: string,
  windowDays: number,
  recentExclusionDays: number,
  minReadings: number,
) {
  const latestReferenceDate = shiftIsoDate(date, -recentExclusionDays - 1);
  const earliestReferenceDate = shiftIsoDate(date, -recentExclusionDays - windowDays);
  const values = records
    .filter((record) => record.id >= earliestReferenceDate && record.id <= latestReferenceDate)
    .map(readMetric)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const count = values.length;
  if (count < minReadings) return { count, center: null, spread: null, ready: false };
  const center = median(values);
  const medianAbsoluteDeviation = median(values.map((value) => Math.abs(value - center)));
  const spread = Math.max(1.4826 * medianAbsoluteDeviation, Math.abs(center) * 0.03);
  return { count, center, spread, ready: true };
}

/** Exclude recent HRV so a low stretch cannot pull its own reference down. */
export function historicalHrvBaseline(records: HrvRecord[], date: string) {
  return historicalMetricBaseline(records, (record) => record.hrv, date, HRV_BASELINE_WINDOW_DAYS, HRV_RECENT_EXCLUSION_DAYS, HRV_BASELINE_MIN_READINGS);
}

/** Use the full prior 90 days through yesterday so the reference reflects the recent sleep pattern. */
export function historicalSleepScoreBaseline(records: SleepScoreRecord[], date: string) {
  return historicalMetricBaseline(records, (record) => record.sleepScore, date, SLEEP_SCORE_BASELINE_WINDOW_DAYS, SLEEP_SCORE_RECENT_EXCLUSION_DAYS, SLEEP_SCORE_BASELINE_MIN_READINGS);
}
