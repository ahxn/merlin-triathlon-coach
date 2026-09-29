export type RunPaceUnit = "mi" | "km";

const SECONDS_PER_MILE = 1_609.344;

type PaceDefinition = {
  id: string;
  label: string;
  repRange: string;
  easyPaceRatio: number;
};

// Ratios calibrated to the example easy-pace calculator. These entries describe
// workout repetition duration; race-pace references do not belong in this table.
const paceDefinitions: PaceDefinition[] = [
  { id: "5k", label: "5K pace", repRange: "Under 1-minute reps", easyPaceRatio: 420 / 591 },
  { id: "10k", label: "10K pace", repRange: "1–2-minute reps", easyPaceRatio: 438 / 591 },
  { id: "3-minute", label: "3-minute reps", repRange: "2:01–4:30 reps", easyPaceRatio: 443 / 591 },
  { id: "6-minute", label: "6-minute reps", repRange: "4:31–8:00 reps", easyPaceRatio: 454 / 591 },
  { id: "10-minute", label: "10-minute reps", repRange: "8:01–13:00 reps", easyPaceRatio: 468 / 591 },
  { id: "half-marathon", label: "Half marathon reps", repRange: "13:01–30:00 reps", easyPaceRatio: 472 / 591 },
  { id: "marathon", label: "Marathon reps", repRange: "30:01+ reps", easyPaceRatio: 476 / 591 },
];

export function paceSecondsPerKmFromInput(value: string, unit: RunPaceUnit) {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const secondsPerUnit = Number(match[1]) * 60 + Number(match[2]);
  if (secondsPerUnit < 120 || secondsPerUnit > 1800) return null;
  return Math.round(unit === "mi" ? secondsPerUnit / (SECONDS_PER_MILE / 1000) : secondsPerUnit);
}

export function formatRunPace(secondsPerKm: number, unit: RunPaceUnit) {
  const seconds = Math.max(1, Math.round(secondsPerKm * (unit === "mi" ? SECONDS_PER_MILE / 1000 : 1)));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}/${unit}`;
}

export function getRunTrainingPaces(easyPaceSecondsPerKm: number | null | undefined, unit: RunPaceUnit) {
  return paceDefinitions.map((pace) => {
    const secondsPerKm = easyPaceSecondsPerKm ? Math.round(easyPaceSecondsPerKm * pace.easyPaceRatio) : null;
    return {
      ...pace,
      secondsPerKm,
      formatted: secondsPerKm === null ? "—" : formatRunPace(secondsPerKm, unit),
    };
  });
}

export function getRunRepPace(easyPaceSecondsPerKm: number | null | undefined, repSeconds: number, unit: RunPaceUnit) {
  if (!easyPaceSecondsPerKm) return null;
  const paceId = repSeconds <= 60 ? "5k" : repSeconds <= 120 ? "10k" : repSeconds <= 270 ? "3-minute" : repSeconds <= 480 ? "6-minute" : repSeconds <= 780 ? "10-minute" : repSeconds <= 1800 ? "half-marathon" : "marathon";
  const pace = getRunTrainingPaces(easyPaceSecondsPerKm, unit).find((item) => item.id === paceId);
  return pace ? { label: pace.label, formatted: pace.formatted } : null;
}
