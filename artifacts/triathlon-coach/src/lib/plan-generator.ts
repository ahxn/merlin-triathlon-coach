import type { PlanPreferences } from "./data-api";
import { trainingTemplateCue } from "./training-examples";
import { recentMetersPerSecond } from "./workout-display";

type PlannedSession = PlanPreferences["manualSessions"][number];
type Sport = PlannedSession["sport"];
type RecentSession = { sport: string; date: string; duration: string; status: string; durationMinutes?: number; distanceMeters?: number };

const roundToFive = (value: number) => Math.max(5, Math.round(value / 5) * 5);
const titleCase = (value: string) => `${value[0].toUpperCase()}${value.slice(1)}`;

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
  const ordinaryLimits = { swim: 60, bike: 120, run: 60 };
  const qualityLimits = { swim: 45, bike: 75, run: 45 };
  const limit = quality ? qualityLimits[sport] : ordinaryLimits[sport];
  return Math.min(plan.maxSessionMinutes || 90, limit);
}

export function workoutDetails(plan: PlanPreferences, sport: Sport, minutes: number, quality: boolean, distanceTarget: number, distanceUnit: string, swimVariant: "technique" | "endurance" = "technique") {
  const warmup = Math.min(10, Math.max(5, roundToFive(minutes * 0.2)));
  const cooldown = Math.min(5, Math.max(3, roundToFive(minutes * 0.1)));
  const mainMinutes = Math.max(5, minutes - warmup - cooldown);
  const swimRepDistance = intervalRepDistance("swim", plan.distanceTargets.swim.unit);
  let mainSet: string;

  if (quality && minutes >= 40) {
    if (sport === "run") {
      mainSet = "4 × 2 minutes at controlled, comfortably hard effort (RPE 6/10), with 2 minutes easy jogging between repetitions.";
    } else if (sport === "bike") {
      mainSet = "4 × 4 minutes at controlled, comfortably hard effort (RPE 6/10), with 3 minutes easy spinning between repetitions.";
    } else {
      mainSet = `8 × ${swimRepDistance} at smooth, steady effort (RPE 5–6/10), with 20–30 seconds rest. Keep technique relaxed.`;
    }
  } else if (sport === "swim" && swimVariant === "endurance") {
    mainSet = `Swim at a relaxed, conversational effort (RPE 3–4/10), keeping a steady rhythm. Swim continuously or break the time into repeats of ${swimRepDistance}; rest briefly to keep your form smooth.`;
  } else if (sport === "swim") {
    mainSet = `Swim relaxed lengths at conversational effort (RPE 3–4/10). Include 6 × ${swimRepDistance.replace(/^50/, "25")} of easy technique practice, resting as needed to keep form smooth.`;
  } else if (sport === "run") {
    mainSet = `Stay at an easy, conversational effort (RPE 3–4/10) for ${mainMinutes} minutes. Take brief walking breaks whenever needed to keep the effort controlled.`;
  } else {
    mainSet = `Stay at an easy, conversational effort (RPE 3–4/10) for ${mainMinutes} minutes. Keep the effort controlled and finish feeling able to continue.`;
  }

  const total = plan.volumeBasis === "distance"
    ? `Approximate session target: ${Number(distanceTarget.toFixed(sport === "swim" ? 0 : 1))} ${distanceUnit}. Estimated time is a guide based on typical speeds; adjust to your own pace.`
    : `Planned duration: ${minutes} minutes.`;
  const warmDescription = sport === "swim" ? "easy swimming" : sport === "bike" ? "easy spinning" : "easy walking or jogging";
  const cooldownDescription = sport === "swim" ? "easy swimming" : sport === "bike" ? "easy spinning" : "easy jogging or walking";
  const templateCue = trainingTemplateCue(sport, quality);
  return `${total}\nWarm-up: ${warmup} minutes of ${warmDescription}.\nMain set: ${mainSet}\nCool-down: ${cooldown} minutes of ${cooldownDescription}.${templateCue ? `\nTemplate note: ${templateCue}` : ""}`;
}


const scheduleDays: PlanPreferences["manualSessions"][number]["day"][] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const draftDayOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function buildInitialWeeklySchedule(plan: PlanPreferences) {
  const requestedCount = Math.min(14, Math.max(3, Math.round(plan.sessionsPerWeek || 6)));
  const sports: Sport[] = ["swim", "bike", "run"];
  const sessions: PlannedSession[] = [];
  for (const sport of sports) {
    const requiredSportSession = plan.manualSessions.find((session) => session.sport === sport);
    if (requiredSportSession && sessions.length < requestedCount) sessions.push({ ...requiredSportSession });
  }
  for (const existing of plan.manualSessions) {
    if (sessions.length >= requestedCount) break;
    if (!sessions.some((session) => session.id === existing.id)) sessions.push({ ...existing });
  }
  const counts = new Map<Sport, number>(sports.map((sport) => [sport, sessions.filter((session) => session.sport === sport).length]));
  const balancedFocus = plan.primaryFocus === "balanced";
  const runFocused = plan.primaryFocus === "run";
  if (balancedFocus) {
    while ((counts.get("run") ?? 0) > (counts.get("bike") ?? 0) && (counts.get("run") ?? 0) > 1) {
      const runSession = [...sessions].reverse().find((session) => session.sport === "run");
      if (!runSession) break;
      runSession.sport = "bike";
      runSession.title = "Bike session";
      runSession.duration = "";
      runSession.intensity = "Endurance";
      runSession.quality = false;
      counts.set("run", (counts.get("run") ?? 0) - 1);
      counts.set("bike", (counts.get("bike") ?? 0) + 1);
    }
  } else if (runFocused) {
    while ((counts.get("bike") ?? 0) > (counts.get("run") ?? 0) && (counts.get("bike") ?? 0) > 1) {
      const bikeSession = [...sessions].reverse().find((session) => session.sport === "bike");
      if (!bikeSession) break;
      bikeSession.sport = "run";
      bikeSession.title = "Run session";
      bikeSession.duration = "";
      bikeSession.intensity = "Endurance";
      bikeSession.quality = false;
      counts.set("bike", (counts.get("bike") ?? 0) - 1);
      counts.set("run", (counts.get("run") ?? 0) + 1);
    }
  }

  const runFocusedSessionTarget = runFocused ? Math.max(1, Math.ceil(requestedCount * 0.5)) : 0;
  while (sessions.length < requestedCount) {
    const missingSports = sports.filter((item) => (counts.get(item) ?? 0) === 0);
    const candidates = missingSports.length ? missingSports : sports;
    const eligibleCandidates = balancedFocus && (counts.get("run") ?? 0) >= (counts.get("bike") ?? 0)
      ? candidates.filter((sport) => sport !== "run")
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

  // Spread a sport's weekly target across enough sessions to keep each workout
  // within its sport-specific duration limit. In particular, don't turn a
  // large weekly run target into one unusually long run when another sport has
  // more sessions than its own target needs.
  const minimumSessions = new Map<Sport, number>(sports.map((sport) => {
    const cap = Math.min(plan.maxSessionMinutes || 90, recommendedSessionCap(plan, sport));
    return [sport, Math.max(1, Math.ceil(weeklyTargetMinutes(plan, sport) / cap))];
  }));
  while (true) {
    const needingSessions = sports.filter((sport) => (counts.get(sport) ?? 0) < (minimumSessions.get(sport) ?? 1));
    const donorSports = sports.filter((sport) => (counts.get(sport) ?? 0) > Math.max(1, minimumSessions.get(sport) ?? 1));
    const canTransfer = (sport: Sport, donor: Sport) => {
      const runAfter = (counts.get("run") ?? 0) + (sport === "run" ? 1 : 0) - (donor === "run" ? 1 : 0);
      const bikeAfter = (counts.get("bike") ?? 0) + (sport === "bike" ? 1 : 0) - (donor === "bike" ? 1 : 0);
      if (balancedFocus) return runAfter <= bikeAfter;
      if (runFocused) return runAfter >= bikeAfter;
      return true;
    };
    const eligibleNeeds = needingSessions.filter((sport) => donorSports.some((donor) => canTransfer(sport, donor)));
    if (eligibleNeeds.length === 0 || donorSports.length === 0) break;

    const sport = eligibleNeeds.sort((a, b) => {
      const need = (candidate: Sport) => weeklyTargetMinutes(plan, candidate) / ((counts.get(candidate) ?? 0) + 1);
      return need(b) - need(a);
    })[0];
    const eligibleDonors = donorSports.filter((donor) => canTransfer(sport, donor));
    const donor = eligibleDonors.sort((a, b) => {
      const surplus = (candidate: Sport) => (counts.get(candidate) ?? 0) - (minimumSessions.get(candidate) ?? 1);
      return surplus(b) - surplus(a);
    })[0];
    const movedSession = [...sessions].reverse().find((session) => session.sport === donor);
    if (!sport || !donor || !movedSession) break;

    movedSession.sport = sport;
    movedSession.title = `${titleCase(sport)} session`;
    movedSession.duration = "";
    movedSession.intensity = "Endurance";
    movedSession.quality = false;
    counts.set(donor, (counts.get(donor) ?? 0) - 1);
    counts.set(sport, (counts.get(sport) ?? 0) + 1);
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
  const sessionPriority = (session: PlannedSession) => {
    const originalDay = originalDays.get(session.id) ?? "";
    const sportSessions = sportIndices.get(session.sport) ?? [];
    const isLongSession = session.sport === "bike" && (originalDay === plan.longBikeDay || sportSessions.at(-1)?.id === session.id)
      || session.sport === "run" && (originalDay === plan.longRunDay || sportSessions.at(-1)?.id === session.id);
    const isQualitySession = session.quality || plan.qualityDays.includes(originalDay);
    return isLongSession ? 0 : isQualitySession ? 1 : session.sport === "run" ? 2 : 3;
  };
  const orderedSessions = [...sessions].sort((a, b) => sessionPriority(a) - sessionPriority(b));

  for (const session of orderedSessions) {
    const candidates = availableDays.filter((day) => (dayAssignments.get(day)?.length ?? 0) < 2);
    const daysWithoutSameSport = candidates.filter((day) => !dayAssignments.get(day)?.some((item) => item.sport === session.sport));
    const placementDays = daysWithoutSameSport.length ? daysWithoutSameSport : candidates;
    const originalDay = originalDays.get(session.id) ?? "";
    const sportSessions = sportIndices.get(session.sport) ?? [];
    const isLongSession = session.sport === "bike" && (originalDay === plan.longBikeDay || sportSessions.at(-1)?.id === session.id)
      || session.sport === "run" && (originalDay === plan.longRunDay || sportSessions.at(-1)?.id === session.id);
    const preferredDay = session.sport === "bike" ? plan.longBikeDay : session.sport === "run" ? plan.longRunDay : "";
    const prefersQualityDay = session.quality || plan.qualityDays.includes(originalDay);
    const assignedSportDays = availableDays.filter((day) => dayAssignments.get(day)?.some((item) => item.sport === session.sport));
    const day = [...placementDays].sort((a, b) => {
      const score = (candidate: string) => {
        const dayWorkouts = dayAssignments.get(candidate) ?? [];
        const closestSameSport = assignedSportDays.length ? Math.min(...assignedSportDays.map((sportDay) => dayDistance(candidate, sportDay))) : 7;
        const qualityPenalty = prefersQualityDay && !plan.qualityDays.includes(candidate) ? 4 : 0;
        const longDayPenalty = isLongSession ? dayDistance(candidate, preferredDay) * 5 : 0;
        const keepDayBonus = candidate === originalDay ? -2 : 0;
        const spacingPenalty = closestSameSport === 1 ? 12 : closestSameSport === 2 ? 4 : 0;
        return dayWorkouts.length * 100 + qualityPenalty + longDayPenalty + spacingPenalty + keepDayBonus;
      };
      return score(a) - score(b) || draftDayOrder.indexOf(a) - draftDayOrder.indexOf(b);
    })[0];
    session.day = day ?? "";
    if (day) dayAssignments.get(day)?.push(session);
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
  const sessions = plan.manualSessions;
  const runFocused = plan.primaryFocus === "run";
  const warnings: string[] = [];
  const historyAdjustments: Array<{ sport: Sport; targetMinutes: number; rampTargetMinutes: number; startingMinutes: number; medianMinutes: number; completedWeeks: number }> = [];
  const maxMinutes = plan.maxSessionMinutes || 90;
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

  const selectedQualitySports = plan.primaryFocus === "balanced" && plan.qualitySports.length === 0 ? ["bike", "run"] as const : plan.qualitySports;
  const qualitySports = plan.primaryFocus === "balanced"
    ? [...selectedQualitySports].sort((a, b) => (a === "bike" ? -1 : b === "bike" ? 1 : 0))
    : [plan.primaryFocus];
  const qualitySessionIds = new Set<string>();
  const qualitySessionDays: string[] = [];
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
      ? sportSessions.find((session) => session.day === preferredLongDay) ?? sportSessions.at(-1)
      : null;
    const qualityCandidates = sportSessions.filter((session) => session.id !== longSession?.id);
    const separatedCandidates = qualityCandidates.filter((session) => qualitySessionDays.every((day) => daysApart(day, session.day) > 1));
    const candidates = separatedCandidates.length ? separatedCandidates : qualityCandidates;
    const qualitySession = candidates.find((session) => plan.qualityDays.includes(session.day)) ?? candidates[0];
    if (qualitySession) {
      qualitySessionIds.add(qualitySession.id);
      qualitySessionDays.push(qualitySession.day);
    }
  }
  const generatedSessions = sessions.map((session) => {
    const sportSessions = sessions.filter((item) => item.sport === session.sport);
    const sportIndex = sportSessions.findIndex((item) => item.id === session.id);
    const targetMinutes = targetMinutesBySport.get(session.sport) ?? weeklyTargetMinutes(plan, session.sport, "weekly", recentSessions);
    const weeklyMinutes = Math.min(targetMinutes, trainingBaseline[session.sport]?.startingMinutes ?? targetMinutes);
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
      share = sportIndex === longIndex ? longShare : (1 - longShare) / (sportSessions.length - 1);
    }

    const rawMinutes = weeklyMinutes * share;
    const qualityCandidate = qualitySessionIds.has(session.id) && rawMinutes >= 40;
    const sessionCap = Math.min(maxMinutes, recommendedSessionCap(plan, session.sport, qualityCandidate));
    const durationMinutes = Math.min(sessionCap, roundToFive(rawMinutes));
    const quality = qualityCandidate && durationMinutes >= 40;
    const plannedDistanceTarget = plan.volumeBasis === "distance"
      ? (plan.distanceTargets[session.sport].weekly ?? 0) * (weeklyMinutes / Math.max(1, targetMinutes)) * share
      : 0;
    const distanceTarget = plan.volumeBasis === "distance" ? plannedDistanceTarget : 0;
    const distanceUnit = plan.volumeBasis === "distance" ? plan.distanceTargets[session.sport].unit : "";
    const swimVariant = session.sport === "swim" && sportIndex > 0 ? "endurance" : "technique";
    const title = quality
      ? session.sport === "swim" ? "Steady swim intervals" : `Controlled ${session.sport} intervals`
      : session.sport === "swim" ? swimVariant === "endurance" ? "Easy aerobic swim" : "Swim technique + endurance" : session.sport === "bike" ? "Easy endurance ride" : "Easy aerobic run";
    const intensity = quality ? "Controlled · RPE 5–6/10" : "Easy · RPE 3–4/10";

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
