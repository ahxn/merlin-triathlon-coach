import type { PlanPreferences } from "./data-api";

export type WorkoutDisplayMode = "time" | "distance" | "both";
type Sport = "swim" | "bike" | "run";
type Workout = { sport: Sport; duration: string; durationMinutes?: number; workoutDescription?: string };
type Activity = { sport: string; date: string; status: string; durationMinutes?: number; distanceMeters?: number };
type UnitSystem = "metric" | "imperial";
type DistanceEstimate = { meters: number; source: "planned target" | "recent pace" | "typical pace" };

const fallbackMetersPerSecond: Record<Sport, number> = { swim: 0.5, bike: 22 / 3.6, run: 8 / 3.6 };
const distanceMeters = (amount: number, unit: string) => unit === "km" ? amount * 1000 : unit === "mi" ? amount * 1609.344 : unit === "yd" ? amount / 1.09361 : amount;

function median(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function recentMetersPerSecond(sport: Sport, activities: Activity[]) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 120);
  const speeds = activities
    .filter((activity) => activity.sport === sport && activity.status === "completed" && activity.distanceMeters && activity.durationMinutes && Date.parse(`${activity.date}T12:00:00`) >= cutoff.getTime())
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 12)
    .map((activity) => activity.distanceMeters! / (activity.durationMinutes! * 60))
    .filter((speed) => speed >= (sport === "swim" ? 0.2 : sport === "bike" ? 1 : 0.5) && speed <= (sport === "swim" ? 2.5 : sport === "bike" ? 18 : 8.5));
  return speeds.length >= 3 ? median(speeds) : null;
}

export function estimateWorkoutDistance(plan: PlanPreferences, workout: Workout, activities: Activity[]): DistanceEstimate | null {
  if (plan.volumeBasis === "distance" && workout.workoutDescription) {
    const target = /Approximate session target:\s*([\d,.]+)\s*(m|km|yd|mi)\b/i.exec(workout.workoutDescription);
    if (target) return { meters: distanceMeters(Number(target[1].replace(/,/g, "")), target[2].toLowerCase()), source: "planned target" };
  }
  const minutes = workout.durationMinutes ?? Number(workout.duration.match(/[\d.]+/)?.[0]);
  if (!minutes || minutes <= 0) return null;
  const personalSpeed = recentMetersPerSecond(workout.sport, activities);
  return {
    meters: minutes * 60 * (personalSpeed ?? fallbackMetersPerSecond[workout.sport]),
    source: personalSpeed === null ? "typical pace" : "recent pace",
  };
}

export function formatWorkoutDistance(meters: number, sport: Sport, units: UnitSystem) {
  if (sport === "swim") return units === "metric" ? `${Math.round(meters)} m` : `${Math.round(meters * 1.09361)} yd`;
  return units === "metric"
    ? meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
    : `${(meters / 1609.344).toFixed(meters >= 16093 ? 0 : 1)} mi`;
}

export function workoutTargetLabel(plan: PlanPreferences, workout: Workout, activities: Activity[], units: UnitSystem) {
  const display = plan.workoutDisplay ?? "time";
  const time = `${plan.volumeBasis === "distance" ? "~" : ""}${workout.duration.replace(/^~/, "")}`;
  if (display === "time") return time;
  const estimate = estimateWorkoutDistance(plan, workout, activities);
  if (!estimate) return display === "both" ? time : "Distance unavailable";
  const distance = `${estimate.source === "planned target" ? "" : "~"}${formatWorkoutDistance(estimate.meters, workout.sport, units)}`;
  if (display === "distance") return distance;
  return `${time} · ${distance}`;
}

export function workoutDescriptionForDisplay(plan: PlanPreferences, workout: Workout, activities: Activity[], units: UnitSystem) {
  const display = plan.workoutDisplay ?? "time";
  const estimate = display === "time" ? null : estimateWorkoutDistance(plan, workout, activities);
  const time = `${plan.volumeBasis === "distance" ? "Estimated time" : "Planned duration"}: ${plan.volumeBasis === "distance" ? "~" : ""}${workout.duration.replace(/^~/, "")}.`;
  const distance = estimate
    ? `${estimate.source === "planned target" ? "Target distance" : "Estimated distance"}: ${estimate.source === "planned target" ? "" : "~"}${formatWorkoutDistance(estimate.meters, workout.sport, units)}${estimate.source === "recent pace" ? " (based on recent activities)" : estimate.source === "typical pace" ? " (typical pace estimate)" : ""}.`
    : "Distance estimate unavailable.";
  const summary = display === "time" ? time : display === "distance" ? distance : `${time} ${distance}`;
  const body = workout.workoutDescription?.replace(/^(?:Planned duration|Estimated time|Approximate session target):[^\n]*(?:\n|$)/, "").trim();
  return body ? `${summary}\n${body}` : summary;
}
