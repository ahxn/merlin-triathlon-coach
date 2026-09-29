export const HEART_RATE_ZONE_BANDS = [
  { zone: 1, label: "Recovery", from: 0.5, to: 0.6 },
  { zone: 2, label: "Easy aerobic", from: 0.6, to: 0.7 },
  { zone: 3, label: "Aerobic", from: 0.7, to: 0.8 },
  { zone: 4, label: "Threshold", from: 0.8, to: 0.9 },
  { zone: 5, label: "High intensity", from: 0.9, to: 1 },
] as const;

export type HeartRateZoneRange = { zone: number; label: string; lower: number; upper: number };

export function heartRateZoneUpperBoundsFromMax(maxHeartRate: number) {
  return HEART_RATE_ZONE_BANDS.map(({ to }) => Math.round(maxHeartRate * to));
}

export function heartRateZonesFromMax(maxHeartRate: number, upperBounds?: number[] | null, zoneNames?: string[] | null): HeartRateZoneRange[] {
  const bounds = upperBounds && upperBounds.length >= 3
    ? upperBounds
    : heartRateZoneUpperBoundsFromMax(maxHeartRate);
  return bounds.map((upper, index) => ({
    zone: index + 1,
    label: zoneNames?.[index] || HEART_RATE_ZONE_BANDS[index]?.label || `Custom ${index + 1}`,
    lower: index === 0 ? Math.round(maxHeartRate * HEART_RATE_ZONE_BANDS[0].from) : bounds[index - 1] + 1,
    upper,
  }));
}

export function heartRateZoneTarget(maxHeartRate: number | null | undefined, zone: number, upperBounds?: number[] | null) {
  if (!maxHeartRate || !Number.isFinite(maxHeartRate)) return null;
  const range = heartRateZonesFromMax(maxHeartRate, upperBounds).find((item) => item.zone === zone);
  return range && range.lower <= range.upper ? `${range.lower}–${range.upper} bpm` : null;
}
