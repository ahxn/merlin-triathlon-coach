import type { PlanPreferences } from "./data-api";
import { trainingTemplateCue } from "./training-examples";
import { recentMetersPerSecond } from "./workout-display";
import { formatRunPace, getRunRepPace } from "./run-training-paces";
import { heartRateZoneTarget } from "./heart-rate-zones";

type PlannedSession = PlanPreferences["manualSessions"][number];
type Sport = PlannedSession["sport"];
type RecentSession = { sport: string; date: string; duration: string; status: string; durationMinutes?: number; distanceMeters?: number };

const roundToFive = (value: number) => Math.max(5, Math.round(value / 5) * 5);
const titleCase = (value: string) => `${value[0].toUpperCase()}${value.slice(1)}`;
const formatSeconds = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export function workoutFocusLabel(sport: Sport, quality: boolean, swimVariant: "technique" | "endurance") {
  if (quality) return sport === "bike" ? "Threshold" : sport === "run" ? "Speed" : "Steady";
  if (sport === "swim") return swimVariant === "technique" ? "Technique" : "Aerobic";
  return "Zone 2";
}

function sessionMinutes(session: PlannedSession) {
  if (typeof session.durationMinutes === "number" && Number.isFinite(session.durationMinutes) && session.durationMinutes > 0) {
    return session.durationMinutes;
  }
  return durationToMinutes(session.duration) ?? 30;
}

function distanceToKilometers(sport: Sport, distance: number, unit: string) {
  if (sport === "swim") return unit === "m" ? distance / 1000 : distance * 0.0009144;
  return unit === "mi" ? distance * 1.609344 : distance;
}

function intervalRepDistance(sport: Sport, unit: string) {
  if (sport === "swim") return unit === "yd" ? "50 yd" : "50 m";
  if (sport === "run") return unit === "mi" ? "0.25 mi" : unit === "km" ? "0.4 km" : unit === "yd" ? "440 yd" : "400 m";
  return unit === "mi" ? "0.6 mi" : unit === "km" ? "1 km" : unit === "yd" ? "1,094 yd" : "1,000 m";
}

export function weeklyTargetMinutes(plan: PlanPreferences, sport: Sport, level: "weekly" | "peak" = "weekly", recentSessions: RecentSession[] = []) {
  if (plan.volumeBasis === "time") return (plan.timeTargets[sport][level] ?? plan.timeTargets[sport].weekly ?? 0) * 60;
  const distance = plan.distanceTargets[sport][level] ?? plan.distanceTargets[sport].weekly ?? 0;
  const unit = plan.distanceTargets[sport].unit;
  const kilometers = distanceToKilometers(sport, distance, unit);
  const personalSpeed = recentMetersPerSecond(sport, recentSessions);
  const estimatedSpeedKph = personalSpeed ? personalSpeed * 3.6 : sport === "swim" ? 1.8 : sport === "bike" ? 22 : 8;
  return kilometers / estimatedSpeedKph * 60;
}

export function recommendedSessionCap(plan: PlanPreferences, sport: Sport, quality = false) {
  const ordinaryLimits = { swim: 60, bike: 120, run: 75 };
  const qualityLimits = { swim: 45, bike: 75, run: 45 };
  const limit = quality ? qualityLimits[sport] : ordinaryLimits[sport];
  return Math.min(Math.max(15, plan.maxSessionMinutes || 90), limit);
}

export function workoutDetails(plan: PlanPreferences, sport: Sport, minutes: number, quality: boolean, distanceTarget: number, distanceUnit: string, swimVariant: "technique" | "endurance" = "technique") {
  const warmup = minutes < 20 ? 3 : Math.min(10, Math.max(5, roundToFive(minutes * 0.2)));
  const cooldown = Math.min(5, Math.max(3, Math.round(minutes * 0.1)));
  const mainMinutes = Math.max(5, minutes - warmup - cooldown);
  const swimRepDistance = intervalRepDistance("swim", plan.distanceTargets.swim.unit);
  let mainSet: string;

  if (quality && minutes >= 15) {
    if (sport === "run") {
      const recovery = plan.runIntervalRecoverySeconds ?? { short: 60, medium: 90, long: 120 };
      const repSeconds = minutes < 20 ? 60 : 2 * 60;
      const recoverySeconds = minutes < 20 ? 60 : repSeconds <= 90 ? 30 : repSeconds <= 270 ? recovery.short : repSeconds <= 480 ? recovery.medium : repSeconds < 780 ? recovery.long : 180;
      const unit = plan.distanceTargets.run.unit;
      const targetPace = getRunRepPace(plan.easyRunPaceSecondsPerKm, repSeconds, unit);
      const effort = targetPace ? `${targetPace.label} (${targetPace.formatted})` : "a fast, controlled interval effort";
      mainSet = `4 × ${formatSeconds(repSeconds)} at ${effort}, with ${formatSeconds(recoverySeconds)} recovery jogging between repetitions.`;
    } else if (sport === "bike") {
      const ftpTarget = plan.ftpWatts
        ? ` at 95–105% FTP (${Math.round(plan.ftpWatts * 0.95)}–${Math.round(plan.ftpWatts * 1.05)} W)`
        : " at threshold effort";
      mainSet = minutes < 20
        ? `4 × 1 minute${ftpTarget}, with 1 minute relaxed spinning between repetitions.`
        : minutes < 25
          ? `3 × 3 minutes${ftpTarget}, with 1:30 relaxed spinning between repetitions.`
          : minutes < 32
            ? `4 × 3 minutes${ftpTarget}, with 1:30 relaxed spinning between repetitions.`
            : minutes < 40
              ? `4 × 4 minutes${ftpTarget}, with 1:30 relaxed spinning between repetitions.`
              : `4 × 4 minutes${ftpTarget}, with 3 minutes relaxed spinning between repetitions.`;
    } else {
      const repetitions = minutes < 25 ? 4 : 8;
      mainSet = `${repetitions} × ${swimRepDistance} at a smooth, steady effort, with 20–30 seconds rest. Keep technique relaxed.`;
    }
  } else if (sport === "swim" && swimVariant === "endurance") {
    mainSet = `Swim at a relaxed, conversational effort, keeping a steady rhythm. Swim continuously or break the time into repeats of ${swimRepDistance}; rest briefly to keep your form smooth.`;
  } else if (sport === "swim") {
    mainSet = `Swim relaxed lengths at a conversational effort. Include 6 × ${swimRepDistance.replace(/^50/, "25")} of relaxed technique practice, resting as needed to keep form smooth.`;
  } else if (sport === "run") {
    const maxHeartRate = plan.maxHeartRate;
    const zoneTwoTarget = heartRateZoneTarget(maxHeartRate, 2, plan.heartRateZoneUpperBounds?.run);
    const heartRateGuide = zoneTwoTarget ? ` If you train by heart rate, aim for Zone 2 (${zoneTwoTarget}); adjust to your personal zones and how you feel.` : "";
    const easyPaceGuide = plan.easyRunPaceSecondsPerKm
      ? ` Run at or slower than ${formatRunPace(plan.easyRunPaceSecondsPerKm, plan.distanceTargets.run.unit)}.`
      : "";
    mainSet = `Stay at a relaxed, conversational effort for ${mainMinutes} minutes. Take brief walking breaks whenever needed to keep the effort controlled.${easyPaceGuide}${heartRateGuide}`;
  } else if (sport === "bike") {
    const powerGuide = plan.ftpWatts
      ? ` Aim for 56–75% FTP (${Math.round(plan.ftpWatts * 0.56)}–${Math.round(plan.ftpWatts * 0.75)} W) as a Zone 2 guide.`
      : "";
    const heartRateGuide = heartRateZoneTarget(plan.maxHeartRate, 2, plan.heartRateZoneUpperBounds?.bike);
    const heartRateCue = heartRateGuide ? ` Heart-rate guide: Zone 2 (${heartRateGuide}).` : "";
    mainSet = `Ride steadily at an aerobic, conversational effort for ${mainMinutes} minutes.${powerGuide}${heartRateCue} Keep the effort controlled and finish feeling able to continue.`;
  } else {
    mainSet = `Stay at a relaxed, conversational effort for ${mainMinutes} minutes. Keep the effort controlled and finish feeling able to continue.`;
  }

  const total = plan.volumeBasis === "distance"
    ? `Approximate session target: ${Number(distanceTarget.toFixed(sport === "swim" ? 0 : 1))} ${distanceUnit}. Estimated time is a guide based on typical speeds; adjust to your own pace.`
    : `Planned duration: ${minutes} minutes.`;
  const warmDescription = sport === "swim" ? "relaxed swimming" : sport === "bike" ? "relaxed spinning" : "relaxed walking or jogging";
  const cooldownDescription = sport === "swim" ? "relaxed swimming" : sport === "bike" ? "relaxed spinning" : "relaxed jogging or walking";
  const templateCue = trainingTemplateCue(sport, quality);
  return `${total}\nWarm-up: ${warmup} minutes of ${warmDescription}.\nMain set: ${mainSet}\nCool-down: ${cooldown} minutes of ${cooldownDescription}.${templateCue ? `\nTemplate note: ${templateCue}` : ""}`;
}


const scheduleDays: PlanPreferences["manualSessions"][number]["day"][] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const draftDayOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function buildInitialWeeklySchedule(plan: PlanPreferences) {
  const requestedCount = Math.min(14, Math.max(3, Math.round(plan.sessionsPerWeek || 6)));
  const sports: Sport[] = ["swim", "bike", "run"];
  const balancedFocus = plan.primaryFocus === "balanced";
  const runFocused = plan.primaryFocus === "run";
  const scheduleCount = balancedFocus ? Math.min(requestedCount, 9) : requestedCount;
  const targetCounts = new Map<Sport, number>();
  if (balancedFocus) {
    if (requestedCount >= 9) {
      // Keep the core bike/run structure to one quality, one aerobic, and one
      // long workout. Extra available slots should not fragment either sport's
      // weekly volume into another short endurance session.
      targetCounts.set("bike", 3);
      targetCounts.set("run", 3);
      targetCounts.set("swim", 3);
    } else {
      const base = Math.floor(requestedCount / sports.length);
      for (const sport of sports) targetCounts.set(sport, base);
      const extraOrder: Sport[] = ["bike", "run", "swim"];
      for (let extra = requestedCount % sports.length, index = 0; extra > 0; extra--, index++) {
        const sport = extraOrder[index % extraOrder.length];
        targetCounts.set(sport, (targetCounts.get(sport) ?? 0) + 1);
      }
    }

    // A third session only adds value when two sessions cannot reasonably carry
    // that sport's weekly target. In particular, avoid splitting a low-volume
    // bike week into intervals, a long ride, and a short extra endurance ride.
    for (const sport of sports) {
      const twoSessionCapacity = sport === "swim"
        ? recommendedSessionCap(plan, sport) * 2
        : recommendedSessionCap(plan, sport, true) + recommendedSessionCap(plan, sport);
      if (weeklyTargetMinutes(plan, sport) <= twoSessionCapacity) {
        targetCounts.set(sport, Math.min(targetCounts.get(sport) ?? 0, 2));
      }
    }
  }
  const sessions: PlannedSession[] = [];
  const sessionPreference = (sport: Sport, session: PlannedSession) => {
    const interval = session.quality || /interval/i.test(session.title) ? 1 : 0;
    const preferredLongDay = sport === "bike" ? plan.longBikeDay : sport === "run" ? plan.longRunDay : "";
    const longDay = preferredLongDay && session.day === preferredLongDay ? 1 : 0;
    return [interval, longDay, sessionMinutes(session)];
  };
  for (const sport of sports) {
    const candidate = plan.manualSessions
      .filter((session) => session.sport === sport)
      .sort((a, b) => {
        const aPriority = sessionPreference(sport, a);
        const bPriority = sessionPreference(sport, b);
        return bPriority[0] - aPriority[0] || bPriority[1] - aPriority[1] || bPriority[2] - aPriority[2];
      })[0];
    if (candidate && sessions.length < scheduleCount) sessions.push({ ...candidate });
  }
  if (balancedFocus) {
    for (const sport of sports) {
      const sportCount = sessions.filter((session) => session.sport === sport).length;
      const quota = targetCounts.get(sport) ?? 0;
      const candidates = plan.manualSessions
        .filter((session) => session.sport === sport && !sessions.some((selected) => selected.id === session.id))
        .sort((a, b) => {
          const aPriority = sessionPreference(sport, a);
          const bPriority = sessionPreference(sport, b);
          return bPriority[0] - aPriority[0] || bPriority[1] - aPriority[1] || bPriority[2] - aPriority[2];
        });
      for (const candidate of candidates.slice(0, Math.max(0, quota - sportCount))) sessions.push({ ...candidate });
    }
  } else {
    for (const existing of plan.manualSessions) {
      if (sessions.length >= scheduleCount) break;
      if (sessions.some((session) => session.id === existing.id)) continue;
      sessions.push({ ...existing });
    }
  }
  const counts = new Map<Sport, number>(sports.map((sport) => [sport, sessions.filter((session) => session.sport === sport).length]));
  if (balancedFocus) {
    while ((counts.get("run") ?? 0) > (counts.get("bike") ?? 0) && (counts.get("run") ?? 0) > 1) {
      const runSession = [...sessions].reverse().find((session) => session.sport === "run" && !session.quality && !/interval/i.test(session.title));
      if (!runSession) break;
      runSession.sport = "bike";
      runSession.title = "Bike session";
      runSession.duration = "";
      runSession.durationOverrideMinutes = undefined;
      runSession.intensity = "Endurance";
      runSession.quality = false;
      counts.set("run", (counts.get("run") ?? 0) - 1);
      counts.set("bike", (counts.get("bike") ?? 0) + 1);
    }
  } else if (runFocused) {
    while ((counts.get("bike") ?? 0) > (counts.get("run") ?? 0) && (counts.get("bike") ?? 0) > 1) {
      const bikeSession = [...sessions].reverse().find((session) => session.sport === "bike" && !session.quality && !/interval/i.test(session.title));
      if (!bikeSession) break;
      bikeSession.sport = "run";
      bikeSession.title = "Run session";
      bikeSession.duration = "";
      bikeSession.durationOverrideMinutes = undefined;
      bikeSession.intensity = "Endurance";
      bikeSession.quality = false;
      counts.set("bike", (counts.get("bike") ?? 0) - 1);
      counts.set("run", (counts.get("run") ?? 0) + 1);
    }
  }

  const runFocusedSessionTarget = runFocused ? Math.max(1, Math.ceil(requestedCount * 0.5)) : 0;
  while (sessions.length < scheduleCount) {
    const missingSports = sports.filter((item) => (counts.get(item) ?? 0) === 0);
    const candidates = balancedFocus
      ? sports.filter((sport) => (counts.get(sport) ?? 0) < (targetCounts.get(sport) ?? 0))
      : missingSports.length ? missingSports : sports;
    const eligibleCandidates = balancedFocus
      ? candidates
      : runFocused && (counts.get("run") ?? 0) < runFocusedSessionTarget && candidates.includes("run")
        ? candidates.filter((sport) => sport === "run")
        : runFocused && (counts.get("run") ?? 0) >= runFocusedSessionTarget && candidates.some((sport) => sport !== "run")
          ? candidates.filter((sport) => sport !== "run")
          : runFocused && (counts.get("run") ?? 0) <= (counts.get("bike") ?? 0)
            ? candidates.filter((sport) => sport !== "bike")
            : candidates;
    const sport = eligibleCandidates.sort((a, b) => {
      const score = (candidate: Sport) => {
        const count = counts.get(candidate) ?? 0;
        const focusBoost = plan.primaryFocus === candidate ? 1.2 : 1;
        return weeklyTargetMinutes(plan, candidate) * focusBoost / (count + 1);
      };
      return score(b) - score(a);
    })[0];
    if (!sport) break;
    const index = counts.get(sport) ?? 0;
    sessions.push({
      id: crypto.randomUUID(),
      day: "",
      sport,
      title: `${titleCase(sport)} session`,
      duration: "",
      intensity: "Endurance",
      quality: false,
    });
    counts.set(sport, index + 1);
  }

  const allowedDays = draftDayOrder.filter((day) => !plan.restDays.includes(day));
  const availableDays = allowedDays.length ? allowedDays : draftDayOrder;
  const originalDays = new Map(sessions.map((session) => [session.id, session.day]));
  const sportIndices = new Map<Sport, PlannedSession[]>(sports.map((sport) => [sport, sessions.filter((session) => session.sport === sport)]));
  const dayAssignments = new Map<string, PlannedSession[]>(availableDays.map((day) => [day, []]));
  const dayDistance = (a: string, b: string) => {
    const gap = Math.abs(draftDayOrder.indexOf(a) - draftDayOrder.indexOf(b));
    return Math.min(gap, draftDayOrder.length - gap);
  };
  const longSessionIds = new Map<Sport, string>();
  for (const sport of ["bike", "run"] as const) {
    const sportSessions = sportIndices.get(sport) ?? [];
    const longestSession = [...sportSessions].sort((a, b) => sessionMinutes(b) - sessionMinutes(a))[0];
    if (longestSession) longSessionIds.set(sport, longestSession.id);
  }
  const intervalSports: Sport[] = plan.primaryFocus === "balanced"
    ? ["bike", "run"]
    : [plan.primaryFocus];
  for (const sport of intervalSports) {
    const sportSessions = sportIndices.get(sport) ?? [];
    if (sportSessions.length < 2) continue;
    for (const item of sportSessions) item.quality = false;
    const candidates = sportSessions.filter((item) => item.id !== longSessionIds.get(sport));
    const intervalSession = [...candidates].sort((a, b) => {
      const aPriority = Number(a.title.toLowerCase().includes("interval")) * 2 + Number(plan.qualityDays.includes(originalDays.get(a.id) ?? ""));
      const bPriority = Number(b.title.toLowerCase().includes("interval")) * 2 + Number(plan.qualityDays.includes(originalDays.get(b.id) ?? ""));
      return bPriority - aPriority || sessionMinutes(b) - sessionMinutes(a);
    })[0];
    if (intervalSession) intervalSession.quality = true;
  }
  const longDayBySport: Partial<Record<Sport, string>> = {
    bike: plan.longBikeDay === plan.longRunDay ? "Sat" : plan.longBikeDay,
    run: plan.longRunDay === plan.longBikeDay ? "Sun" : plan.longRunDay,
  };
  const protectedWeekendDays = new Set(["Sat", "Sun"]);
  const sessionPriority = (session: PlannedSession) => {
    const originalDay = originalDays.get(session.id) ?? "";
    const isLongSession = longSessionIds.get(session.sport) === session.id;
    const isQualitySession = session.quality || /interval/i.test(session.title) || plan.qualityDays.includes(originalDay);
    return isLongSession ? 0 : isQualitySession ? 1 : session.sport === "run" ? 2 : 3;
  };
  const orderedSessions = [...sessions].sort((a, b) => sessionPriority(a) - sessionPriority(b));
  const assignedQualityDays: string[] = [];

  for (const session of orderedSessions) {
    const isLongSession = longSessionIds.get(session.sport) === session.id;
    const openDays = availableDays.filter((day) => (dayAssignments.get(day)?.length ?? 0) < 2);
    const nonLongEndurance = (session.sport === "bike" || session.sport === "run") && !isLongSession;
    const weekdayOptions = nonLongEndurance ? openDays.filter((day) => !protectedWeekendDays.has(day)) : openDays;
    const candidates = weekdayOptions.length ? weekdayOptions : openDays;
    const daysWithoutSameSport = candidates.filter((day) => !dayAssignments.get(day)?.some((item) => item.sport === session.sport));
    const daysWithRecovery = daysWithoutSameSport.filter((day) =>
      availableDays
        .filter((assignedDay) => dayAssignments.get(assignedDay)?.some((item) => item.sport === session.sport))
        .every((assignedDay) => dayDistance(day, assignedDay) > 1),
    );
    const placementDays = daysWithRecovery.length
      ? daysWithRecovery
      : daysWithoutSameSport.length
        ? daysWithoutSameSport
        : candidates;
    const originalDay = originalDays.get(session.id) ?? "";
    const preferredDay = session.sport === "bike" || session.sport === "run" ? longDayBySport[session.sport] ?? "" : "";
    const prefersQualityDay = session.quality || /interval/i.test(session.title) || plan.qualityDays.includes(originalDay);
    const assignedSportDays = availableDays.filter((day) => dayAssignments.get(day)?.some((item) => item.sport === session.sport));
    const separatedPlacementDays = prefersQualityDay
      ? placementDays.filter((day) => assignedQualityDays.every((qualityDay) => dayDistance(day, qualityDay) > 1))
      : [];
    const separatedOpenDays = prefersQualityDay
      ? candidates.filter((day) => assignedQualityDays.every((qualityDay) => dayDistance(day, qualityDay) > 1))
      : [];
    const qualitySafeDays = separatedPlacementDays.length ? separatedPlacementDays : separatedOpenDays;
    const finalPlacementDays = qualitySafeDays.length ? qualitySafeDays : placementDays;
    const day = [...finalPlacementDays].sort((a, b) => {
      const score = (candidate: string) => {
        const dayWorkouts = dayAssignments.get(candidate) ?? [];
        const closestSameSport = assignedSportDays.length ? Math.min(...assignedSportDays.map((sportDay) => dayDistance(candidate, sportDay))) : 7;
        const qualityPenalty = prefersQualityDay && !plan.qualityDays.includes(candidate) ? 4 : 0;
        const longDayPenalty = isLongSession ? dayDistance(candidate, preferredDay) * 5 : 0;
        const keepDayBonus = candidate === originalDay ? -2 : 0;
        const adjacentSameSportDays = assignedSportDays.filter((sportDay) => dayDistance(candidate, sportDay) === 1).length;
        const spacingPenalty = adjacentSameSportDays * 24 + (closestSameSport === 2 ? 4 : 0);
        const closestQualityDay = assignedQualityDays.length ? Math.min(...assignedQualityDays.map((qualityDay) => dayDistance(candidate, qualityDay))) : 7;
        const qualitySpacingPenalty = prefersQualityDay && closestQualityDay <= 1 ? 48 : 0;
        return dayWorkouts.length * 100 + qualityPenalty + longDayPenalty + spacingPenalty + qualitySpacingPenalty + keepDayBonus;
      };
      return score(a) - score(b) || draftDayOrder.indexOf(a) - draftDayOrder.indexOf(b);
    })[0];
    session.day = day ?? "";
    if (day) {
      dayAssignments.get(day)?.push(session);
      if (prefersQualityDay) assignedQualityDays.push(day);
    }
  }
  return sessions;
}

function durationToMinutes(duration: string) {
  const match = duration.match(/(?:(\d+)\s*hr)?\s*(?:(\d+)\s*min)?/i);
  if (!match || (!match[1] && !match[2])) return null;
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

function mondayOf(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function minutesLabel(minutes: number) {
  const rounded = roundToFive(minutes);
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return hours ? `${hours} h${rest ? ` ${rest} min` : ""}` : `${rest} min`;
}

export function generateWeeklyWorkouts(plan: PlanPreferences, recentSessions: RecentSession[] = []) {
  const sessions = plan.manualSessions.map((session) => ({ ...session }));
  const runFocused = plan.primaryFocus === "run";
  const warnings: string[] = [];
  const historyAdjustments: Array<{ sport: Sport; targetMinutes: number; rampTargetMinutes: number; startingMinutes: number; medianMinutes: number; completedWeeks: number }> = [];
  const maxMinutes = Math.max(15, plan.maxSessionMinutes || 90);
  const targetMinutesBySport = new Map<Sport, number>();
  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const currentWeek = mondayOf(localToday);
  const currentWeekDate = new Date(`${currentWeek}T00:00:00Z`);
  const latestCompletedWeek = new Date(currentWeekDate);
  latestCompletedWeek.setUTCDate(latestCompletedWeek.getUTCDate() - 7);
  const earliestCompletedWeek = new Date(latestCompletedWeek);
  earliestCompletedWeek.setUTCDate(earliestCompletedWeek.getUTCDate() - 35);
  const latestCompletedWeekKey = latestCompletedWeek.toISOString().slice(0, 10);
  const earliestCompletedWeekKey = earliestCompletedWeek.toISOString().slice(0, 10);
  const recentBySportAndWeek = new Map<Sport, Map<string, number>>();
  for (const session of recentSessions) {
    if (session.status !== "completed" || !["swim", "bike", "run"].includes(session.sport)) continue;
    const date = session.date.slice(0, 10);
    if (date < earliestCompletedWeekKey || date > latestCompletedWeekKey) continue;
    const duration = durationToMinutes(session.duration);
    if (duration === null) continue;
    const sport = session.sport as Sport;
    const week = mondayOf(session.date);
    const byWeek = recentBySportAndWeek.get(sport) ?? new Map<string, number>();
    byWeek.set(week, (byWeek.get(week) ?? 0) + duration);
    recentBySportAndWeek.set(sport, byWeek);
  }
  const trainingBaseline = { ...(plan.trainingBaseline ?? {}) };
  for (const sport of ["swim", "bike", "run"] as const) {
    const weeklyTotals = [...(recentBySportAndWeek.get(sport)?.values() ?? [])].sort((a, b) => a - b);
    const middle = Math.floor(weeklyTotals.length / 2);
    const recentMedian = weeklyTotals.length === 0 ? null : weeklyTotals.length % 2 ? weeklyTotals[middle] : (weeklyTotals[middle - 1] + weeklyTotals[middle]) / 2;
    const target = weeklyTargetMinutes(plan, sport, "weekly", recentSessions);
    if (recentMedian !== null && weeklyTotals.length >= 3) {
      if (target > recentMedian * 1.3 && target - recentMedian >= 30) {
        const startingMinutes = Math.min(target, Math.max(0, roundToFive(recentMedian)));
        trainingBaseline[sport] = { startingMinutes, medianMinutes: startingMinutes, completedWeeks: weeklyTotals.length };
        historyAdjustments.push({ sport, targetMinutes: target, rampTargetMinutes: plan.goalMode === "race" ? Math.max(target, weeklyTargetMinutes(plan, sport, "peak", recentSessions)) : target, startingMinutes, medianMinutes: startingMinutes, completedWeeks: weeklyTotals.length });
      } else {
        delete trainingBaseline[sport];
      }
    } else if (plan.trainingBaseline?.[sport] && target > 0) {
      const saved = plan.trainingBaseline[sport];
      const startingMinutes = Math.min(target, saved.startingMinutes);
      if (startingMinutes < target) {
        trainingBaseline[sport] = { ...saved, startingMinutes };
        historyAdjustments.push({ sport, targetMinutes: target, rampTargetMinutes: plan.goalMode === "race" ? Math.max(target, weeklyTargetMinutes(plan, sport, "peak", recentSessions)) : target, startingMinutes, medianMinutes: saved.medianMinutes, completedWeeks: saved.completedWeeks });
      } else {
        delete trainingBaseline[sport];
      }
    }
  }

  for (const sport of ["swim", "bike", "run"] as const) {
    if (sessions.some((session) => session.sport === sport)) {
      targetMinutesBySport.set(sport, weeklyTargetMinutes(plan, sport, "weekly", recentSessions));
    }
  }

  const qualitySports = plan.primaryFocus === "balanced" ? ["bike", "run"] as const : [plan.primaryFocus];
  const qualitySessionIds = new Set<string>();
  const qualitySessions: PlannedSession[] = [];
  const weekdayOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const daysApart = (a: string, b: string) => {
    const difference = Math.abs(weekdayOrder.indexOf(a) - weekdayOrder.indexOf(b));
    return Math.min(difference, weekdayOrder.length - difference);
  };
  for (const sport of qualitySports) {
    const sportSessions = sessions.filter((session) => session.sport === sport);
    if (sportSessions.length < 2) continue;
    const preferredLongDay = sport === "bike" ? plan.longBikeDay : sport === "run" ? plan.longRunDay : null;
    const longSession = preferredLongDay
      ? sportSessions.find((session) => session.day === preferredLongDay) ?? [...sportSessions].sort((a, b) => sessionMinutes(b) - sessionMinutes(a))[0]
      : null;
    const candidates = sportSessions.filter((session) => session.id !== longSession?.id);
    const qualitySession = candidates.find((session) => session.quality || /interval/i.test(session.title))
      ?? candidates.find((session) => plan.qualityDays.includes(session.day))
      ?? [...candidates].sort((a, b) => sessionMinutes(b) - sessionMinutes(a))[0];
    if (qualitySession) {
      qualitySessionIds.add(qualitySession.id);
      qualitySessions.push(qualitySession);
    }
  }
  // Place both key sessions on separated weekdays. This repositions generated workouts
  // instead of silently downgrading one of the sports to endurance.
  const qualityDayLoads = new Map(weekdayOrder.map((day) => [day, sessions.filter((session) => session.day === day && !qualitySessionIds.has(session.id)).length]));
  const availableQualityDays = weekdayOrder
    .filter((day) => !["Sat", "Sun"].includes(day) && !plan.restDays.includes(day));
  // Find spaced locations for both key workouts together. If a preferred day is
  // full, move a non-key session to an open weekday before rejecting the pairing.
  // The previous greedy fallback knowingly accepted adjacent quality days.
  const qualityCandidates = qualitySessions.map((session) => ({ session, days: availableQualityDays }));
  let bestAssignment: Array<{ session: PlannedSession; day: string }> | null = null;
  let bestMoves: Array<{ session: PlannedSession; day: string }> = [];
  let bestScore = Number.POSITIVE_INFINITY;
  const searchAssignments = (index: number, placed: Array<{ session: PlannedSession; day: string }>, score: number) => {
    if (index === qualityCandidates.length) {
      const assignedDays = new Set(placed.map((assignment) => assignment.day));
      const loads = new Map(qualityDayLoads);
      const moves: Array<{ session: PlannedSession; day: string }> = [];
      const movedIds = new Set<string>();
      for (const assignment of placed) {
        const target = assignment.day;
        const blockers = sessions.filter((item) => item.day === target && !qualitySessionIds.has(item.id) && !movedIds.has(item.id));
        const mustMove = blockers.filter((item) => item.sport === assignment.session.sport);
        const blockersToMove = [...mustMove];
        while ((loads.get(target) ?? 0) - blockersToMove.length > 1) {
          const next = blockers.find((item) => !blockersToMove.some((selected) => selected.id === item.id));
          if (!next) break;
          blockersToMove.push(next);
        }
        if ((loads.get(target) ?? 0) - blockersToMove.length > 1) return;
        for (const blocker of blockersToMove) {
          const destinations = availableQualityDays.filter((day) => {
            if (assignedDays.has(day) || (loads.get(day) ?? 0) >= 2) return false;
            const alreadyThere = sessions.some((item) => item.day === day && item.id !== blocker.id && !movedIds.has(item.id)
              && !qualitySessionIds.has(item.id) && item.sport === blocker.sport);
            const movedThere = moves.some((move) => move.day === day && move.session.sport === blocker.sport);
            return !alreadyThere && !movedThere;
          }).sort((a, b) => {
            const scoreDay = (day: string) => (loads.get(day) ?? 0) * 20 + (day === blocker.day ? -3 : 0);
            return scoreDay(a) - scoreDay(b) || weekdayOrder.indexOf(a) - weekdayOrder.indexOf(b);
          });
          const destination = destinations[0];
          if (!destination) return;
          movedIds.add(blocker.id);
          moves.push({ session: blocker, day: destination });
          loads.set(target, (loads.get(target) ?? 0) - 1);
          loads.set(destination, (loads.get(destination) ?? 0) + 1);
        }
        if ((loads.get(target) ?? 0) >= 2) return;
        loads.set(target, (loads.get(target) ?? 0) + 1);
      }
      const totalScore = score + moves.length * 30;
      if (totalScore < bestScore) {
        bestScore = totalScore;
        bestAssignment = [...placed];
        bestMoves = [...moves];
      }
      return;
    }
    const { session, days } = qualityCandidates[index];
    const targetDay = plan.qualityDays.find((day) => days.includes(day));
    for (const day of days) {
      if (placed.some((assignment) => daysApart(day, assignment.day) <= 1)) continue;
      const placementScore = (qualityDayLoads.get(day) ?? 0) * 20
        + (day === session.day ? -3 : 0)
        + (day === targetDay ? -6 : 0);
      if (score + placementScore >= bestScore) continue;
      searchAssignments(index + 1, [...placed, { session, day }], score + placementScore);
    }
  };
  if (qualitySessions.length > 0) searchAssignments(0, [], 0);
  const completedAssignments = bestAssignment as Array<{ session: PlannedSession; day: string }> | null;
  if (completedAssignments) {
    for (const { session, day } of bestMoves) session.day = day;
    for (const { session, day } of completedAssignments) session.day = day;
  }
  const longSessionIds = new Set<string>();
  for (const sport of ["bike", "run"] as const) {
    const sportSessions = sessions.filter((session) => session.sport === sport);
    if (!sportSessions.length) continue;
    const preferredLongDay = sport === "bike" ? plan.longBikeDay : plan.longRunDay;
    const preferredSession = sportSessions.find((session) => session.day === preferredLongDay);
    const longestSession = [...sportSessions].sort((a, b) => {
      const aMinutes = a.durationMinutes ?? durationToMinutes(a.duration) ?? 0;
      const bMinutes = b.durationMinutes ?? durationToMinutes(b.duration) ?? 0;
      return bMinutes - aMinutes;
    })[0];
    longSessionIds.add((preferredSession ?? longestSession).id);
  }
  const generatedSessions = sessions.map((session) => {
    const sportSessions = sessions.filter((item) => item.sport === session.sport);
    const sportIndex = sportSessions.findIndex((item) => item.id === session.id);
    const targetMinutes = targetMinutesBySport.get(session.sport) ?? weeklyTargetMinutes(plan, session.sport, "weekly", recentSessions);
    const weeklyMinutes = Math.min(targetMinutes, trainingBaseline[session.sport]?.startingMinutes ?? targetMinutes);
    const qualityCandidate = qualitySessionIds.has(session.id);
    let share = 1 / sportSessions.length;

    if ((session.sport === "bike" || session.sport === "run") && sportSessions.length > 1) {
      const preferredLongDay = session.sport === "bike" ? plan.longBikeDay : plan.longRunDay;
      const preferredLongIndex = sportSessions.findIndex((item) => item.day === preferredLongDay);
      const longIndex = preferredLongIndex >= 0 ? preferredLongIndex : sportSessions.length - 1;
      const desiredLongShare = runFocused && session.sport === "run" ? 0.35 : 0.55;
      const perSessionLimit = Math.min(maxMinutes, recommendedSessionCap(plan, session.sport));
      const minimumLongShare = Math.max(0, 1 - ((sportSessions.length - 1) * perSessionLimit) / weeklyMinutes);
      const maximumLongShare = Math.min(1, perSessionLimit / weeklyMinutes);
      const longShare = Math.max(minimumLongShare, Math.min(desiredLongShare, maximumLongShare));
      const remainingShare = 1 - longShare;
      if ((session.sport === "bike" || session.sport === "run") && sportSessions.length === 3) {
        // Keep the three-workout structure: key intervals, one aerobic session,
        // and the long workout. The aerobic session absorbs the remaining load.
        const qualityShare = session.sport === "bike"
          ? remainingShare / 3
          : Math.min(remainingShare, Math.min(maxMinutes, recommendedSessionCap(plan, session.sport, true)) / weeklyMinutes);
        share = sportIndex === longIndex
          ? longShare
          : qualityCandidate ? qualityShare : remainingShare - qualityShare;
      } else {
        share = sportIndex === longIndex ? longShare : remainingShare / (sportSessions.length - 1);
      }
    }

    const rawMinutes = weeklyMinutes * share;
    const sessionCap = Math.min(maxMinutes, recommendedSessionCap(plan, session.sport, qualityCandidate));
    const durationOverride = session.durationOverrideMinutes;
    const manualDurationCap = qualityCandidate ? sessionCap : maxMinutes;
    const durationMinutes = Math.max(15, typeof durationOverride === "number" && Number.isFinite(durationOverride) && durationOverride > 0
      ? Math.min(manualDurationCap, roundToFive(durationOverride))
      : Math.min(sessionCap, roundToFive(rawMinutes)));
    const quality = qualityCandidate;
    const plannedDistanceTarget = plan.volumeBasis === "distance"
      ? (plan.distanceTargets[session.sport].weekly ?? 0) * (weeklyMinutes / Math.max(1, targetMinutes)) * share
      : 0;
    const distanceTarget = plan.volumeBasis === "distance" ? plannedDistanceTarget : 0;
    const distanceUnit = plan.volumeBasis === "distance" ? plan.distanceTargets[session.sport].unit : "";
    const swimVariant = session.sport === "swim" && sportIndex > 0 ? "endurance" : "technique";
    const isLongSession = longSessionIds.has(session.id);
    const title = quality
      ? `${titleCase(session.sport)} intervals`
      : isLongSession && session.sport === "bike" ? "Long ride"
        : isLongSession && session.sport === "run" ? "Long run"
          : session.sport === "swim" ? swimVariant === "endurance" ? "Swim endurance" : "Swim technique + endurance"
            : session.sport === "bike" ? "Bike endurance" : "Run endurance";
    const intensity = workoutFocusLabel(session.sport, quality, swimVariant);

    return {
      ...session,
      title,
      duration: plan.volumeBasis === "distance" ? `~${durationMinutes} min` : `${durationMinutes} min`,
      durationMinutes,
      intensity,
      quality,
      workoutDescription: workoutDetails(plan, session.sport, durationMinutes, quality, distanceTarget, distanceUnit, swimVariant),
    };
  });


  for (const sport of ["swim", "bike", "run"] as const) {
    const targetMinutes = targetMinutesBySport.get(sport);
    if (targetMinutes === undefined) continue;
    const plannedMinutes = Math.min(targetMinutes, trainingBaseline[sport]?.startingMinutes ?? targetMinutes);
    const sportSessions = generatedSessions.filter((session) => session.sport === sport);
    const scheduledMinutes = sportSessions.reduce((total, session) => total + (session.durationMinutes ?? 0), 0);
    if (plannedMinutes <= scheduledMinutes + 1) continue;
    if (plan.volumeBasis === "distance") {
      const target = plan.distanceTargets[sport];
      const plannedDistance = (target.weekly ?? 0) * plannedMinutes / Math.max(1, targetMinutes);
      const distanceLabel = `${new Intl.NumberFormat("en-US", { maximumFractionDigits: sport === "swim" ? 0 : 1 }).format(plannedDistance)} ${target.unit}`;
      const speedBasis = recentMetersPerSecond(sport, recentSessions) ? "your recent" : "a typical";
      warnings.push(`${titleCase(sport)}: ${distanceLabel} needs about ${minutesLabel(plannedMinutes)} at ${speedBasis} ${sport === "bike" ? "speed" : "pace"}; the generated sessions total ${minutesLabel(scheduledMinutes)}.`);
    } else {
      warnings.push(`${titleCase(sport)}: the planned volume needs ${minutesLabel(plannedMinutes)}, but the generated sessions total ${minutesLabel(scheduledMinutes)}.`);
    }
  }

  return { sessions: generatedSessions, capacityWarnings: warnings, historyAdjustments, trainingBaseline };
}
