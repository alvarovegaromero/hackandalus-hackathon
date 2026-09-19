// OWNER: operator dashboard. Pure derivations from coordinator state and telemetry.
import { filterResultSchema } from "@/lib/contracts/filter";
import type { CoordinatorState } from "@/lib/contracts/coordinator";
import type { TelemetryRecord } from "@/lib/event-pipeline";

/** Highest first. "unassessed" covers relevant reports the coordinator has not ranked yet. */
export const PRIORITIES = ["critical", "high", "medium", "low", "unassessed"] as const;
export type PriorityLevel = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  unassessed: "Unassessed",
};

export const FORCES = [
  { kind: "ambulances", label: "Ambulances" },
  { kind: "police", label: "Policía" },
  { kind: "civilGuard", label: "Guardia Civil" },
] as const;

export function allUnits(state: CoordinatorState) {
  return FORCES.flatMap(({ kind }) => state[kind].units);
}

export type Report = {
  id: string;
  at: string;
  title: string;
  /** Relevance filter outcome; an internal pipeline step, never a severity. */
  filter: "pending" | "relevant" | "discarded" | "unavailable";
  filterNote?: string;
};

/** Fold newest-first SSE activity into one report per ingress event. */
export function foldReports(records: TelemetryRecord[]): Report[] {
  const reports = new Map<string, Report>();
  for (const record of records) {
    const report = reports.get(record.eventId) ?? {
      id: record.eventId,
      at: record.at,
      title: "Report",
      filter: "pending",
    };
    if (typeof record.payload.title === "string") report.title = record.payload.title;
    else if (typeof record.payload.description === "string" && report.title === "Report")
      report.title = record.payload.description;
    if (record.type === "event.accepted") report.at = record.at;
    // Pending/receipt frames never overwrite a terminal decision during replay.
    if (
      report.filter === "pending" &&
      (record.type === "filtering.completed" || record.type === "filtering.failed")
    ) {
      const parsed = filterResultSchema.safeParse(record.payload.result);
      const result = parsed.success ? parsed.data : undefined;
      if (record.type === "filtering.failed" || !result || result.status === "unavailable") {
        report.filter = "unavailable";
        report.filterNote = result?.failure?.message ?? "Relevance filter could not complete.";
      } else {
        report.filter = result.decision === "irrelevant" ? "discarded" : "relevant";
        report.filterNote = result.summary;
      }
    }
    reports.set(record.eventId, report);
  }
  return [...reports.values()];
}

export type RankedEvent = {
  id: string;
  priority: PriorityLevel;
  summary: string;
  rationale: string | null;
  at: string | null;
  units: string[];
  /** Relevance filter failed; the report still needs a human look. */
  filterUnavailable: boolean;
};

/** Active coordinator events plus relevant reports it has not ranked, highest priority first. */
export function rankEvents(state: CoordinatorState | null, reports: Report[]): RankedEvent[] {
  const byId = new Map(reports.map((report) => [report.id, report]));
  const units = state ? allUnits(state) : [];
  const ranked: RankedEvent[] = (state?.events ?? []).map((event) => ({
    id: event.eventId,
    priority: event.priority ?? "unassessed",
    summary: event.summary || byId.get(event.eventId)?.title || "Event",
    rationale: event.rationale,
    at: byId.get(event.eventId)?.at ?? null,
    units: units.filter((unit) => unit.eventId === event.eventId).map((unit) => unit.id),
    filterUnavailable: false,
  }));
  const known = new Set(ranked.map((event) => event.id));
  for (const report of reports) {
    if (known.has(report.id) || report.filter === "discarded") continue;
    ranked.push({
      id: report.id,
      priority: "unassessed",
      summary: report.title,
      rationale: report.filterNote ?? null,
      at: report.at,
      units: [],
      filterUnavailable: report.filter === "unavailable",
    });
  }
  const rank = (level: PriorityLevel) => PRIORITIES.indexOf(level);
  return ranked.sort(
    (a, b) => rank(a.priority) - rank(b.priority) || (b.at ?? "").localeCompare(a.at ?? ""),
  );
}

export function countByPriority(events: RankedEvent[]) {
  const counts = Object.fromEntries(PRIORITIES.map((level) => [level, 0])) as Record<
    PriorityLevel,
    number
  >;
  for (const event of events) counts[event.priority] += 1;
  return counts;
}

export type MinuteBin = { minute: number } & Record<PriorityLevel, number>;
const MINUTE = 60_000;
export const TIMELINE_MINUTES = 30;

/** Per-minute stacked counts of ranked events, zero-filled, limited to the last 30 minutes of data. */
export function perMinute(events: RankedEvent[]): MinuteBin[] {
  const timed = events.filter((event) => event.at);
  if (!timed.length) return [];
  const minutes = timed.map((event) => Math.floor(Date.parse(event.at!) / MINUTE) * MINUTE);
  const last = Math.max(...minutes);
  const first = Math.max(Math.min(...minutes), last - (TIMELINE_MINUTES - 1) * MINUTE);
  const bins: MinuteBin[] = [];
  for (let minute = first; minute <= last; minute += MINUTE)
    bins.push({
      minute,
      ...Object.fromEntries(PRIORITIES.map((level) => [level, 0])),
    } as MinuteBin);
  timed.forEach((event, index) => {
    const bin = bins[(minutes[index] - first) / MINUTE];
    if (bin) bin[event.priority] += 1;
  });
  return bins;
}

export function assignedEventLocations(records: TelemetryRecord[]) {
  const locations = new Map<string, { position: [number, number]; title: string }>();
  for (const record of records) {
    if (record.type !== "event.accepted") continue;
    const location = record.payload.location as
      { latitude?: unknown; longitude?: unknown } | undefined;
    const lat = location?.latitude;
    const lng = location?.longitude;
    if (
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    )
      continue;
    locations.set(record.eventId, {
      position: [lat, lng],
      title: typeof record.payload.title === "string" ? record.payload.title : "Assigned event",
    });
  }
  return locations;
}

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
