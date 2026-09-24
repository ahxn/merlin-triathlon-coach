import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Link,
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from "wouter";
import {
  Activity,
  ArrowRight,
  Bike,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  CloudSun,
  Dumbbell,
  ExternalLink,
  Gauge,
  HeartPulse,
  History,
  Home,
  Info,
  LayoutList,
  Lightbulb,
  Link2,
  Menu,
  MoreHorizontal,
  Mountain,
  Pencil,
  Plus,
  RefreshCw,
  Footprints,
  Save,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sunrise,
  Target,
  Timer,
  Trash2,
  TrendingUp,
  UserRound,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ATHLETE_ID, dataApi, type GoalRecord, type IntervalsActivity, type IntervalsEvent, type RecommendationChange, type RecommendationRecord } from "@/lib/data-api";

type Sport = "swim" | "bike" | "run" | "strength" | "rest" | "other";
type SessionStatus = "planned" | "completed" | "skipped";
type RecommendationStatus = "pending" | "edited" | "approved" | "dismissed";

type Athlete = {
  id: string;
  goalId: string | null;
  name: string;
  sport: string;
  event: string;
  distance: string;
  raceDate: string;
  timezone: string;
  availability: string[];
  preferences: { coachTone: string; notifications: boolean };
};
type TrainingSession = {
  id: string;
  sport: Sport;
  title: string;
  date: string;
  duration: string;
  distance?: string;
  intensity: string;
  status: SessionStatus;
  notes?: string;
  externalUrl?: string;
  source?: string;
};
type CheckIn = {
  id: string;
  fatigue: number;
  stress: number;
  soreness: number;
  illness: string;
  readiness: number;
  note: string;
  timestamp: string;
};
type Recommendation = {
  id: string;
  title: string;
  trigger: string;
  evidence: string;
  proposedChange: string;
  rationale: string;
  proposedChanges: RecommendationChange[];
  date: string;
  status: RecommendationStatus;
};
type Connection = {
  configured: boolean;
  athleteId: string;
  lastSync?: string;
  error?: string;
};
const emptyAthlete: Athlete = { id: ATHLETE_ID, goalId: null, name: "", sport: "Triathlon", event: "", distance: "", raceDate: "", timezone: "America/New_York", availability: [], preferences: { coachTone: "Warm + direct", notifications: true } };

const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (days: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + days);
  return iso(d);
};
const prettyDate = (value: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
const longDate = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));

const formatDuration = (seconds?: number) => {
  if (!seconds || seconds <= 0) return "Duration not provided";
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours} hr${remainder ? ` ${remainder} min` : ""}` : `${minutes} min`;
};

const formatDistance = (meters?: number) => {
  if (!meters || meters <= 0) return undefined;
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
};

const sportFromIntervals = (value?: string): Sport => {
  const type = value?.toLowerCase() ?? "";
  if (type.includes("swim")) return "swim";
  if (/(ride|bike|cycling)/.test(type)) return "bike";
  if (type.includes("run")) return "run";
  if (/(strength|weight|gym)/.test(type)) return "strength";
  return "other";
};

function sessionsFromIntervals(events: IntervalsEvent[], activities: IntervalsActivity[]): TrainingSession[] {
  const completedEvents = new Map(activities.filter((activity) => typeof activity.paired_event_id === "number").map((activity) => [activity.paired_event_id!, activity]));
  const planned = events
    .filter((event) => event.category === "WORKOUT" && event.start_date_local && event.name)
    .map((event): TrainingSession => ({
      id: `event-${event.id}`,
      sport: sportFromIntervals(event.type),
      title: event.name || "Planned workout",
      date: event.start_date_local!.slice(0, 10),
      duration: formatDuration(event.moving_time),
      distance: formatDistance(event.distance),
      intensity: typeof event.icu_intensity === "number" ? `Intensity ${Math.round(event.icu_intensity)}%` : "From Intervals.icu",
      status: completedEvents.has(event.id) ? "completed" : "planned",
      notes: event.description || undefined,
      externalUrl: "https://intervals.icu/calendar",
      source: completedEvents.get(event.id)?.device_name?.toLowerCase().includes("garmin") ? completedEvents.get(event.id)?.device_name : undefined,
    }));
  const plannedEventIds = new Set(events.map((event) => event.id));
  const completed = activities
    .filter((activity) => !activity.paired_event_id || !plannedEventIds.has(activity.paired_event_id))
    .map((activity): TrainingSession | null => {
      const date = activity.start_date_local ?? activity.start_date;
      if (!date) return null;
      return {
        id: `activity-${activity.id}`,
        sport: sportFromIntervals(activity.type),
        title: activity.name || activity.type || "Completed activity",
        date: date.slice(0, 10),
        duration: formatDuration(activity.moving_time),
        distance: formatDistance(activity.distance),
        intensity: typeof activity.icu_training_load === "number" ? `Training load ${Math.round(activity.icu_training_load)}` : "Completed in Intervals.icu",
        status: "completed",
        notes: activity.description || undefined,
        externalUrl: "https://intervals.icu/calendar",
        source: activity.device_name?.toLowerCase().includes("garmin") ? activity.device_name : undefined,
      };
    })
    .filter((activity): activity is TrainingSession => activity !== null);
  return [...planned, ...completed].sort((a, b) => a.date.localeCompare(b.date));
}

const checkInFromRecord = (record: { id: string; checkInDate: string; readiness: number; energy: number | null; soreness: number | null; stress: number | null; illnessSignal: string | null; notes: string | null }): CheckIn => ({
  id: record.id,
  fatigue: record.energy === null ? 5 : 11 - record.energy,
  stress: record.stress ?? 5,
  soreness: record.soreness ?? 5,
  illness: record.illnessSignal || "None",
  readiness: record.readiness,
  note: record.notes || "",
  timestamp: record.checkInDate,
});

const recommendationFromRecord = (record: RecommendationRecord): Recommendation => {
  const proposedChange = record.proposedChanges.map((change) => String(change.to ?? "")).filter(Boolean).join("; ");
  return {
    id: record.id,
    title: record.title,
    trigger: record.checkInId ? "Linked check-in" : "Coach recommendation",
    evidence: record.athleteNotes || "No additional athlete notes.",
    proposedChange: proposedChange || record.title,
    rationale: record.reasoning,
    proposedChanges: record.proposedChanges,
    date: (record.decidedAt ?? record.createdAt).slice(0, 10),
    status: record.status,
  };
};

const athleteFromRecord = (record: { id: string; name: string; timezone: string; availabilityDays: string[]; preferences: { coachTone: string; notifications: boolean } }, goal?: GoalRecord): Athlete => ({
  ...emptyAthlete,
  id: record.id,
  goalId: goal?.id ?? null,
  name: record.name,
  timezone: record.timezone,
  availability: record.availabilityDays ?? [],
  preferences: record.preferences ?? emptyAthlete.preferences,
  event: goal?.name ?? "",
  distance: goal?.targetUnit === "70.3 miles" || goal?.targetUnit === "70.3" || goal?.targetUnit === "Half Ironman"
    ? "Half Ironman"
    : goal?.targetUnit === "140.6 miles" || goal?.targetUnit === "140.6" || goal?.targetUnit === "Ironman"
      ? "Ironman"
      : "",
  raceDate: goal?.targetDate ?? "",
});

const seedSessions: TrainingSession[] = [
  {
    id: "s1",
    sport: "swim",
    title: "Form + aerobic rhythm",
    date: shift(0),
    duration: "45 min",
    distance: "1,800 m",
    intensity: "Easy / RPE 4",
    status: "planned",
    notes: "Long exhale, relaxed catch.",
  },
  {
    id: "s2",
    sport: "run",
    title: "Steady progression",
    date: shift(1),
    duration: "52 min",
    distance: "7.4 km",
    intensity: "Z2 → Z3",
    status: "planned",
    notes: "Finish the final 12 minutes with quiet focus.",
  },
  {
    id: "s3",
    sport: "bike",
    title: "Tempo over rolling roads",
    date: shift(2),
    duration: "1 hr 35 min",
    distance: "42 km",
    intensity: "RPE 6",
    status: "planned",
    notes: "3 × 10 min controlled tempo.",
  },
  {
    id: "s4",
    sport: "rest",
    title: "Full rest + mobility",
    date: shift(3),
    duration: "20 min",
    intensity: "Recovery",
    status: "planned",
    notes: "A session can be choosing less.",
  },
  {
    id: "s5",
    sport: "swim",
    title: "Threshold ladder",
    date: shift(4),
    duration: "55 min",
    distance: "2,200 m",
    intensity: "RPE 7",
    status: "planned",
  },
  {
    id: "s6",
    sport: "bike",
    title: "Long ride · nutrition practice",
    date: shift(5),
    duration: "2 hr 40 min",
    distance: "72 km",
    intensity: "Z2",
    status: "planned",
    notes: "Practice one bottle per hour.",
  },
  {
    id: "s7",
    sport: "run",
    title: "Easy brick run",
    date: shift(5),
    duration: "22 min",
    distance: "3.5 km",
    intensity: "Easy",
    status: "planned",
  },
  {
    id: "s8",
    sport: "run",
    title: "Easy conversational run",
    date: shift(-1),
    duration: "38 min",
    distance: "5.5 km",
    intensity: "Z2",
    status: "completed",
  },
  {
    id: "s9",
    sport: "bike",
    title: "Cadence waves",
    date: shift(-2),
    duration: "1 hr 08 min",
    distance: "31 km",
    intensity: "Z2",
    status: "completed",
  },
];
const seedCheckIns: CheckIn[] = [
  {
    id: "c1",
    fatigue: 3,
    stress: 2,
    soreness: 2,
    illness: "None",
    readiness: 7,
    note: "Good energy after a quiet evening.",
    timestamp: shift(-1),
  },
];
const seedRecommendations: Recommendation[] = [
  {
    id: "r1",
    title: "Keep tomorrow’s run easy",
    trigger: "Readiness trend",
    evidence: "Three-day readiness average is 5.8/10, down from 7.1 last week.",
    proposedChange:
      "Keep tomorrow’s run easy and remove the final progression block.",
    rationale:
      "Protects consistency while keeping the aerobic signal. Revisit after your next check-in.",
    proposedChanges: [{ field: "summary", to: "Keep tomorrow’s run easy and remove the final progression block." }],
    date: shift(0),
    status: "pending",
  },
  {
    id: "r2",
    title: "Reduce the long ride",
    trigger: "Load balance",
    evidence: "Bike volume is 18% above the current four-week rolling average.",
    proposedChange: "Reduce Saturday’s long ride by 15 minutes.",
    rationale:
      "A small reduction preserves the weekend rhythm without over-correcting from one data point.",
    proposedChanges: [{ field: "summary", to: "Reduce Saturday’s long ride by 15 minutes." }],
    date: shift(0),
    status: "pending",
  },
];
const seedAthlete: Athlete = {
  ...emptyAthlete,
  name: "Maya Chen",
  sport: "Triathlon",
  event: "Cascadia 70.3",
  distance: "70.3 miles",
  raceDate: "2025-09-14",
  availability: ["Mon", "Tue", "Wed", "Thu", "Sat"],
  preferences: { coachTone: "Warm + direct", notifications: true },
};
const seedConnection: Connection = {
  configured: false,
  athleteId: "0",
};

function useStored<T>(
  key: string,
  fallback: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue];
}

type AppState = {
  athlete: Athlete;
  sessions: TrainingSession[];
  checkIns: CheckIn[];
  recommendations: Recommendation[];
  connection: Connection;
  databaseConnected: boolean;
  loading: boolean;
  loadError: string | null;
  refresh: () => Promise<void>;
  saveAthlete: (v: Athlete) => Promise<Athlete>;
  saveCheckIn: (v: Omit<CheckIn, "id">) => Promise<void>;
  updateRecommendation: (id: string, patch: Partial<RecommendationRecord>) => Promise<void>;
  toast: (message: string) => void;
};
const AppData = createContext<AppState | null>(null);
const useApp = () => {
  const value = useContext(AppData);
  if (!value) throw new Error("App context missing");
  return value;
};

const sportMeta: Record<
  Sport,
  { label: string; color: string; Icon: typeof Waves }
> = {
  swim: { label: "Swim", color: "text-cyan-700 bg-cyan-50", Icon: Waves },
  bike: { label: "Bike", color: "text-amber-700 bg-amber-50", Icon: Bike },
  run: { label: "Run", color: "text-rose-700 bg-rose-50", Icon: Footprints },
  strength: {
    label: "Strength",
    color: "text-violet-700 bg-violet-50",
    Icon: Dumbbell,
  },
  rest: { label: "Rest", color: "text-slate-600 bg-slate-100", Icon: Sunrise },
  other: { label: "Other", color: "text-slate-600 bg-slate-100", Icon: CircleHelp },
};
const navItems = [
  { href: "/", label: "Today", Icon: Home },
  { href: "/calendar", label: "Calendar", Icon: CalendarDays },
  { href: "/check-in", label: "Check-in", Icon: HeartPulse },
  { href: "/recommendations", label: "Recommendations", Icon: Lightbulb },
  { href: "/plan", label: "Plan", Icon: LayoutList },
];
const accountItems = [
  { href: "/profile", label: "Athlete profile", Icon: UserRound },
  { href: "/settings", label: "Connections", Icon: Settings },
];

function IconButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={`button-${label.toLowerCase().replaceAll(" ", "-")}`}
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
    >
      {children}
    </button>
  );
}
function Button({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled = false,
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  testId?: string;
}) {
  const styles = {
    primary:
      "bg-primary text-primary-foreground hover:brightness-110 shadow-sm",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
    ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
    danger: "bg-rose-50 text-rose-700 hover:bg-rose-100",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]}`}
    >
      {children}
    </button>
  );
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "coral" | "green" | "amber" | "blue";
}) {
  const colors = {
    neutral: "bg-secondary text-muted-foreground",
    coral: "bg-orange-50 text-orange-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-cyan-50 text-cyan-700",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.08em] ${colors[tone]}`}
    >
      {children}
    </span>
  );
}
function SectionTitle({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="mono mb-1 text-[10px] uppercase tracking-[.14em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h2 className="display text-2xl text-foreground">{title}</h2>
      </div>
      {action}
    </div>
  );
}
function Metric({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div data-testid={`metric-${label.toLowerCase().replaceAll(" ", "-")}`}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`display mt-1 text-3xl ${accent ? "text-accent" : "text-foreground"}`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
function SessionIcon({ sport }: { sport: Sport }) {
  const { Icon, color } = sportMeta[sport];
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${color}`}
    >
      <Icon size={17} strokeWidth={1.8} />
    </span>
  );
}
function SessionRow({
  session,
  onToggle,
}: {
  session: TrainingSession;
  onToggle?: () => void;
}) {
  return (
    <div
      className="group flex items-center gap-3 py-3"
      data-testid={`session-${session.id}`}
    >
      <SessionIcon sport={session.sport} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p
            className={`truncate text-sm font-semibold ${session.status === "completed" ? "text-muted-foreground line-through decoration-accent/60" : "text-foreground"}`}
          >
            {session.title}
          </p>
          {session.source && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-sky-800">{session.source}</span>}
          {session.status === "completed" && (
            <CheckCircle2 size={14} className="text-emerald-600" />
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {sportMeta[session.sport].label} · {session.duration}
          {session.distance ? ` · ${session.distance}` : ""}
        </p>
      </div>
      {onToggle && (
        <IconButton label={`mark ${session.id}`} onClick={onToggle}>
          {session.status === "completed" ? (
            <RefreshCw size={16} />
          ) : (
            <Check size={16} />
          )}
        </IconButton>
      )}
    </div>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { athlete, recommendations, connection } = useApp();
  const initials = athlete.name.split(/\s+/).filter(Boolean).map((name) => name[0]).join("").slice(0, 2) || "A";
  const isActive = (href: string) =>
    href === "/" ? location === "/" : location.startsWith(href);
  return (
    <div className="grain app-shell text-foreground">
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[252px] flex-col bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform duration-300 md:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="mb-10 flex items-center justify-between px-3">
          <Link
            href="/"
            className="flex items-center gap-3"
            data-testid="link-brand"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
              <Activity size={19} />
            </span>
            <span>
              <span className="block text-sm font-bold tracking-tight">
                Triathlon Coach
              </span>
              <span className="mono text-[9px] uppercase tracking-[.16em] text-sidebar-foreground/55">
                steady, together
              </span>
            </span>
          </Link>
          <IconButton label="close menu" onClick={() => setMobileOpen(false)}>
            <X size={16} />
          </IconButton>
        </div>
        <nav className="flex-1">
          <p className="mono mb-3 px-3 text-[10px] uppercase tracking-[.16em] text-sidebar-foreground/45">
            Training
          </p>
          {navItems.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              data-testid={`link-${label.toLowerCase().replaceAll(" ", "-")}`}
              className={`nav-link mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${isActive(href) ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm" : "text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"}`}
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
              {label === "Recommendations" && (
                recommendations.filter((item) => item.status === "pending" || item.status === "edited").length > 0 && (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-sidebar-primary px-1 text-[10px] font-bold text-sidebar-primary-foreground">
                    {recommendations.filter((item) => item.status === "pending" || item.status === "edited").length}
                  </span>
                )
              )}
            </Link>
          ))}
          <p className="mono mb-3 mt-8 px-3 text-[10px] uppercase tracking-[.16em] text-sidebar-foreground/45">
            Account
          </p>
          {accountItems.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              data-testid={`link-${label.toLowerCase().replaceAll(" ", "-")}`}
              className={`nav-link mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${isActive(href) ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"}`}
            >
              <Icon size={17} strokeWidth={1.8} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="rounded-2xl border border-sidebar-border bg-sidebar-accent/50 p-3">
          <div className="flex items-center gap-2">
            <span className={`pulse-dot h-2 w-2 rounded-full ${connection.configured ? "bg-sidebar-primary" : "bg-amber-400"}`} />
            <span className="text-xs font-semibold">{connection.configured ? "Intervals.icu linked" : "Intervals.icu setup needed"}</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-sidebar-foreground/55">
            {athlete.event || "No race goal set"}
          </p>
        </div>
        <div className="mt-4 flex items-center gap-3 border-t border-sidebar-border pt-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sidebar-primary/15 text-xs font-bold text-sidebar-primary">
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">{athlete.name || "Athlete"}</p>
            <p className="text-[11px] text-sidebar-foreground/45">
              {athlete.event || "No goal set"}
            </p>
          </div>
          <MoreHorizontal
            size={16}
            className="ml-auto text-sidebar-foreground/45"
          />
        </div>
      </aside>
      <div className="md:pl-[252px]">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border/70 bg-background/85 px-5 backdrop-blur-xl md:px-10">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 hover:bg-secondary md:hidden"
            data-testid="button-open-menu"
          >
            <Menu size={20} />
          </button>
          <div className="hidden items-center gap-2 text-sm text-muted-foreground md:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Supabase · Intervals.icu <span className="text-border">/</span>{" "}
            <span className="text-foreground">
              {location === "/" ? "Today" : location.slice(1).replace("-", " ")}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <IconButton label="help">
              <CircleHelp size={18} />
            </IconButton>
            <Link
              href="/profile"
              className="ml-1 flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-secondary"
              data-testid="link-header-profile"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-orange-800">
                {initials}
              </span>
              <span className="hidden text-sm font-semibold sm:block">
                {athlete.name.split(" ")[0] || "Athlete"}
              </span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-5 py-7 md:px-10 md:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}

function Dashboard() {
  const { athlete, sessions, checkIns } = useApp();
  const todaySession =
    sessions.find((s) => s.date === shift(0) && s.status === "planned") ??
    sessions.find((s) => s.date === shift(0));
  const mondayOffset = -((today.getDay() + 6) % 7);
  const weekSessions = sessions.filter((s) => s.date >= shift(mondayOffset) && s.date <= shift(mondayOffset + 6));
  const weekCompleted = weekSessions.filter((s) => s.status === "completed").length;
  const garminSources = [...new Set(sessions.map((session) => session.source).filter((source): source is string => Boolean(source)))];
  const daysToRace = athlete.raceDate ? Math.max(0, Math.ceil((new Date(`${athlete.raceDate}T12:00:00`).getTime() - today.getTime()) / 86400000)) : null;
  return (
    <div className="space-y-9">
      <div className="fade-up flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mono mb-2 text-[10px] uppercase tracking-[.18em] text-muted-foreground">
            {longDate(shift(0))}
          </p>
          <h1 className="display text-4xl leading-none md:text-5xl">
            Good morning, {athlete.name.split(" ")[0]}.
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
            A measured day is still a meaningful day. Here’s the shape of your
            training.
          </p>
        </div>
        <Link
          href="/check-in"
          data-testid="link-start-check-in"
          className="inline-flex items-center gap-2 self-start rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 hover:border-accent md:self-auto"
        >
          How are you feeling? <ArrowRight size={16} />
        </Link>
      </div>
      <section className="fade-up delay-1 grid gap-4 lg:grid-cols-[1.4fr_.8fr]">
        <div className="relative overflow-hidden rounded-3xl bg-primary p-6 text-primary-foreground shadow-xl shadow-primary/10 md:p-8">
          <div className="absolute -right-16 -top-24 h-64 w-64 rounded-full border border-accent/25" />
          <div className="absolute -right-8 -top-16 h-48 w-48 rounded-full border border-accent/20" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <Badge tone="coral">Today’s focus</Badge>
              <span className="mono text-[10px] uppercase tracking-[.14em] text-primary-foreground/55">
                synced from Intervals.icu
              </span>
            </div>
            {todaySession ? (
              <>
                <p className="mt-7 text-xs text-primary-foreground/65">
                  Your planned session
                </p>
                <h2 className="display mt-1 max-w-md text-3xl">
                  {todaySession.title}
                </h2>
                <div className="mt-4 flex flex-wrap gap-4 text-sm text-primary-foreground/70">
                  <span className="inline-flex items-center gap-2">
                    <Timer size={15} />
                    {todaySession.duration}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <Gauge size={15} />
                    {todaySession.intensity}
                  </span>
                  {todaySession.distance && (
                    <span className="inline-flex items-center gap-2">
                      <Activity size={15} />
                      {todaySession.distance}
                    </span>
                  )}
                </div>
                <p className="mt-6 max-w-md text-sm leading-relaxed text-primary-foreground/70">
                  {todaySession.notes}
                </p>
                <div className="mt-7 flex flex-wrap gap-2">
                  <a href={todaySession.externalUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-4 text-sm font-semibold text-secondary-foreground hover:bg-secondary/70">
                    <ExternalLink size={15} /> Open Intervals.icu
                  </a>
                  <Link
                    href="/calendar"
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-primary-foreground/75 transition hover:bg-white/10 hover:text-primary-foreground"
                    data-testid="link-view-calendar"
                  >
                    View calendar <ArrowRight size={16} />
                  </Link>
                </div>
              </>
            ) : (
              <EmptyState
                title="Nothing planned today"
                text="No workout is scheduled in Intervals.icu today."
              />
            )}
          </div>
        </div>
        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
          <p className="mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
            The bigger picture
          </p>
          <h2 className="display mt-4 text-3xl">{athlete.event || "No race goal yet"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{athlete.raceDate && daysToRace !== null ? `${prettyDate(athlete.raceDate)} · ${daysToRace} days to go` : "Add a target race in your athlete profile."}</p>
          <div className="mt-8 grid grid-cols-2 gap-5 border-t border-border pt-5">
            <Metric
              label="This week"
              value={`${weekCompleted}/${weekSessions.length}`}
              sub="completed / imported"
            />
            <Metric label="Check-ins" value={`${checkIns.length}`} sub="saved to Supabase" accent />
          </div>
          {garminSources.length > 0 && <p className="mt-4 text-xs font-semibold text-sky-800">Activity data includes {garminSources.join(", ")}.</p>}
        </div>
      </section>
      <section className="fade-up delay-2 grid gap-8 lg:grid-cols-[1.1fr_.9fr]">
        <div>
          <SectionTitle
            eyebrow="Next on the horizon"
            title="Your week, at a glance"
            action={
              <Link
                href="/calendar"
                className="text-xs font-bold text-accent hover:underline"
                data-testid="link-see-all-sessions"
              >
                See full week
              </Link>
            }
          />
          <div className="rounded-2xl border border-border bg-card px-5 py-1 shadow-sm">
            {sessions
              .filter((s) => s.date >= shift(0) && s.date <= shift(5))
              .slice(0, 5)
              .map((s) => (
                <div
                  key={s.id}
                  className="border-b border-border/70 last:border-0"
                >
                  <div className="flex items-center gap-2 pt-3">
                    <span className="w-14 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      {s.date === shift(0) ? "Today" : prettyDate(s.date)}
                    </span>
                    <span className="h-1 w-1 rounded-full bg-border" />
                    <span className="text-[11px] text-muted-foreground">
                      {s.status === "completed" ? "Complete" : "Planned"}
                    </span>
                  </div>
                  <SessionRow session={s} />
                </div>
              ))}
          </div>
        </div>
        <div>
          <SectionTitle
            eyebrow="Recent context"
            title="Signals worth noticing"
          />
          <div className="space-y-3">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                    <TrendingUp size={17} />
                  </span>
                  <div>
                    <p className="text-sm font-bold">Intervals.icu data</p>
                    <p className="mt-1 text-xs text-muted-foreground">{sessions.length} planned workouts and completed activities loaded.</p>
                  </div>
                </div>
                <span className="mono text-sm text-emerald-700">Live</span>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-50 text-orange-700">
                  <HeartPulse size={17} />
                </span>
                <div>
                  <p className="text-sm font-bold">
                    Last check-in: {checkIns[0]?.readiness ?? "—"}/10 ready
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                      {checkIns[0]?.note || "No notes yet."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function CalendarPage() {
  const { sessions, connection } = useApp();
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = new Date(today);
  weekStart.setDate(
    today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7,
  );
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return iso(d);
  });
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Training calendar"
        title="The week in motion"
          description="Planned workouts and completed activities are read from your Intervals.icu calendar."
        action={
          <Button
            onClick={() => setWeekOffset(0)}
            variant="secondary"
            testId="button-jump-today"
          >
            <CalendarDays size={16} /> Today
          </Button>
        }
      />
      <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-3 shadow-sm">
        <Button
          onClick={() => setWeekOffset((v) => v - 1)}
          variant="ghost"
          testId="button-previous-week"
        >
          Previous
        </Button>
        <p className="text-sm font-semibold">
          {prettyDate(days[0])} — {prettyDate(days[6])}
        </p>
        <Button
          onClick={() => setWeekOffset((v) => v + 1)}
          variant="ghost"
          testId="button-next-week"
        >
          Next
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-7">
        {days.map((day, index) => {
          const daySessions = sessions.filter((s) => s.date === day);
          const isToday = day === shift(0);
          return (
            <div
              key={day}
              className={`min-h-[280px] rounded-2xl border p-3 ${isToday ? "border-accent bg-accent/[.045] shadow-sm" : "border-border bg-card"}`}
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                    {new Intl.DateTimeFormat("en-US", {
                      weekday: "short",
                    }).format(new Date(`${day}T12:00:00`))}
                  </p>
                  <p
                    className={`mt-1 text-xl font-semibold ${isToday ? "text-accent" : ""}`}
                  >
                    {new Date(`${day}T12:00:00`).getDate()}
                  </p>
                </div>
                {isToday && <Badge tone="coral">Today</Badge>}
              </div>
              <div className="space-y-2">
                {daySessions.length ? (
                  daySessions.map((s) => (
                    <a
                      href={s.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      key={s.id}
                      data-testid={`calendar-session-${s.id}`}
                      className={`block w-full rounded-xl border p-3 text-left transition hover:-translate-y-0.5 ${s.status === "completed" ? "border-emerald-200 bg-emerald-50/70" : "border-border bg-background hover:border-accent/50"}`}
                    >
                      <div className="flex items-center justify-between">
                        <SessionIcon sport={s.sport} />
                        {s.status === "completed" ? (
                          <CheckCircle2
                            size={15}
                            className="text-emerald-600"
                          />
                        ) : (
                          <span className="h-2 w-2 rounded-full bg-accent" />
                        )}
                      </div>
                      <p className="mt-3 text-xs font-bold leading-snug">
                        {s.title}
                      </p>
                      {s.source && <p className="mt-1 text-[10px] font-semibold text-sky-800">{s.source}</p>}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {s.duration}
                      </p>
                    </a>
                  ))
                ) : (
                  <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-border text-center text-xs text-muted-foreground">
                    Open space
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-5 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-accent" /> Planned
        </span>
        <span className="flex items-center gap-2">
          <CheckCircle2 size={14} className="text-emerald-600" /> Completed
        </span>
        <span className="flex items-center gap-2"><ExternalLink size={14} /> Open a session in Intervals.icu to view its details</span>
        {!connection.configured && <span className="text-amber-700">Add your Intervals.icu API key in the local .env file to load workouts.</span>}
      </div>
    </div>
  );
}

function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div>
        <p className="mono mb-2 text-[10px] uppercase tracking-[.18em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="display text-4xl md:text-5xl">{title}</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-primary/30 bg-primary/10 p-5">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs text-primary-foreground/70">{text}</p>
    </div>
  );
}

function CheckInPage() {
  const { checkIns, saveCheckIn, toast } = useApp();
  const latest = checkIns[0];
  const [form, setForm] = useState({
    fatigue: latest?.fatigue ?? 4,
    stress: latest?.stress ?? 3,
    soreness: latest?.soreness ?? 2,
    illness: latest?.illness ?? "None",
    readiness: latest?.readiness ?? 7,
    note: "",
  });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveCheckIn({ ...form, timestamp: iso(today) });
      setSaved(true);
      toast("Check-in saved to Supabase. Thanks for the honest signal.");
      setTimeout(() => setSaved(false), 2500);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save your check-in.");
    } finally {
      setSaving(false);
    }
  };
  const scale = (
    key: "fatigue" | "stress" | "soreness" | "readiness",
    label: string,
    low: string,
    high: string,
  ) => (
    <div>
      <div className="mb-3 flex items-end justify-between">
        <label className="text-sm font-semibold">{label}</label>
        <span className="display text-2xl text-accent">
          {form[key]}
          <span className="text-sm text-muted-foreground">/10</span>
        </span>
      </div>
      <input
        data-testid={`input-${key}`}
        type="range"
        min="1"
        max="10"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
        className="h-2 w-full cursor-pointer accent-[hsl(var(--accent))]"
      />
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Daily feedback"
        title="Check in with yourself"
        description="Your lived experience is a first-class training input. A two-minute note can change the shape of a week."
        action={
          <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
            <ShieldCheck size={15} className="text-emerald-600" /> Stored in
            your Supabase database
          </div>
        }
      />
      <div className="grid gap-8 lg:grid-cols-[1.1fr_.9fr]">
        <form
          onSubmit={submit}
          className="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8"
        >
          <div className="mb-8 flex items-start justify-between border-b border-border pb-5">
            <div>
              <p className="text-sm font-bold">How is your system today?</p>
              <p className="mt-1 text-xs text-muted-foreground">
                There is no right answer. Notice, then record.
              </p>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-50 text-orange-700">
              <HeartPulse size={18} />
            </span>
          </div>
          <div className="space-y-8">
            {scale("fatigue", "Fatigue", "Fresh", "Drained")}
            {scale("stress", "Life stress", "Light", "Heavy")}
            {scale("soreness", "Muscle soreness", "None", "Significant")}
            {scale(
              "readiness",
              "Readiness to train",
              "Not ready",
              "Ready to go",
            )}
          </div>
          <div className="mt-8">
            <label htmlFor="illness" className="text-sm font-semibold">
              Any illness signal?
            </label>
            <select
              id="illness"
              value={form.illness}
              onChange={(e) => setForm({ ...form, illness: e.target.value })}
              data-testid="select-illness"
              className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-accent"
            >
              <option>None</option>
              <option>Something feels off</option>
              <option>Cold or flu symptoms</option>
              <option>Injury concern</option>
            </select>
          </div>
          <div className="mt-6">
            <label htmlFor="note" className="text-sm font-semibold">
              A little more context{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <textarea
              id="note"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              data-testid="input-check-in-note"
              rows={4}
              placeholder="Sleep, life load, what you noticed on the last session…"
              className="mt-2 w-full resize-none rounded-lg border border-input bg-background p-3 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-accent"
            />
          </div>
          <div className="mt-6 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Saved to your Supabase database.
            </p>
            <Button type="submit" disabled={saving} testId="button-save-check-in">
              <Save size={16} /> {saving ? "Saving…" : saved ? "Saved" : "Save check-in"}
            </Button>
          </div>
        </form>
        <div className="space-y-4">
          <div className="rounded-3xl bg-primary p-6 text-primary-foreground shadow-lg md:p-7">
            <p className="mono text-[10px] uppercase tracking-[.16em] text-primary-foreground/55">
              Your recent rhythm
            </p>
            <h2 className="display mt-4 text-3xl">
              Small signals,{" "}
              <span className="text-accent">useful direction.</span>
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-primary-foreground/70">
              A check-in does not diagnose anything. It simply gives your plan
              more context than numbers alone.
            </p>
            <div className="mt-7 grid grid-cols-2 gap-5 border-t border-primary-foreground/15 pt-5">
              <Metric
                label="Last readiness"
                value={`${latest?.readiness ?? "—"}/10`}
                sub={latest ? prettyDate(latest.timestamp) : "No history"}
              />
              <Metric
                label="Check-ins"
                value={`${checkIns.length}`}
                sub="saved in Supabase"
                accent
              />
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <History size={16} className="text-accent" />
              <p className="text-sm font-bold">Recent notes</p>
            </div>
            {checkIns.slice(0, 3).map((c) => (
              <div
                key={c.id}
                className="border-t border-border py-3 first:border-0"
              >
                <div className="flex justify-between text-xs">
                  <span className="font-semibold">
                    {prettyDate(c.timestamp)}
                  </span>
                  <span className="text-muted-foreground">
                    Readiness {c.readiness}/10
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {c.note || "No note added."}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecommendationsPage() {
  const { recommendations, updateRecommendation, toast } = useApp();
  const [editing, setEditing] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [saving, setSaving] = useState(false);
  const decide = async (id: string, status: RecommendationStatus) => {
    setSaving(true);
    try {
      await updateRecommendation(id, { status });
      toast(status === "approved" ? "Recommendation approval saved." : "Recommendation dismissed.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not update recommendation.");
    } finally {
      setSaving(false);
    }
  };
  const proposed = recommendations.filter((r) => r.status === "pending" || r.status === "edited");
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Coach’s desk"
        title="Recommendations to review"
        description="Recommendations saved in Supabase for your review. Coaching suggestions are not generated automatically yet."
      />
      {proposed.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border bg-card p-14 text-center">
          <CheckCircle2 size={32} className="mx-auto text-emerald-600" />
          <h2 className="display mt-4 text-2xl">You’re all caught up.</h2>
          <p className="mt-2 text-sm text-muted-foreground">No recommendations have been added yet.</p>
        </div>
      ) : (
        <div className="grid gap-5">
          {proposed.map((r, index) => (
            <div
              key={r.id}
              className={`fade-up delay-${index + 1} rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8`}
              data-testid={`card-recommendation-${r.id}`}
            >
              <div className="flex flex-col justify-between gap-4 md:flex-row">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={r.status === "edited" ? "blue" : "coral"}>{r.status === "edited" ? "Edited" : "Pending"}</Badge>
                    <span className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                      {r.trigger}
                    </span>
                  </div>
                  <h2 className="display mt-4 max-w-2xl text-2xl">
                    {r.proposedChange}
                  </h2>
                </div>
                <div className="flex shrink-0 gap-2">
                    <Button
                      onClick={() => void decide(r.id, "approved")}
                      disabled={saving}
                    testId={`button-approve-${r.id}`}
                  >
                    <Check size={16} /> Approve
                  </Button>
                    <IconButton
                      label={`edit recommendation ${r.id}`}
                      onClick={() => { setEditing(editing === r.id ? null : r.id); setEditingText(r.proposedChange); }}
                  >
                    <Pencil size={16} />
                  </IconButton>
                    <IconButton
                      label={`dismiss recommendation ${r.id}`}
                      onClick={() => void decide(r.id, "dismissed")}
                  >
                    <X size={17} />
                  </IconButton>
                </div>
              </div>
              {editing === r.id && (
                <div className="mt-5 rounded-xl border border-accent/30 bg-orange-50/50 p-4">
                  <label className="text-xs font-bold uppercase tracking-wide text-orange-800">
                    Edit before approval
                  </label>
                  <textarea
                    value={editingText}
                    onChange={(event) => setEditingText(event.target.value)}
                    data-testid={`input-edit-recommendation-${r.id}`}
                    className="mt-2 w-full rounded-lg border border-orange-200 bg-card p-3 text-sm outline-none focus:border-accent"
                    rows={2}
                  />
                  <div className="mt-3 flex justify-end">
                    <Button
                      onClick={async () => {
                        const changes = r.proposedChanges.length
                          ? r.proposedChanges.map((change, index) => index === 0 ? { ...change, to: editingText } : change)
                          : [{ field: "summary", to: editingText }];
                        setSaving(true);
                        try {
                          await updateRecommendation(r.id, { status: "edited", proposedChanges: changes });
                          setEditing(null);
                          toast("Edit saved to Supabase. Approve it separately when ready.");
                        } catch (error) {
                          toast(error instanceof Error ? error.message : "Could not save the edit.");
                        } finally {
                          setSaving(false);
                        }
                      }}
                      disabled={saving || !editingText.trim()}
                      variant="secondary"
                      testId={`button-save-edit-${r.id}`}
                    >
                      <Save size={15} /> Keep edit
                    </Button>
                  </div>
                </div>
              )}
              <div className="mt-7 grid gap-5 border-t border-border pt-5 md:grid-cols-2">
                <div>
                  <p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                      Athlete context
                  </p>
                  <p className="mt-2 text-sm leading-relaxed">{r.evidence}</p>
                </div>
                <div>
                  <p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                    Why this might help
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {r.rationale}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-secondary/45 p-4">
        <ShieldCheck
          size={17}
          className="mt-0.5 shrink-0 text-muted-foreground"
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          <strong className="text-foreground">No workout changes are sent to Intervals.icu from this screen.</strong>{" "}
          Recommendations are stored for review; automated coaching logic is not enabled yet.
        </p>
      </div>
    </div>
  );
}

function PlanPage() {
  const { athlete, sessions, recommendations } = useApp();
  const approved = recommendations.filter((r) => r.status === "approved");
  const mondayOffset = -((today.getDay() + 6) % 7);
  const weekSessions = sessions.filter((s) => s.date >= shift(mondayOffset) && s.date <= shift(mondayOffset + 6));
  const completed = weekSessions.filter((s) => s.status === "completed").length;
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Training architecture"
        title={athlete.event ? `${athlete.event} plan` : "Your training plan"}
        description="Planned workouts come from Intervals.icu. This app does not invent a training plan or write changes back yet."
      />
      <section className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
        <div className="rounded-3xl bg-primary p-7 text-primary-foreground shadow-lg">
          <div className="flex items-center justify-between">
            <span className="mono text-[10px] uppercase tracking-[.16em] text-primary-foreground/55">This week from Intervals.icu</span>
            <Badge tone="coral">{weekSessions.length} sessions</Badge>
          </div>
          <h2 className="display mt-5 text-4xl">
            Your plan, as it is.
            <br />
            <span className="text-accent">No invented workouts.</span>
          </h2>
          <p className="mt-5 max-w-lg text-sm leading-relaxed text-primary-foreground/70">
            Use Intervals.icu as the source of truth for planned sessions and completed activities. Approved recommendations are recorded here but never silently alter that plan.
          </p>
          <div className="mt-8 h-2 rounded-full bg-primary-foreground/15">
            <div className="h-full rounded-full bg-accent" style={{ width: `${weekSessions.length ? Math.round(completed / weekSessions.length * 100) : 0}%` }} />
          </div>
          <div className="mt-3 flex justify-between text-xs text-primary-foreground/55">
            <span>{completed} completed</span>
            <span>{weekSessions.length} this week</span>
          </div>
        </div>
        <div className="rounded-3xl border border-border bg-card p-7 shadow-sm">
          <p className="mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">
            Plan at a glance
          </p>
          <div className="mt-6 space-y-5">
            <Metric
              label="Target event"
              value={athlete.distance || "—"}
              sub={athlete.event ? `${athlete.event}${athlete.raceDate ? ` · ${prettyDate(athlete.raceDate)}` : ""}` : "Set a goal in Athlete profile"}
            />
            <div className="border-t border-border pt-5">
              <Metric
                label="This week"
                value={`${completed}/${weekSessions.length}`}
                sub="completed / imported workouts"
              />
            </div>
          </div>
        </div>
      </section>
      <section className="grid gap-8 lg:grid-cols-[1.1fr_.9fr]">
        <div>
          <SectionTitle eyebrow="This week" title="From Intervals.icu" />
          <div className="rounded-2xl border border-border bg-card px-5 shadow-sm">
            {sessions
              .filter((s) => s.date >= shift(mondayOffset) && s.date <= shift(mondayOffset + 6))
              .map((s) => (
                <div
                  key={s.id}
                  className="border-b border-border/70 last:border-0"
                >
                  <SessionRow session={s} />
                </div>
              ))}
            {weekSessions.length === 0 && <p className="py-6 text-sm text-muted-foreground">No planned workouts or completed activities for this week.</p>}
          </div>
        </div>
        <div>
          <SectionTitle eyebrow="Change history" title="What moved, and why" />
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            {approved.map((c) => (
                <div
                  key={c.id}
                  className="relative border-l border-accent/40 pb-6 pl-5 last:pb-1"
                >
                  <span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-accent" />
                  <p className="text-sm font-semibold">{c.proposedChange}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.trigger}
                  </p>
                  <p className="mono mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {c.date} · Approved in Supabase
                  </p>
                </div>
              ))}
            {approved.length === 0 && <p className="py-2 text-sm text-muted-foreground">No approved recommendations yet.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}

function ProfilePage() {
  const { athlete, saveAthlete, toast } = useApp();
  const [form, setForm] = useState(athlete);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const saved = await saveAthlete(form);
      setForm(saved);
      setEditing(false);
      toast("Profile saved to Supabase.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Athlete profile"
        title="The context behind the plan"
        description="Tell the plan who it is for. You can change any of this as the season evolves."
        action={
          !editing && (
            <Button
              onClick={() => setEditing(true)}
              variant="secondary"
              testId="button-edit-profile"
            >
              <Pencil size={16} /> Edit profile
            </Button>
          )
        }
      />
      <form onSubmit={save} className="grid gap-6 lg:grid-cols-[.8fr_1.2fr]">
        <div className="rounded-3xl bg-primary p-7 text-primary-foreground">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-2xl font-bold text-accent-foreground">
            {form.name
              .split(" ")
              .map((n) => n[0])
              .join("")}
          </span>
          <h2 className="display mt-6 text-3xl">{form.name}</h2>
          <p className="mt-2 text-sm text-primary-foreground/65">
            {form.sport} athlete · {form.event}
          </p>
          <div className="mt-9 border-t border-primary-foreground/15 pt-5">
            <p className="mono text-[10px] uppercase tracking-[.15em] text-primary-foreground/50">
              Goal
            </p>
            <p className="mt-2 text-lg font-semibold">{form.distance ? `${form.distance} finish` : "Distance not set"}</p>
            <p className="mt-1 text-sm text-primary-foreground/60">
              {form.raceDate ? prettyDate(form.raceDate) : "Date not set"}
            </p>
          </div>
        </div>
        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
          <div className="grid gap-5 md:grid-cols-2">
            {[
              ["name", "Name"],
              ["event", "Target event"],
              ["raceDate", "Race date"],
              ["distance", "Distance"],
            ].map(([key, label]) => (
              <div key={key}>
                <label
                  htmlFor={key}
                  className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
                >
                  {label}
                </label>
                {key === "distance" ? (
                  <select
                    id={key}
                    disabled={!editing}
                    value={form.distance}
                    onChange={(e) => setForm({ ...form, distance: e.target.value })}
                    data-testid="input-profile-distance"
                    className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-accent disabled:cursor-not-allowed disabled:opacity-65"
                  >
                    <option value="">Select a distance</option>
                    <option value="Half Ironman">Half Ironman (70.3)</option>
                    <option value="Ironman">Ironman (140.6)</option>
                  </select>
                ) : (
                  <input
                    id={key}
                    disabled={!editing}
                    value={form[key as keyof Athlete] as string}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    data-testid={`input-profile-${key}`}
                    type={key === "raceDate" ? "date" : "text"}
                    className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-accent disabled:cursor-not-allowed disabled:opacity-65"
                  />
                )}
              </div>
            ))}
          </div>
          <div className="mt-8 border-t border-border pt-6">
            <p className="text-sm font-bold">Weekly availability · saved in Supabase</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose the days that generally work for training.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                <button
                  type="button"
                  key={day}
                  disabled={!editing}
                  onClick={() =>
                    setForm({
                      ...form,
                      availability: form.availability.includes(day)
                        ? form.availability.filter((d) => d !== day)
                        : [...form.availability, day],
                    })
                  }
                  data-testid={`button-availability-${day.toLowerCase()}`}
                  className={`h-10 rounded-lg border px-4 text-xs font-bold transition ${form.availability.includes(day) ? "border-accent bg-orange-50 text-orange-800" : "border-border text-muted-foreground hover:bg-secondary"} disabled:cursor-not-allowed`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-8 border-t border-border pt-6">
            <label htmlFor="tone" className="text-sm font-bold">
              Coach voice
            </label>
            <select
              id="tone"
              disabled={!editing}
              value={form.preferences.coachTone}
              onChange={(e) =>
                setForm({
                  ...form,
                  preferences: {
                    ...form.preferences,
                    coachTone: e.target.value,
                  },
                })
              }
              data-testid="select-coach-tone"
              className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none disabled:opacity-65"
            >
              <option>Warm + direct</option>
              <option>Quiet + reflective</option>
              <option>Detailed + analytical</option>
            </select>
          </div>
          {editing && (
            <div className="mt-8 flex justify-end gap-2 border-t border-border pt-6">
              <Button
                onClick={() => {
                  setForm(athlete);
                  setEditing(false);
                }}
                variant="ghost"
                testId="button-cancel-profile"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving} testId="button-save-profile">
                <Save size={16} /> {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

function SettingsPage() {
  const { connection, databaseConnected, refresh, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const sync = async () => {
    setBusy(true);
    try {
      await refresh();
      toast("Data refreshed. Check connection status below.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not refresh data.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Connections & privacy"
        title="Keep your data in view"
        description="Your training records live in Supabase. Planned workouts and completed activities come from Intervals.icu through the local API."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_.75fr]">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
          <div className="flex flex-col justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-center">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <Link2 size={21} />
              </span>
              <div>
                <h2 className="text-lg font-bold">Intervals.icu</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {connection.configured ? `Athlete ${connection.athleteId}` : "API key not configured"}
                </p>
              </div>
            </div>
            {connection.configured && !connection.error ? <Badge tone="green"><CheckCircle2 size={13} /> Connected</Badge> : <Badge tone="amber"><Info size={13} /> {connection.configured ? "Needs attention" : "Setup needed"}</Badge>}
            <Button onClick={() => void sync()} disabled={busy} testId="button-sync-data">
              <RefreshCw size={16} className={busy ? "animate-spin" : ""} /> {busy ? "Syncing…" : "Sync now"}
            </Button>
          </div>
          <div className="grid gap-7 py-7 md:grid-cols-2">
            <div>
              <p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                Supabase · {databaseConnected ? "connected" : "not connected"}
              </p>
              <ul className="mt-4 space-y-3"><li className="flex items-center gap-2 text-sm"><Check size={15} className="text-emerald-600" />Athlete profile and race goals</li><li className="flex items-center gap-2 text-sm"><Check size={15} className="text-emerald-600" />Daily check-ins and recommendation decisions</li></ul>
            </div>
            <div>
              <p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                Intervals.icu · read-only for now
              </p>
              <ul className="mt-4 space-y-3"><li className="flex items-center gap-2 text-sm"><Check size={15} className="text-emerald-600" />Planned calendar workouts</li><li className="flex items-center gap-2 text-sm"><Check size={15} className="text-emerald-600" />Completed activities</li><li className="flex items-center gap-2 text-sm text-muted-foreground"><X size={15} />Writing workouts back is not enabled</li></ul>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl bg-secondary/60 p-4">
            <ShieldCheck size={17} className="mt-0.5 text-primary" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              The Intervals.icu API key stays in your ignored local .env file and is only read by the server. It is never sent to this browser page.
            </p>
          </div>
          {connection.error && (
            <p role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Intervals.icu could not be reached: {connection.error}
            </p>
          )}
          {!connection.configured && (
            <div className="mt-4 rounded-xl border border-dashed border-border p-4 text-sm">
              <p className="font-semibold">Connect your Intervals.icu account</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>Create a personal API key in Intervals.icu account settings.</li>
                <li>Add it as <code>INTERVALS_API_KEY=your_key</code> in the repo-root <code>.env</code> file. Do not paste it into chat or this page.</li>
                <li>Restart the local API server, then select Sync now.</li>
              </ol>
            </div>
          )}
          {connection.lastSync && (
            <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw size={13} /> Last sync{" "}
              {new Date(connection.lastSync).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>
        <div className="space-y-5">
          <div className="rounded-3xl bg-orange-50 p-6">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-card text-orange-700">
              <CloudSun size={19} />
            </span>
            <h2 className="display mt-5 text-2xl text-orange-950">
              Make room for the unknown.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-orange-900/70">
              Missing data isn’t failure. You can always use a check-in to add
              the context a device cannot see.
            </p>
            <Link
              href="/check-in"
              className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-orange-800 hover:underline"
              data-testid="link-manual-check-in"
            >
              Add a manual check-in <ArrowRight size={15} />
            </Link>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <Info size={16} className="text-muted-foreground" />
              <p className="text-sm font-bold">Backend-only database access</p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              The browser talks to your local API. The API reads and writes Supabase, while workouts are read from Intervals.icu. User authentication is not implemented yet; keep this app private on your computer.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="mx-auto max-w-lg py-24 text-center">
      <p className="mono text-xs uppercase tracking-[.16em] text-muted-foreground">
        404
      </p>
      <h1 className="display mt-4 text-4xl">That trail ends here.</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        The page you’re looking for doesn’t exist in this training space.
      </p>
      <Link
        href="/"
        className="mt-7 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
        data-testid="link-back-home"
      >
        Back to today <ArrowRight size={16} />
      </Link>
    </div>
  );
}

function Router() {
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/calendar" component={CalendarPage} />
        <Route path="/check-in" component={CheckInPage} />
        <Route path="/recommendations" component={RecommendationsPage} />
        <Route path="/plan" component={PlanPage} />
        <Route path="/profile" component={ProfilePage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFoundPage} />
      </Switch>
    </AppShell>
  );
}

const queryClient = new QueryClient();
function App() {
  const [athlete, setAthlete] = useState<Athlete>(emptyAthlete);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [connection, setConnection] = useState<Connection>({ configured: false, athleteId: "0" });
  const [databaseConnected, setDatabaseConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const toast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(""), 2800);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [athleteRecord, goals, checkInRecords, recommendationRecords, intervalsStatus] = await Promise.all([
        dataApi.athlete(),
        dataApi.goals(),
        dataApi.checkIns(),
        dataApi.recommendations(),
        dataApi.intervalsStatus(),
      ]);
      const raceGoal = goals.find((goal) => goal.type === "race") ?? goals[0];
      setAthlete(athleteFromRecord(athleteRecord, raceGoal));
      setCheckIns(checkInRecords.map(checkInFromRecord));
      setRecommendations(recommendationRecords.map(recommendationFromRecord));
      setDatabaseConnected(true);

      if (intervalsStatus.configured) {
        try {
          const calendar = await dataApi.intervalsCalendar(shift(-84), shift(180));
          setSessions(sessionsFromIntervals(calendar.events, calendar.activities));
          setConnection({ configured: true, athleteId: intervalsStatus.athleteId, lastSync: calendar.syncedAt });
        } catch (error) {
          setSessions([]);
          setConnection({ configured: true, athleteId: intervalsStatus.athleteId, error: error instanceof Error ? error.message : "Could not load Intervals.icu data." });
        }
      } else {
        setSessions([]);
        setConnection({ configured: false, athleteId: intervalsStatus.athleteId });
      }
    } catch (error) {
      setDatabaseConnected(false);
      setLoadError(error instanceof Error ? error.message : "Could not load your Supabase data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveAthlete = async (form: Athlete) => {
    const record = await dataApi.updateAthlete({
      name: form.name.trim(),
      timezone: form.timezone,
      availabilityDays: form.availability,
      preferences: form.preferences,
    });
    let savedGoal: GoalRecord | undefined;
    const goalBody = {
      type: "race",
      name: form.event.trim() || "Race goal",
      targetDate: form.raceDate || null,
      targetValue: null,
      targetUnit: form.distance.trim() || null,
      notes: null,
    };
    if (form.goalId) savedGoal = await dataApi.updateGoal(form.goalId, goalBody);
    else if (form.event.trim() || form.distance.trim() || form.raceDate) savedGoal = await dataApi.createGoal(goalBody);
    const next = athleteFromRecord(record, savedGoal);
    setAthlete(next);
    return next;
  };

  const saveCheckIn = async (form: Omit<CheckIn, "id">) => {
    const record = await dataApi.saveCheckIn({
      checkInDate: form.timestamp,
      readiness: form.readiness,
      energy: 11 - form.fatigue,
      soreness: form.soreness,
      stress: form.stress,
      illnessSignal: form.illness === "None" ? null : form.illness,
      notes: form.note.trim() || null,
    });
    const saved = checkInFromRecord(record);
    setCheckIns((previous) => [saved, ...previous.filter((item) => item.timestamp !== saved.timestamp)]);
  };

  const updateRecommendation = async (id: string, patch: Partial<RecommendationRecord>) => {
    const updated = await dataApi.updateRecommendation(id, patch);
    const mapped = recommendationFromRecord(updated);
    setRecommendations((previous) => previous.map((item) => item.id === id ? mapped : item));
  };

  const value: AppState = {
    athlete,
    sessions,
    checkIns,
    recommendations,
    connection,
    databaseConnected,
    loading,
    loadError,
    refresh,
    saveAthlete,
    saveCheckIn,
    updateRecommendation,
    toast,
  };
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppData.Provider value={value}>
            {loading ? (
              <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading your training data…</div>
            ) : loadError ? (
              <div className="grid min-h-screen place-items-center p-6"><div className="max-w-md rounded-2xl border border-border bg-card p-6 text-center"><h1 className="display text-2xl">Could not load your data</h1><p className="mt-3 text-sm text-muted-foreground">{loadError}</p><Button onClick={() => void refresh()} variant="secondary" testId="button-retry-data" ><RefreshCw size={15} /> Try again</Button></div></div>
            ) : (
              <Router />
            )}
          </AppData.Provider>
        </WouterRouter>
        <Toaster />
        {toastMessage && (
          <div
            role="status"
            data-testid="status-toast"
            className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-primary px-5 py-3 text-xs font-semibold text-primary-foreground shadow-xl fade-up"
          >
            {toastMessage}
          </div>
        )}
      </TooltipProvider>
    </QueryClientProvider>
  );
}
export default App;
