// OWNER: source-independent signal processing seam.

import { buildDedupeKey } from "@/lib/priority";
import { addCrisisEvent, getSituation } from "@/lib/store";
import type { Confidence, CrisisEvent, CrisisZone, Severity } from "@/lib/types";
import type { HappyRobotNormalizedReport } from "./happyrobot";
import type { PersistedSignal } from "./repository";

const ZONE_ALIASES: Record<string, string[]> = {
  "zone-north": ["sierra morena", "sierra bermeja", "los pinares", "jubrique", "genalguacil"],
  "zone-central": ["sevilla", "seville", "sevilla hub"],
  "zone-east": ["granada", "almeria", "almería"],
  "zone-south": ["costa del sol", "malaga", "málaga", "estepona", "benahavis", "benahavís"],
  "zone-islands": ["cadiz", "cádiz", "estrecho"],
};

function normalized(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export interface ZoneResolution {
  zoneId: string;
  matched: boolean;
  reason: string;
}

export function resolveSignalZone(
  location: HappyRobotNormalizedReport["location"],
  zones: CrisisZone[],
): ZoneResolution {
  const description = normalized(location.description);
  if (description) {
    for (const zone of zones) {
      const candidates = [zone.id, zone.name, ...(ZONE_ALIASES[zone.id] ?? [])].map(normalized);
      if (candidates.some((candidate) => candidate && description.includes(candidate))) {
        return {
          zoneId: zone.id,
          matched: true,
          reason: `Matched reported place to ${zone.name}.`,
        };
      }
    }
  }

  // Active CrisisEvent requires a real zone. Keep this explicit until FARO has
  // an unlocated-event state; never fabricate coordinates or exact precision.
  const fallback = zones.find((zone) => zone.id === "zone-north") ?? zones[0];
  if (!fallback) throw new Error("FARO has no configured zone for an unlocated signal.");
  return {
    zoneId: fallback.id,
    matched: false,
    reason: `Location was not resolved; assigned to explicit intake fallback ${fallback.name}.`,
  };
}

function categoryOf(report: HappyRobotNormalizedReport): string {
  if (report.blocked_roads) return "route-blocked";
  const text = normalized(
    [report.situation.incident_type_text, report.situation.description, report.report_summary]
      .filter(Boolean)
      .join(" "),
  );
  if (/fire|wildfire|fuego|incendio|smoke|humo/.test(text)) return "wildfire";
  if (/flood|inundacion|inundación|water|agua/.test(text)) return "flood";
  if (/medical|medic|sanitari|herid|injur/.test(text)) return "medical";
  if (/road|carretera|access|acceso|blocked|cortad/.test(text)) return "access";
  if (/power|electric|infraestruct|infrastruct/.test(text)) return "infrastructure";
  return "field-report";
}

/** Explainable first-slice urgency heuristic. It is deliberately not a calibrated model. */
export function severityOf(report: HappyRobotNormalizedReport): Severity {
  let score = 0;
  if (report.people.immediate_danger === true) score += 3;
  const count = report.people.affected_or_exposed_count;
  if (count !== null) score += count >= 50 ? 3 : count >= 10 ? 2 : count > 0 ? 1 : 0;
  if (report.people.vulnerable_people_description) score += 1;
  if (report.situation.trend === "worsening") score += 2;
  if (report.affected_infrastructure) score += 1;
  if (report.access_constraints || report.blocked_roads) score += 1;
  const text = normalized(
    [
      report.situation.description,
      report.report_summary,
      ...report.claims.map((claim) => claim.statement),
    ].join(" "),
  );
  if (/trapped|atrapad|explosion|collapse|derrumbe/.test(text)) score += 2;
  else if (/fire|wildfire|fuego|incendio|flood|inundacion|inundación/.test(text)) score += 1;
  if (score >= 6) return "critical";
  if (score >= 3) return "high";
  if (score >= 1) return "medium";
  return "low";
}

/** Evidence-quality heuristic owned by FARO, independent from operational severity. */
export function confidenceOf(report: HappyRobotNormalizedReport): Confidence {
  let score = 0;
  score += Math.min(
    4,
    report.claims.filter((claim) => claim.provenance === "direct_observation").length * 2,
  );
  score -= report.claims.filter((claim) => claim.provenance === "reported_by_other").length;
  score -= report.claims.filter((claim) => claim.provenance === "unclear").length;
  score +=
    report.location.precision === "exact" ? 2 : report.location.precision === "approximate" ? 1 : 0;
  score += report.collection_state === "sufficient" ? 1 : -1;
  if (report.reporter.is_at_scene === true) score += 1;
  if (report.raw_message || report.transcript_reference) score += 1;
  if (score >= 5) return "high";
  if (score >= 2) return "medium";
  return "low";
}

export function interpretHappyRobotSignal(
  signal: PersistedSignal,
  zones: CrisisZone[],
): CrisisEvent {
  const report = signal.rawPayload;
  const zone = resolveSignalZone(report.location, zones);
  const severity = severityOf(report);
  const category = categoryOf(report);
  const description = report.situation.description ?? report.report_summary;
  const locationNote = zone.matched ? "" : ` ${zone.reason}`;

  return {
    id: `evt-signal-${signal.id}`,
    source: "happyrobot",
    title: report.report_summary.slice(0, 200),
    description: `${description}${locationNote}`.slice(0, 2000),
    zoneId: zone.zoneId,
    category,
    severity,
    confidence: confidenceOf(report),
    createdAt: signal.receivedAt,
    confirmed: null,
    dedupeKey: buildDedupeKey({ zoneId: zone.zoneId, category, severity }),
    occurrences: 1,
    appliedRiskDelta: 0,
    appliedNeed: null,
    previousZoneStatus: null,
  };
}

export interface ProcessSignalDependencies {
  getZones: () => CrisisZone[];
  ingestEvent: (event: CrisisEvent) => { event: CrisisEvent; duplicate: boolean };
}

const defaultDependencies: ProcessSignalDependencies = {
  getZones: () => getSituation().zones,
  ingestEvent: (event) => addCrisisEvent(event, "happyrobot"),
};

export function processSignal(
  signal: PersistedSignal,
  dependencies: ProcessSignalDependencies = defaultDependencies,
) {
  if (signal.source !== "happyrobot")
    throw new Error(`Unsupported signal source: ${signal.source}`);
  const interpreted = interpretHappyRobotSignal(signal, dependencies.getZones());
  const result = dependencies.ingestEvent(interpreted);
  return { event: result.event, eventDuplicate: result.duplicate };
}
