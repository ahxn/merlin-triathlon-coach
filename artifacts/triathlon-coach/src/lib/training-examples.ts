import type { PlanPreferences } from "./data-api";

type Sport = "swim" | "bike" | "run";
type AthleteGroup = "elite" | "age-group" | "recreational" | "trained";
type SourceKind = "athlete log" | "coach interviews" | "observational study" | "intervention study" | "case study";

export type TrainingExample = {
  id: string;
  title: string;
  athleteGroup: AthleteGroup;
  sports: Sport[];
  purpose: string;
  phase: string;
  workload: string;
  sourceKind: SourceKind;
  observation: string;
  statedReasoning?: string;
  application: string;
  caution: string;
  sourceUrl: string;
  templateCue?: string;
};

/** Small, source-linked observations. These describe patterns, not reusable plans. */
export const trainingExamples: TrainingExample[] = [
  {
    id: "yee-london-marathon-block",
    title: "Alex Yee · London marathon build",
    athleteGroup: "elite",
    sports: ["run", "bike", "swim"],
    purpose: "Marathon-specific block",
    phase: "Race preparation",
    workload: "Elite multi-session week; user-provided week 3 image is the example",
    sourceKind: "athlete log",
    observation: "The shared Week 3 image pairs high run volume with bike, swim, and gym work; Yee’s public series also discusses race-specific sessions and preparation.",
    statedReasoning: "In the video, Yee describes a 30 km race simulation to rehearse race conditions and nutrition and feel prepared for the start line.",
    application: "Use the run emphasis, key-session spacing, and cross-training mix as structural references; scale every session from this athlete’s exceptional baseline.",
    caution: "Elite marathon volume and stacked sessions are not a starting prescription for an age-group triathlete.",
    sourceUrl: "https://www.youtube.com/watch?v=PyOYl4vTaew",
    templateCue: "A run-focused block can retain bike and swim support, but running volume should be set from the athlete’s own recent run history."
  },
  {
    id: "world-class-triathlete-macrocycle",
    title: "World-class male triathlete · Olympic cycle",
    athleteGroup: "elite",
    sports: ["swim", "bike", "run"],
    purpose: "Olympic triathlon performance",
    phase: "43-week macrocycle",
    workload: "14.74 ± 3.01 endurance hours per week in one athlete case study",
    sourceKind: "case study",
    observation: "The report describes an early pyramidal intensity pattern shifting toward polarized training later in the macrocycle.",
    application: "Review the progression of training emphasis across a block rather than copying the athlete’s hours.",
    caution: "A single world-class athlete case study cannot establish a universal volume target.",
    sourceUrl: "https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2022.835705/full"
  },
  {
    id: "age-group-triathlon-six-months",
    title: "Age-group triathletes · six-month cohort",
    athleteGroup: "age-group",
    sports: ["swim", "bike", "run"],
    purpose: "Training-load patterns by distance and phase",
    phase: "Race preparation",
    workload: "95 athletes; 2,177 athlete-weeks",
    sourceKind: "observational study",
    observation: "Weekly load varied with race-distance preference and training phase across the cohort.",
    application: "Compare within an athlete’s own recent training and goal phase before using population patterns.",
    caution: "Cohort averages are context, not individual prescriptions or proof that more load causes better outcomes.",
    sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC13171522/"
  },
  {
    id: "amateur-half-iron-preparation",
    title: "Neophyte amateurs · 24-week half-Ironman preparation",
    athleteGroup: "recreational",
    sports: ["swim", "bike", "run"],
    purpose: "Prepare for a first long-course triathlon",
    phase: "24-week event build",
    workload: "Amateur cohort; multi-sport periodized preparation",
    sourceKind: "observational study",
    observation: "A prospective project tracked amateur athletes through a 24-week half-Ironman preparation and reported changes in fitness measures and completion outcomes.",
    application: "Begin from current capacity and make the progression feasible for the athlete’s life and recovery.",
    caution: "The cohort program involved specialized support; finishing outcomes do not validate one template for everyone.",
    sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7241627/"
  },
  {
    id: "recreational-triathlete-load-and-health",
    title: "Recreational triathletes · fatigue and health",
    athleteGroup: "recreational",
    sports: ["swim", "bike", "run"],
    purpose: "Competition preparation and health monitoring",
    phase: "Race build",
    workload: "Recreational-level cohort",
    sourceKind: "observational study",
    observation: "The study tracks how training characteristics relate to fatigue and health in recreational triathletes.",
    application: "Treat schedule fit and recovery as part of the plan, not leftover space after target volume.",
    caution: "Observational group findings cannot diagnose an individual or set safe personal limits.",
    sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8309729/"
  },
  {
    id: "amateur-half-iron-intensity",
    title: "Amateur half-Ironman · intensity distribution",
    athleteGroup: "recreational",
    sports: ["swim", "bike", "run"],
    purpose: "Relate training intensity distribution to race performance",
    phase: "Season preparation",
    workload: "Small amateur sample",
    sourceKind: "observational study",
    observation: "A small study compared polarized and pyramidal training-intensity patterns in amateur half-Ironman athletes.",
    application: "Keep most easy sessions genuinely easy and make harder work deliberate; the app does not assume one distribution wins for everyone.",
    caution: "Small sample and observational comparisons limit causal conclusions.",
    sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6873141/"
  },
  {
    id: "elite-swimmers-two-decades",
    title: "Elite swimmers · 20-season training cohort",
    athleteGroup: "elite",
    sports: ["swim"],
    purpose: "Season-best preparation and intensity distribution",
    phase: "25 weeks before season best",
    workload: "127 elite swimmers across 20 seasons",
    sourceKind: "observational study",
    observation: "Most recorded swimming was at or below the study’s threshold category, with multiple periodization patterns associated with performance.",
    application: "Use progressive, event-specific swim blocks and preserve a large aerobic foundation; tailor technique and intensity to the swimmer.",
    caution: "Elite swimmers’ volumes, pace zones, and season structure should not be copied into an amateur triathlon plan.",
    sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/31031631/",
    templateCue: "Keep the drill pace smooth and finish repeats with technique intact; add distance only when form stays consistent."
  },
  {
    id: "world-class-im-swimmer",
    title: "World-class 400 m individual medley swimmer",
    athleteGroup: "elite",
    sports: ["swim"],
    purpose: "Event-specific performance",
    phase: "52-week season with three major cycles",
    workload: "Single-athlete case report",
    sourceKind: "case study",
    observation: "The report documents distinct macrocycles and large changes in weekly swim volume across the season.",
    application: "Different phases can emphasize different needs rather than repeating an identical week all year.",
    caution: "One elite swimmer’s event-specific season is not a volume template for triathlon.",
    sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/36247944/"
  },
  {
    id: "elite-swimmer-overload-taper",
    title: "Elite swimmers · overload and taper",
    athleteGroup: "elite",
    sports: ["swim"],
    purpose: "Competition readiness",
    phase: "Three-week overload followed by three-week taper",
    workload: "32 elite swimmers tracked over multiple seasons",
    sourceKind: "observational study",
    observation: "The best-associated taper patterns reduced training load progressively, with patterns differing across athletes and seasons.",
    application: "For race plans, reduce load toward the event and keep taper choices tied to event timing and the athlete’s response.",
    caution: "The study was exploratory; the result is not a fixed taper formula.",
    sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/24421726/"
  },
  {
    id: "trained-cyclists-polarized-threshold",
    title: "Trained cyclists · polarized vs threshold blocks",
    athleteGroup: "trained",
    sports: ["bike"],
    purpose: "Compare intensity distributions",
    phase: "Two six-week blocks",
    workload: "12 trained male cyclists; about 6–8 hours weekly",
    sourceKind: "intervention study",
    observation: "In a small crossover study, the polarized block improved several measured endurance outcomes more than the threshold-focused block.",
    application: "Use a clear contrast between easy volume and selected quality work; don’t turn every ride into moderate-hard training.",
    caution: "Small, trained-male sample and short blocks do not identify the best plan for every cyclist.",
    sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/23264537/",
    templateCue: "Keep endurance rides conversational and reserve controlled intervals for selected sessions."
  },
  {
    id: "cadence-training-mixed-evidence",
    title: "Cyclists · low-cadence intervals have mixed results",
    athleteGroup: "trained",
    sports: ["bike"],
    purpose: "Torque and cadence development",
    phase: "Four- to twelve-week interventions",
    workload: "Small trained and veteran cyclist trials",
    sourceKind: "intervention study",
    observation: "Some short studies found possible benefits in specific outcomes, while a 12-week veteran-cyclist trial found no added aerobic or performance benefit from low-cadence work.",
    application: "Offer torque work as an optional, goal-specific variation, never as a default endurance prescription.",
    caution: "Results vary by population, protocol, and outcome; torque sessions add muscular stress.",
    sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/24550843/",
    templateCue: "Choose a comfortable cadence that keeps effort controlled; low-cadence torque work is optional, not assumed."
  },
  {
    id: "norwegian-coach-session-models",
    title: "Norwegian world-class coaches · session models",
    athleteGroup: "elite",
    sports: ["swim", "bike", "run"],
    purpose: "How high-performance coaches organize sessions",
    phase: "Annual and weekly preparation",
    workload: "Interviews with 12 experienced coaches across endurance sports",
    sourceKind: "coach interviews",
    observation: "Coaches described sport-specific session models, many easy aerobic sessions, and carefully controlled harder work; some use double-threshold days with elite athletes.",
    statedReasoning: "The coaches emphasized controlling total load: keep recovery training easy and regulate demanding sessions to the athlete and sport.",
    application: "Separate easy and demanding sessions and keep any advanced double-session strategy out of general templates.",
    caution: "Coach interviews describe elite practice, not comparative proof or a safe plan for recreational athletes.",
    sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11560996/",
    templateCue: "Keep this easy session easy; advanced double-threshold patterns are not part of a default plan."
  },
];

export function selectTrainingExamples(plan: PlanPreferences): TrainingExample[] {
  const selected: TrainingExample[] = [];
  const add = (id: string) => {
    const example = trainingExamples.find((item) => item.id === id);
    if (example && !selected.some((item) => item.id === id)) selected.push(example);
  };
  if (plan.primaryFocus === "run") {
    add("yee-london-marathon-block");
    add("norwegian-coach-session-models");
    add("amateur-half-iron-preparation");
  } else if (plan.primaryFocus === "bike") {
    add("trained-cyclists-polarized-threshold");
    add("cadence-training-mixed-evidence");
    add("amateur-half-iron-preparation");
  } else if (plan.primaryFocus === "swim") {
    add("elite-swimmers-two-decades");
    add("age-group-triathlon-six-months");
    add("amateur-half-iron-preparation");
  } else {
    add("world-class-triathlete-macrocycle");
    add("age-group-triathlon-six-months");
    add("amateur-half-iron-preparation");
  }
  return selected.slice(0, 3);
}

export function trainingTemplateCue(sport: Sport, quality: boolean) {
  if (sport === "bike") {
    return quality
      ? "This is the selected quality ride; keep other rides conversational. Low-cadence torque work is optional, not assumed."
      : "Keep this ride conversational and use a comfortable cadence; low-cadence torque work is optional, not assumed.";
  }
  if (sport === "swim") {
    return quality
      ? "Keep the repeats controlled and stop short of technique breakdown."
      : "Keep drills smooth and add distance only while technique stays consistent.";
  }
  return quality
    ? "Keep this effort controlled; double-threshold days belong to advanced, monitored training and are not assumed here."
    : "Keep easy running conversational; build its volume from your own recent run history.";
}
