// PROPIETARIO: agente del motor de prioridad.
//
// Motor de prioridad del centro de mando. Decide qué zona se atiende primero
// cuando la información es parcial, contradictoria y envejece deprisa.
//
// La puntuación de una zona es una suma de factores explicables:
//
//   puntuación = riesgo base
//              + señales vivas (con credibilidad, repetición y decaimiento)
//              + población en riesgo
//              + necesidades abiertas
//              + recursos caídos
//              - alivio por acciones completadas con éxito
//
// Cuatro ideas sostienen el diseño:
//
//  1. El ruido no puede ganar a la señal. Muchas señales flojas, sin verificar
//     y de baja confianza suman con rendimientos decrecientes y casi no mueven
//     la aguja; una sola señal crítica confirmada sí.
//  2. Lo que sabías hace media hora ya no vale igual. Cada señal decae con la
//     edad, con vida media según su gravedad.
//  3. Resolver algo baja la presión. Las acciones completadas con éxito restan
//     puntuación a su zona, así que el ranking puede bajar y no solo subir.
//  4. Todo se explica. El desglose que devolvemos suma exactamente la
//     puntuación, para poder justificar cada decisión ante un humano.
//
// Nota sobre doble contabilidad: el store ya aplica el efecto de cada señal
// sobre `zone.riskScore` y `zone.needs`. Aquí deshacemos ese efecto (restando
// `appliedRiskDelta` y descontando las necesidades nacidas de señales vivas)
// para volver a contarlo con nuestras propias reglas de credibilidad y
// decaimiento. Sin esto, una señal cuenta dos veces y nunca envejece.

import type {
  Action,
  Confidence,
  CrisisEvent,
  CrisisZone,
  Plan,
  PlanPriority,
  PriorityFactor,
  Resource,
  Severity
} from "./types";

// ---------------------------------------------------------------------------
// Pesos
// ---------------------------------------------------------------------------

export interface PriorityWeights {
  /** Peso bruto por gravedad, antes de credibilidad y decaimiento. */
  severity: Record<Severity, number>;
  /** Cuánto creemos a una señal según su confianza declarada. */
  confidence: Record<Confidence, number>;
  /** Castigo extra si la señal no está verificada (`confirmed === null`). */
  unverified: Record<Confidence, number>;
  /** Amortiguación al apilar señales en la misma zona: el enésimo peso vale 1/(1+d*n). */
  stackingDamping: number;
  /** Techo de la presión total por señales de una zona. */
  signalCap: number;
  /** Vida media en minutos de una señal, por gravedad. */
  halfLifeMinutes: Record<Severity, number>;
  /** Suelo de decaimiento de una señal confirmada: nunca se olvida del todo. */
  decayFloorConfirmed: number;
  /** Suelo de decaimiento de una señal sin verificar. */
  decayFloorUnverified: number;
  /** Ganancia logarítmica por repeticiones (`occurrences`). */
  occurrenceBoost: number;
  /** Techo del multiplicador por repeticiones. */
  occurrenceCap: number;
  populationDivisor: number;
  populationCap: number;
  /** Peso de una necesidad estructural, no nacida de una señal viva. */
  baseNeedWeight: number;
  /** Peso de una necesidad que nació de una señal viva (ya contada como señal). */
  signalNeedWeight: number;
  signalNeedCap: number;
  needCap: number;
  resourceGapWeight: number;
  resourceGapCap: number;
  /** Alivio que aporta una acción completada con éxito, recién terminada. */
  reliefPerAction: number;
  /** Vida media del alivio: resolver algo hace media hora ya calma menos. */
  reliefHalfLifeMinutes: number;
  reliefDamping: number;
  /** El alivio nunca puede borrar más de esta fracción de la presión de la zona. */
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
  reliefShareCap: 0.5
};

export interface PriorityOptions {
  /** Instante de referencia para el decaimiento. Por defecto, ahora. */
  now?: number | string | Date;
  /** Pesos aprendidos o de prueba. Cada clave sustituye a la de por defecto. */
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
// Utilidades
// ---------------------------------------------------------------------------

export function buildDedupeKey(event: Pick<CrisisEvent, "zoneId" | "category" | "severity">) {
  return `${event.zoneId}:${event.category.toLowerCase()}:${event.severity}`;
}

/** Antigüedad en minutos, nunca negativa. Un timestamp ilegible cuenta como reciente. */
function ageInMinutes(iso: string | null | undefined, now: number) {
  if (!iso) return 0;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, (now - at) / 60000);
}

/**
 * Suma con rendimientos decrecientes: se ordena de mayor a menor y el enésimo
 * valor cuenta 1/(1 + damping*n). Así ocho señales flojas no valen ocho veces
 * una señal floja, pero la más fuerte siempre cuenta entera.
 */
function dampedSum(values: number[], damping: number, cap: number) {
  const total = [...values]
    .sort((a, b) => b - a)
    .reduce((acc, value, index) => acc + value / (1 + damping * index), 0);
  return Math.min(cap, total);
}

// ---------------------------------------------------------------------------
// Peso de una señal
// ---------------------------------------------------------------------------

/** Cuánto nos creemos la señal: confianza declarada, castigada si no está verificada. */
export function credibilityFactor(event: CrisisEvent, options?: PriorityOptions) {
  const weights = resolveWeights(options);
  const base = weights.confidence[event.confidence] ?? weights.confidence.medium;
  if (event.confirmed === true) return base;
  return base * (weights.unverified[event.confidence] ?? weights.unverified.medium);
}

/** Cinco avisos iguales son más creíbles que uno, pero no cinco veces más. */
export function occurrenceFactor(occurrences: number, options?: PriorityOptions) {
  const weights = resolveWeights(options);
  const count = Math.max(1, Math.floor(occurrences || 1));
  return Math.min(weights.occurrenceCap, 1 + Math.log(count) * weights.occurrenceBoost);
}

/** Lo que sabías a las 12:00 ya no vale a las 12:20. Decaimiento exponencial por gravedad. */
export function decayFactor(event: CrisisEvent, options?: PriorityOptions) {
  const weights = resolveWeights(options);
  const now = resolveNow(options);
  const halfLife = weights.halfLifeMinutes[event.severity] ?? weights.halfLifeMinutes.medium;
  const floor = event.confirmed === true ? weights.decayFloorConfirmed : weights.decayFloorUnverified;
  const raw = Math.pow(0.5, ageInMinutes(event.createdAt, now) / Math.max(0.01, halfLife));
  return Math.min(1, Math.max(floor, raw));
}

/** Peso final de una señal viva sobre su zona. */
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

/** Señales que siguen contando: las de la zona que no han sido descartadas. */
export function liveEventsForZone(zone: CrisisZone, events: CrisisEvent[]) {
  return events.filter((event) => event.zoneId === zone.id && event.confirmed !== false);
}

// ---------------------------------------------------------------------------
// Puntuación explicada
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
  critical: "crítica"
};

const confidenceLabel: Record<Confidence, string> = {
  low: "baja",
  medium: "media",
  high: "alta"
};

/**
 * Desglose completo de la puntuación de una zona. Los factores devueltos suman
 * exactamente `score`, para que la UI pueda justificar la decisión sin mentir.
 */
export function explainZone(
  zone: CrisisZone,
  events: CrisisEvent[],
  resources: Resource[],
  actions: Action[] = [],
  options?: PriorityOptions
): ZoneExplanation {
  const weights = resolveWeights(options);
  const now = resolveNow(options);
  const live = liveEventsForZone(zone, events);

  // 1. Riesgo base: el riesgo estructural de la zona, sin el empujón que el
  //    store ya aplicó por cada señal viva (eso se recuenta abajo, con
  //    credibilidad y decaimiento).
  const appliedBySignals = live.reduce((acc, event) => acc + (event.appliedRiskDelta || 0), 0);
  const baseRisk = Math.max(0, Math.min(zone.riskScore, zone.riskScore - appliedBySignals));

  // 2. Señales vivas, con rendimientos decrecientes al apilarse.
  const signalPressure = dampedSum(
    live.map((event) => signalWeight(event, options)),
    weights.stackingDamping,
    weights.signalCap
  );

  // 3. Población expuesta.
  const population = Math.min(
    weights.populationCap,
    zone.populationAtRisk / Math.max(1, weights.populationDivisor)
  );

  // 4. Necesidades abiertas. Las que nacieron de una señal viva ya están
  //    contadas como señal: aportan una miseria y con techo propio, para que
  //    abrir categorías nuevas no infle la zona a perpetuidad.
  const signalNeeds = new Set(
    live.map((event) => event.appliedNeed).filter((need): need is string => Boolean(need))
  );
  const structuralNeedCount = zone.needs.filter((need) => !signalNeeds.has(need)).length;
  const signalNeedCount = zone.needs.length - structuralNeedCount;
  const needScore = Math.min(
    weights.needCap,
    structuralNeedCount * weights.baseNeedWeight +
      Math.min(weights.signalNeedCap, signalNeedCount * weights.signalNeedWeight)
  );

  // 5. Recursos caídos en la zona: menos capacidad, más presión.
  const downResources = resources.filter(
    (resource) => resource.zoneId === zone.id && resource.status === "unavailable"
  ).length;
  const resourceGap = Math.min(weights.resourceGapCap, downResources * weights.resourceGapWeight);

  // 6. Alivio: si el sistema resolvió algo aquí, la presión baja. El alivio
  //    también caduca, porque una zona atendida hace media hora puede haberse
  //    vuelto a degradar.
  const resolved = actions.filter((action) => action.zoneId === zone.id && action.status === "succeeded");
  const rawRelief = dampedSum(
    resolved.map((action) => {
      const at = action.completedAt ?? action.updatedAt;
      const decay = Math.pow(0.5, ageInMinutes(at, now) / Math.max(0.01, weights.reliefHalfLifeMinutes));
      return weights.reliefPerAction * Math.min(1, Math.max(0, decay));
    }),
    weights.reliefDamping,
    Number.POSITIVE_INFINITY
  );

  const pressure = baseRisk + signalPressure + population + needScore + resourceGap;
  const relief = Math.min(rawRelief, pressure * weights.reliefShareCap);

  // Redondeamos factor a factor y la puntuación es su suma, para que el
  // desglose cuadre al punto con el número que ve el jurado.
  const roundedBase = Math.round(baseRisk);
  const roundedSignals = Math.round(signalPressure);
  const roundedPopulation = Math.round(population);
  const roundedNeeds = Math.round(needScore);
  const roundedGap = Math.round(resourceGap);
  const positive = roundedBase + roundedSignals + roundedPopulation + roundedNeeds + roundedGap;

  let roundedRelief = Math.round(relief);
  // Una acción resuelta siempre tiene que notarse, aunque su alivio redondee a cero.
  if (resolved.length > 0 && roundedRelief === 0 && positive > 0) roundedRelief = 1;
  roundedRelief = Math.min(roundedRelief, positive);

  const factors: PriorityFactor[] = [
    { label: "Riesgo base", value: roundedBase },
    { label: "Señales vivas", value: roundedSignals },
    { label: "Población en riesgo", value: roundedPopulation },
    { label: "Necesidades abiertas", value: roundedNeeds }
  ];
  if (roundedGap !== 0) factors.push({ label: "Recursos caídos", value: roundedGap });
  if (roundedRelief !== 0) {
    factors.push({ label: "Alivio por acciones completadas", value: -roundedRelief });
  }

  const score = positive - roundedRelief;

  return { score, factors, reason: buildReason(zone, live, resolved.length, downResources, options) };
}

/** Frase corta y honesta de por qué esta zona puntúa lo que puntúa. */
function buildReason(
  zone: CrisisZone,
  live: CrisisEvent[],
  resolvedCount: number,
  downResources: number,
  options?: PriorityOptions
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
      `Señal de ${strongest.category} con gravedad ${severityLabel[strongest.severity]}, confianza ${confidenceLabel[strongest.confidence]}, ${verification}${repeated} (aporta ${weight} puntos ya descontada su antigüedad)`
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
        : `${resolvedCount} acciones completadas con éxito ya alivian la zona`
    );
  }

  return `${parts.join("; ")}.`;
}

/**
 * Puntuación de una zona. `actions` y `options` son opcionales para no romper
 * a quien solo quiera una estimación rápida sin historial de acciones.
 */
export function scoreZone(
  zone: CrisisZone,
  events: CrisisEvent[],
  resources: Resource[],
  actions: Action[] = [],
  options?: PriorityOptions
) {
  return explainZone(zone, events, resources, actions, options).score;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * Construye el plan completo. `changes` y `trigger` los reescribe el store
 * justo después, así que aquí devolvemos valores por defecto.
 */
export function buildPlan(
  version: number,
  zones: CrisisZone[],
  events: CrisisEvent[],
  resources: Resource[],
  actions: Action[],
  invalidatedActionIds: string[] = [],
  options?: PriorityOptions
): Plan {
  const priorities: PlanPriority[] = zones
    .map((zone) => {
      const explanation = explainZone(zone, events, resources, actions, options);
      return {
        zoneId: zone.id,
        score: explanation.score,
        factors: explanation.factors,
        reason: explanation.reason
      };
    })
    // Empates resueltos por identificador: el orden nunca depende del azar ni
    // del orden de llegada.
    .sort((a, b) => b.score - a.score || a.zoneId.localeCompare(b.zoneId));

  const topPriority = priorities[0];
  const topZone = zones.find((zone) => zone.id === topPriority?.zoneId);
  const openActionIds = actions
    .filter((action) => ["pending", "approved", "running", "blocked", "failed"].includes(action.status))
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
    trigger: "replanificación"
  };
}
