// OWNER: priority engine agent.
//
// Command center priority engine. Decides which zone is attended to first
// when information is partial, contradictory, and ages quickly.
//
// A zone's score is a sum of explainable factors:
//
//   score = base risk
//         + live signals (with credibility, repetition, and decay)
//         + population at risk
//         + open needs
//         + downed resources
//         - relief from successfully completed actions
//
// Four ideas underpin the design:
//
//  1. Noise cannot beat signal. Many weak, unverified, low-confidence signals
//     aggregate with diminishing returns and barely move the needle;
//     a single confirmed critical signal does.
//  2. What was known half an hour ago is not worth the same. Each signal decays
//     with age, with half-life based on its severity.
//  3. Resolving something relieves pressure. Successfully completed actions
//     subtract score from their zone, so rankings can drop, not just rise.
//  4. Everything is explainable. The breakdown returned sums exactly to the
//     score, justifying each decision to a human operator.
//
// Note on double counting: the store already applies each signal's effect
// to `zone.riskScore` and `zone.needs`. Here we undo that effect (subtracting
// `appliedRiskDelta` and discounting needs born from live signals) to recount
// with our own rules of credibility and decay. Without this, a signal counts
// twice and never ages.

import type {
  Action,
  Confidence,
  CrisisEvent,
  CrisisZone,
  Plan,
  PlanPriority,
  PriorityFactor,
  Resource,
  Severity,
} from "./types";

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

export interface PriorityWeights {
  /** Raw weight by severity, before credibility and decay. */
  severity: Record<Severity, number>;
  /** How much a signal is trusted based on declared confidence. */
  confidence: Record<Confidence, number>;
  /** Extra penalty if signal is unverified (`confirmed === null`). */
  unverified: Record<Confidence, number>;
  /** Damping when stacking signals in same zone: n-th weight counts 1/(1+d*n). */
  stackingDamping: number;
  /** Cap on total signal pressure for a zone. */
  signalCap: number;
  /** Half-life in minutes of a signal, by severity. */
  halfLifeMinutes: Record<Severity, number>;
  /** Decay floor for confirmed signal: never completely forgotten. */
  decayFloorConfirmed: number;
  /** Decay floor for unverified signal. */
  decayFloorUnverified: number;
  /** Logarithmic gain from repetitions (`occurrences`). */
  occurrenceBoost: number;
  /** Cap on multiplier from repetitions. */
  occurrenceCap: number;
  populationDivisor: number;
  populationCap: number;
  /** Weight of structural need, not born from a live signal. */
  baseNeedWeight: number;
  /** Weight of need born from live signal (already counted as signal). */
  signalNeedWeight: number;
  signalNeedCap: number;
  needCap: number;
  resourceGapWeight: number;
  resourceGapCap: number;
  /** Relief provided by successfully completed action, newly finished. */
  reliefPerAction: number;
  /** Half-life of relief: resolving something half an hour ago relieves less now. */
  reliefHalfLifeMinutes: number;
  reliefDamping: number;
  /** Relief can never erase more than this fraction of zone pressure. */
  reliefShareCap: number;
}

export const defaultPriorityWeights: PriorityWeights = {
  severity: { low: 8, medium: 28, high: 70, critical: 160 },
  confidence: { low: 0.4, medium: 0.75, high: 1 },
  unverified: { low: 0.3, medium: 0.6, high: 0.85 },
  stackingDamping: 0.75,
  signalCap: 200,
  halfLifeMinutes: { low: 6, medium: 12, high: 25, critical: 45 },
  decayFloorConfirmed: 0.3,
  decayFloorUnverified: 0.05,
  occurrenceBoost: 0.4,
  occurrenceCap: 1.8,
  populationDivisor: 120,
  populationCap: 30,
  baseNeedWeight: 6,
  signalNeedWeight: 2,
  signalNeedCap: 8,
  needCap: 28,
  resourceGapWeight: 14,
  resourceGapCap: 42,
  reliefPerAction: 20,
  reliefHalfLifeMinutes: 20,
  reliefDamping: 0.5,
  reliefShareCap: 0.5,
};

export interface PriorityOptions {
  /** Reference timestamp for decay. Defaults to now. */
  now?: number | string | Date;
  /** Learned or test weights. Each key overrides default. */
  weights?: Partial<PriorityWeights>;
}

function resolveWeights(options?: PriorityOptions): PriorityWeights {
  if (!options?.weights) return defaultPriorityWeights;
  return { ...defaultPriorityWeights, ...options.weights };
}

function resolveNow(options?: PriorityOptions): number {
  const raw = options?.now;
  if (raw === undefined) return Date.now();
  if (typeof raw === "number") return raw;
  const parsed = raw instanceof Date ? raw.getTime() : Date.parse(raw);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function buildDedupeKey(event: Pick<CrisisEvent, "zoneId" | "category" | "severity">) {
  return `${event.zoneId}:${event.category.toLowerCase()}:${event.severity}`;
}

/** Age in minutes, never negative. Unparseable timestamp counts as recent. */
function ageInMinutes(iso: string | null | undefined, now: number) {
  if (!iso) return 0;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, (now - at) / 60000);
}

/**
 * Sum with diminishing returns: sorted descending, n-th value counts
 * 1/(1 + damping*n). Thus eight weak signals are not worth eight times
 * one weak signal, but the strongest always counts fully.
 */
function dampedSum(values: number[], damping: number, cap: number) {
  const total = [...values]
    .sort((a, b) => b - a)
    .reduce((acc, value, index) => acc + value / (1 + damping * index), 0);
  return Math.min(cap, total);
}

// ---------------------------------------------------------------------------
// Signal weight
// ---------------------------------------------------------------------------

/** How much signal is believed: declared confidence, penalized if unverified. */
export function credibilityFactor(event: CrisisEvent, options?: PriorityOptions) {
  const weights = resolveWeights(options);
  const base = weights.confidence[event.confidence] ?? weights.confidence.medium;
  if (event.confirmed === true) return base;
  return base * (weights.unverified[event.confidence] ?? weights.unverified.medium);
}

/** Five identical reports are more credible than one, but not five times more. */
export function occurrenceFactor(occurrences: number, options?: PriorityOptions) {
  const weights = resolveWeights(options);
  const count = Math.max(1, Math.floor(occurrences || 1));
  return Math.min(weights.occurrenceCap, 1 + Math.log(count) * weights.occurrenceBoost);
}

/** What was known at 12:00 is worth less at 12:20. Exponential decay by severity. */
export function decayFactor(event: CrisisEvent, options?: PriorityOptions) {
  const weights = resolveWeights(options);
  const now = resolveNow(options);
  const halfLife = weights.halfLifeMinutes[event.severity] ?? weights.halfLifeMinutes.medium;
  const floor =
    event.confirmed === true ? weights.decayFloorConfirmed : weights.decayFloorUnverified;
  const raw = Math.pow(0.5, ageInMinutes(event.createdAt, now) / Math.max(0.01, halfLife));
  return Math.min(1, Math.max(floor, raw));
}

/** Final weight of a live signal on its zone. */
export function signalWeight(event: CrisisEvent, options?: PriorityOptions) {
  const weights = resolveWeights(options);
  const severity = weights.severity[event.severity] ?? weights.severity.medium;
  return (
    severity *
    credibilityFactor(event, options) *
    occurrenceFactor(event.occurrences, options) *
    decayFactor(event, options)
  );
}

/** Signals that continue counting: those of the zone not yet discarded. */
export function liveEventsForZone(zone: CrisisZone, events: CrisisEvent[]) {
  return events.filter((event) => event.zoneId === zone.id && event.confirmed !== false);
}

// ---------------------------------------------------------------------------
// Explained score
// ---------------------------------------------------------------------------

export interface ZoneExplanation {
  score: number;
  factors: PriorityFactor[];
  reason: string;
}

const severityLabel: Record<Severity, string> = {
  low: "baja",
  medium: "media",
  high: "alta",
  critical: "crítica",
};

const confidenceLabel: Record<Confidence, string> = {
  low: "baja",
  medium: "media",
  high: "alta",
};

/**
 * Complete breakdown of a zone's score. Returned factors sum
 * exactly to `score`, so the UI can justify the decision truthfully.
 */
export function explainZone(
  zone: CrisisZone,
  events: CrisisEvent[],
  resources: Resource[],
  actions: Action[] = [],
  options?: PriorityOptions,
): ZoneExplanation {
  const weights = resolveWeights(options);
  const now = resolveNow(options);
  const live = liveEventsForZone(zone, events);

  // 1. Base risk: structural risk of the zone, without the boost that the
  //    store already applied for each live signal (recounted below, with
  //    credibility and decay).
  const appliedBySignals = live.reduce((acc, event) => acc + (event.appliedRiskDelta || 0), 0);
  const baseRisk = Math.max(0, Math.min(zone.riskScore, zone.riskScore - appliedBySignals));

  // 2. Live signals, with diminishing returns when stacked.
  const signalPressure = dampedSum(
    live.map((event) => signalWeight(event, options)),
    weights.stackingDamping,
    weights.signalCap,
  );

  // 3. Exposed population.
  const population = Math.min(
    weights.populationCap,
    zone.populationAtRisk / Math.max(1, weights.populationDivisor),
  );

  // 4. Open needs. Those born from live signals are already counted as
  //    signals: contribute minimal amount with own cap, so opening new
  //    categories does not inflate zone indefinitely.
  const signalNeeds = new Set(
    live.map((event) => event.appliedNeed).filter((need): need is string => Boolean(need)),
  );
  const structuralNeedCount = zone.needs.filter((need) => !signalNeeds.has(need)).length;
  const signalNeedCount = zone.needs.length - structuralNeedCount;
  const needScore = Math.min(
    weights.needCap,
    structuralNeedCount * weights.baseNeedWeight +
      Math.min(weights.signalNeedCap, signalNeedCount * weights.signalNeedWeight),
  );

  // 5. Downed resources in the zone: less capacity, more pressure.
  const downResources = resources.filter(
    (resource) => resource.zoneId === zone.id && resource.status === "unavailable",
  ).length;
  const resourceGap = Math.min(weights.resourceGapCap, downResources * weights.resourceGapWeight);

  // 6. Relief: if the system resolved something here, pressure drops. Relief
  //    also decays, because a zone attended to half an hour ago may have
  //    degraded again.
  const resolved = actions.filter(
    (action) => action.zoneId === zone.id && action.status === "succeeded",
  );
  const rawRelief = dampedSum(
    resolved.map((action) => {
      const at = action.completedAt ?? action.updatedAt;
      const decay = Math.pow(
        0.5,
        ageInMinutes(at, now) / Math.max(0.01, weights.reliefHalfLifeMinutes),
      );
      return weights.reliefPerAction * Math.min(1, Math.max(0, decay));
    }),
    weights.reliefDamping,
    Number.POSITIVE_INFINITY,
  );

  const pressure = baseRisk + signalPressure + population + needScore + resourceGap;
  const relief = Math.min(rawRelief, pressure * weights.reliefShareCap);

  // Rounded factor by factor and score is their sum, so breakdown matches
  // number seen by operators.
  const roundedBase = Math.round(baseRisk);
  const roundedSignals = Math.round(signalPressure);
  const roundedPopulation = Math.round(population);
  const roundedNeeds = Math.round(needScore);
  const roundedGap = Math.round(resourceGap);
  const positive = roundedBase + roundedSignals + roundedPopulation + roundedNeeds + roundedGap;

  let roundedRelief = Math.round(relief);
  // A resolved action must always be noticeable, even if its relief rounds to zero.
  if (resolved.length > 0 && roundedRelief === 0 && positive > 0) roundedRelief = 1;
  roundedRelief = Math.min(roundedRelief, positive);

  const factors: PriorityFactor[] = [
    { label: "Riesgo base", value: roundedBase },
    { label: "Señales vivas", value: roundedSignals },
    { label: "Población en riesgo", value: roundedPopulation },
    { label: "Necesidades abiertas", value: roundedNeeds },
  ];
  if (roundedGap !== 0) factors.push({ label: "Recursos caídos", value: roundedGap });
  if (roundedRelief !== 0) {
    factors.push({ label: "Alivio por acciones completadas", value: -roundedRelief });
  }

  const score = positive - roundedRelief;

  return {
    score,
    factors,
    reason: buildReason(zone, live, resolved.length, downResources, options),
  };
}

/** Short, honest statement of why this zone scores as it does. */
function buildReason(
  zone: CrisisZone,
  live: CrisisEvent[],
  resolvedCount: number,
  downResources: number,
  options?: PriorityOptions,
) {
  const strongest = [...live].sort((a, b) => {
    const diff = signalWeight(b, options) - signalWeight(a, options);
    if (diff !== 0) return diff;
    const byDate = b.createdAt.localeCompare(a.createdAt);
    return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
  })[0];

  const parts: string[] = [];

  if (strongest) {
    const verification = strongest.confirmed === true ? "confirmada" : "sin verificar";
    const repeated = strongest.occurrences > 1 ? `, repetida ${strongest.occurrences} veces` : "";
    const weight = Math.round(signalWeight(strongest, options));
    parts.push(
      `Señal de ${strongest.category} con gravedad ${severityLabel[strongest.severity]}, confianza ${confidenceLabel[strongest.confidence]}, ${verification}${repeated} (aporta ${weight} puntos ya descontada su antigüedad)`,
    );
  } else {
    parts.push("Sin señales vivas");
  }

  parts.push(`${zone.populationAtRisk} personas en riesgo`);
  parts.push(`${zone.needs.length} necesidades abiertas`);
  if (downResources > 0) parts.push(`${downResources} recursos fuera de servicio`);
  if (resolvedCount > 0) {
    parts.push(
      resolvedCount === 1
        ? "1 acción completada con éxito ya alivia la zona"
        : `${resolvedCount} acciones completadas con éxito ya alivian la zona`,
    );
  }

  return `${parts.join("; ")}.`;
}

/**
 * Zone score. `actions` and `options` are optional for callers
 * needing a quick estimate without action history.
 */
export function scoreZone(
  zone: CrisisZone,
  events: CrisisEvent[],
  resources: Resource[],
  actions: Action[] = [],
  options?: PriorityOptions,
) {
  return explainZone(zone, events, resources, actions, options).score;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * Builds complete plan. `changes` and `trigger` are overwritten by store
 * immediately after, so default values are returned here.
 */
export function buildPlan(
  version: number,
  zones: CrisisZone[],
  events: CrisisEvent[],
  resources: Resource[],
  actions: Action[],
  invalidatedActionIds: string[] = [],
  options?: PriorityOptions,
): Plan {
  const priorities: PlanPriority[] = zones
    .map((zone) => {
      const explanation = explainZone(zone, events, resources, actions, options);
      return {
        zoneId: zone.id,
        score: explanation.score,
        factors: explanation.factors,
        reason: explanation.reason,
      };
    })
    // Ties resolved by identifier: ordering never depends on chance or arrival order.
    .sort((a, b) => b.score - a.score || a.zoneId.localeCompare(b.zoneId));

  const topPriority = priorities[0];
  const topZone = zones.find((zone) => zone.id === topPriority?.zoneId);
  const openActionIds = actions
    .filter((action) =>
      ["pending", "approved", "running", "blocked", "failed"].includes(action.status),
    )
    .map((action) => action.id);

  return {
    id: `plan-${version}`,
    version,
    previousVersion: version > 1 ? version - 1 : null,
    generatedAt: new Date(resolveNow(options)).toISOString(),
    summary: topZone
      ? `${topZone.name} es la prioridad actual con puntuación ${topPriority.score}. ${topPriority.reason}`
      : "No hay zonas activas que requieran acción.",
    priorities,
    proposedActionIds: openActionIds,
    invalidatedActionIds,
    changes: [],
    trigger: "replanificación",
  };
}
