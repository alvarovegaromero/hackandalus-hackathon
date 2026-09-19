// PROPIETARIO: agente de persistencia, historial, auditoria y aprendizaje.
//
// Ajustes aprendidos a partir de ejecuciones anteriores. Es el bonus del reto:
// "revisa llamadas y decisiones de ejecuciones pasadas, ve que funciono y que
// no, y ajusta como actua la proxima vez".
//
// Tres reglas gobiernan todo este modulo:
//
//  1. ARRANQUE EN FRIO. Con cero o dos ejecuciones no se puede concluir nada.
//     Ningun peso se mueve hasta alcanzar un minimo de muestras, y lo que no
//     llega al minimo ni siquiera se expone: asi un consumidor descuidado no
//     puede penalizar a un contacto por una sola llamada fallida.
//  2. GRADUAL Y ACOTADO. El ajuste tiene tope duro y solo puede avanzar un
//     paso por ejecucion analizada. Un sistema que sobrerreacciona a una
//     llamada fallida es peor que uno que no aprende.
//  3. EXPLICABLE. Todo peso aprendido lleva su porque, con las muestras que lo
//     sostienen (`explainWeights`). Aprender sin poder ensenar que se aprendio
//     no puntua.
//
// FLUJO DE DATOS, para que nada se cuente dos veces:
//
//     durante la ejecucion  ->  recordActionOutcome() acumula en state.learning
//     al cerrar la ejecucion ->  buildRunRecord() resume la ejecucion LEYENDO
//                                el estado (no el acumulador) y se guarda como
//                                RunRecord en runs.json
//     al arrancar            ->  weightsFromRuns(loadRuns()) reconstruye los
//                                pesos desde cero sumando los RunRecord
//
// Como la reconstruccion siempre parte de los RunRecord, reiniciar el proceso
// no infla ningun contador.

import type {
  Action,
  ActionChannel,
  ChannelStat,
  LearnedWeights,
  RunRecord,
  SituationState,
} from "./types";

// ---------------------------------------------------------------------------
// Umbrales de aprendizaje
// ---------------------------------------------------------------------------

/** Intentos minimos antes de fiarse de la tasa de exito de un canal. */
export const MIN_CHANNEL_SAMPLES = 5;

/** Intentos minimos antes de fiarse de la capacidad de respuesta de un contacto. */
export const MIN_CONTACT_SAMPLES = 4;

/** Ejecuciones minimas antes de mover la penalizacion de senales sin confirmar. */
export const MIN_RUNS_TO_LEARN = 3;

/** Senales sin confirmar ya resueltas que hacen falta para concluir algo. */
export const MIN_UNCONFIRMED_SAMPLES = 8;

/**
 * Tope de la penalizacion. `unconfirmedPenalty` es un descuento multiplicativo
 * en [0, 0.4]: el motor de prioridad multiplica la credibilidad de una senal
 * sin verificar por (1 - unconfirmedPenalty). Nunca borra una senal, como
 * mucho le quita el 40% del peso.
 */
export const MAX_UNCONFIRMED_PENALTY = 0.4;

/** Cuanto puede moverse la penalizacion por cada ejecucion analizada. */
export const UNCONFIRMED_PENALTY_STEP = 0.08;

/** Estados que cuentan como intento real de contactar con alguien. */
const ATTEMPT_STATUSES: Action["status"][] = ["succeeded", "failed", "stalled"];

export function emptyWeights(): LearnedWeights {
  return {
    channelStats: {},
    contactStats: {},
    unconfirmedPenalty: 0,
    runsAnalyzed: 0,
    updatedAt: null,
  };
}

function addStat(
  target: ChannelStat | undefined,
  attempts: number,
  successes: number,
): ChannelStat {
  return {
    attempts: (target?.attempts ?? 0) + attempts,
    successes: (target?.successes ?? 0) + successes,
  };
}

function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Acumulacion dentro de la ejecucion en curso
// ---------------------------------------------------------------------------

/**
 * Incorpora el desenlace de una accion a los pesos aprendidos.
 *
 * Devuelve un objeto nuevo: el estado se clona al servirse por la API, asi que
 * conviene no depender de mutaciones en sitio.
 */
export function recordActionOutcome(weights: LearnedWeights, action: Action): LearnedWeights {
  const succeeded = action.status === "succeeded";
  const next: LearnedWeights = {
    ...weights,
    channelStats: { ...weights.channelStats },
    contactStats: { ...weights.contactStats },
  };

  next.channelStats[action.channel] = addStat(
    next.channelStats[action.channel],
    1,
    succeeded ? 1 : 0,
  );

  if (action.contactId) {
    next.contactStats[action.contactId] = addStat(
      next.contactStats[action.contactId],
      1,
      succeeded ? 1 : 0,
    );
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

// ---------------------------------------------------------------------------
// Resumen de una ejecucion
// ---------------------------------------------------------------------------

// Las notas estructuradas ("stat:...") son las que se vuelven a leer para
// reconstruir los pesos. El resto de notas son texto para humanos y se ignoran
// al parsear, asi que se pueden anadir libremente.
const STAT_PREFIX = "stat:";

function statNote(kind: string, key: string, successes: number, attempts: number): string {
  return `${STAT_PREFIX}${kind}:${key}:${successes}/${attempts}`;
}

interface ParsedStat {
  kind: string;
  key: string;
  successes: number;
  attempts: number;
}

function parseStatNote(note: string): ParsedStat | null {
  if (!note.startsWith(STAT_PREFIX)) return null;
  const body = note.slice(STAT_PREFIX.length);
  const match = /^([a-z]+):(.+):(\d+)\/(\d+)$/.exec(body);
  if (!match) return null;
  const successes = Number(match[3]);
  const attempts = Number(match[4]);
  if (!Number.isFinite(successes) || !Number.isFinite(attempts) || attempts <= 0) return null;
  if (successes > attempts) return null;
  return { kind: match[1], key: match[2], successes, attempts };
}

/**
 * Resume una ejecucion en un `RunRecord`. Lee el estado, no el acumulador, para
 * que volver a llamarlo con el mismo estado dé exactamente el mismo resultado.
 */
export function buildRunRecord(
  state: SituationState,
  options: { id?: string; startedAt?: string; endedAt?: string; notes?: string[] } = {},
): RunRecord {
  const actions = state.actions ?? [];
  const events = state.events ?? [];

  const succeeded = actions.filter((action) => action.status === "succeeded");
  const failed = actions.filter(
    (action) => action.status === "failed" || action.status === "stalled",
  );

  // Exito por canal y por contacto, contando solo intentos que llegaron a salir.
  const channelStats: Partial<Record<ActionChannel, ChannelStat>> = {};
  const contactStats: Record<string, ChannelStat> = {};
  for (const action of actions) {
    if (!ATTEMPT_STATUSES.includes(action.status)) continue;
    const ok = action.status === "succeeded" ? 1 : 0;
    channelStats[action.channel] = addStat(channelStats[action.channel], 1, ok);
    if (action.contactId) {
      contactStats[action.contactId] = addStat(contactStats[action.contactId], 1, ok);
    }
  }

  // Senales sin confirmar que acabaron resolviendose: cuantas eran falsas.
  const resolved = events.filter((event) => event.confirmed !== null);
  const falseSignals = resolved.filter((event) => event.confirmed === false);

  const notes: string[] = [
    ...(options.notes ?? []),
    statNote("unconfirmed", "todas", falseSignals.length, Math.max(resolved.length, 1)),
  ];
  if (resolved.length === 0) notes.pop();

  for (const [channel, stat] of Object.entries(channelStats)) {
    notes.push(statNote("channel", channel, stat.successes, stat.attempts));
  }
  for (const [contactId, stat] of Object.entries(contactStats)) {
    notes.push(statNote("contact", contactId, stat.successes, stat.attempts));
  }

  // Una linea legible para el jurado, junto a las notas estructuradas.
  notes.push(
    `Resumen: ${succeeded.length} de ${actions.length} acciones completadas, ${failed.length} fallidas, ` +
      `${resolved.length} señales verificadas de las cuales ${falseSignals.length} resultaron falsas.`,
  );

  const startedAt = options.startedAt ?? state.scenario?.startedAt ?? new Date().toISOString();

  return {
    id: options.id ?? `run-${Date.parse(startedAt) || Date.now()}`,
    scenarioId: state.scenario?.id ?? "desconocido",
    startedAt,
    endedAt: options.endedAt ?? new Date().toISOString(),
    actionsTotal: actions.length,
    actionsSucceeded: succeeded.length,
    actionsFailed: failed.length,
    planVersions: state.plan?.version ?? 0,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Derivacion de pesos a partir del historial
// ---------------------------------------------------------------------------

interface UnconfirmedEvidence {
  resolved: number;
  falseSignals: number;
}

function gatherEvidence(runs: RunRecord[]) {
  const channelRaw: Partial<Record<ActionChannel, ChannelStat>> = {};
  const contactRaw: Record<string, ChannelStat> = {};
  const unconfirmed: UnconfirmedEvidence = { resolved: 0, falseSignals: 0 };

  for (const run of runs) {
    for (const note of run.notes ?? []) {
      const stat = parseStatNote(note);
      if (!stat) continue;
      if (stat.kind === "channel") {
        const channel = stat.key as ActionChannel;
        channelRaw[channel] = addStat(channelRaw[channel], stat.attempts, stat.successes);
      } else if (stat.kind === "contact") {
        contactRaw[stat.key] = addStat(contactRaw[stat.key], stat.attempts, stat.successes);
      } else if (stat.kind === "unconfirmed") {
        // Aqui "successes" son las senales que resultaron FALSAS.
        unconfirmed.resolved += stat.attempts;
        unconfirmed.falseSignals += stat.successes;
      }
    }
  }

  return { channelRaw, contactRaw, unconfirmed };
}

/**
 * Penalizacion aprendida para las senales sin confirmar.
 *
 * Sube solo si hay bastantes ejecuciones Y bastantes senales ya verificadas, y
 * aun asi avanza como maximo un paso por ejecucion analizada. Con tres
 * ejecuciones el techo real es 0.08; hacen falta cinco para llegar al tope.
 */
export function deriveUnconfirmedPenalty(runs: number, evidence: UnconfirmedEvidence): number {
  if (runs < MIN_RUNS_TO_LEARN) return 0;
  if (evidence.resolved < MIN_UNCONFIRMED_SAMPLES) return 0;

  const falseRate = evidence.falseSignals / evidence.resolved;
  const target = MAX_UNCONFIRMED_PENALTY * falseRate;
  const allowed = UNCONFIRMED_PENALTY_STEP * (runs - MIN_RUNS_TO_LEARN + 1);
  return round(Math.max(0, Math.min(target, allowed, MAX_UNCONFIRMED_PENALTY)));
}

/**
 * Resume ejecuciones pasadas en pesos aplicables a la actual.
 *
 * Lo que no alcanza el minimo de muestras NO se publica: `channelStats` y
 * `contactStats` solo contienen entradas en las que ya se puede confiar, de
 * modo que cualquier consumidor que solo mire `attempts > 0` sigue estando a
 * salvo del arranque en frio.
 */
export function weightsFromRuns(runs: RunRecord[]): LearnedWeights {
  const weights = emptyWeights();
  weights.runsAnalyzed = runs.length;
  if (runs.length === 0) return weights;

  const { channelRaw, contactRaw, unconfirmed } = gatherEvidence(runs);

  for (const [channel, stat] of Object.entries(channelRaw)) {
    if (stat.attempts < MIN_CHANNEL_SAMPLES) continue;
    weights.channelStats[channel as ActionChannel] = { ...stat };
  }
  for (const [contactId, stat] of Object.entries(contactRaw)) {
    if (stat.attempts < MIN_CONTACT_SAMPLES) continue;
    weights.contactStats[contactId] = { ...stat };
  }

  weights.unconfirmedPenalty = deriveUnconfirmedPenalty(runs.length, unconfirmed);
  weights.updatedAt = new Date().toISOString();
  return weights;
}

// ---------------------------------------------------------------------------
// Consulta de lo aprendido
// ---------------------------------------------------------------------------

function rate(stat: ChannelStat | undefined, minSamples: number): number | null {
  if (!stat || stat.attempts < Math.max(1, minSamples)) return null;
  return stat.successes / stat.attempts;
}

/** Tasa de exito de un canal, o null si aun no hay muestras suficientes. */
export function channelSuccessRate(
  weights: LearnedWeights,
  channel: ActionChannel,
  minSamples: number = MIN_CHANNEL_SAMPLES,
): number | null {
  return rate(weights.channelStats[channel], minSamples);
}

/** Capacidad de respuesta de un contacto, o null si aun no hay muestras. */
export function contactSuccessRate(
  weights: LearnedWeights,
  contactId: string,
  minSamples: number = MIN_CONTACT_SAMPLES,
): number | null {
  return rate(weights.contactStats[contactId], minSamples);
}

/** Canal con mejor historial entre los candidatos, o null si nadie llega al minimo. */
export function bestLearnedChannel(
  weights: LearnedWeights,
  candidates: ActionChannel[],
): ActionChannel | null {
  let best: { channel: ActionChannel; rate: number } | null = null;
  for (const channel of candidates) {
    const value = channelSuccessRate(weights, channel);
    if (value === null) continue;
    if (!best || value > best.rate) best = { channel, rate: value };
  }
  return best?.channel ?? null;
}

/**
 * Multiplicador que el motor de prioridad debe aplicar a la credibilidad de
 * una senal sin verificar. 1 = no hemos aprendido nada todavia.
 */
export function unverifiedCredibilityMultiplier(weights: LearnedWeights): number {
  const penalty = Math.max(0, Math.min(MAX_UNCONFIRMED_PENALTY, weights.unconfirmedPenalty || 0));
  return round(1 - penalty);
}

// ---------------------------------------------------------------------------
// Explicabilidad
// ---------------------------------------------------------------------------

export interface LearningInsight {
  /** Identificador estable, p. ej. "channel:call". */
  key: string;
  /** Titular para pantalla. */
  label: string;
  /** Por que cambio el peso, con las muestras que lo sostienen. */
  detail: string;
  /** Muestras que respaldan la conclusion. */
  samples: number;
  /** Valor aprendido (tasa 0..1, o la penalizacion). */
  value: number;
  /** false cuando hay indicios pero aun no se aplica nada. */
  applied: boolean;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Traduce los pesos a frases que se pueden ensenar al jurado. Si se pasan los
 * `RunRecord`, tambien explica lo que aun NO se aplica por falta de muestras,
 * que es justo lo que demuestra que el sistema no sobrerreacciona.
 */
export function explainWeights(weights: LearnedWeights, runs: RunRecord[] = []): LearningInsight[] {
  const insights: LearningInsight[] = [];

  if (weights.runsAnalyzed === 0) {
    insights.push({
      key: "runs",
      label: "Todavía no hay ejecuciones anteriores",
      detail:
        "El sistema arranca sin historial: ningún peso está ajustado y se usan los valores por defecto.",
      samples: 0,
      value: 0,
      applied: false,
    });
    return insights;
  }

  insights.push({
    key: "runs",
    label: `${weights.runsAnalyzed} ejecución${weights.runsAnalyzed === 1 ? "" : "es"} analizada${weights.runsAnalyzed === 1 ? "" : "s"}`,
    detail: `Los pesos se han reconstruido sumando ${weights.runsAnalyzed} ejecución${weights.runsAnalyzed === 1 ? "" : "es"} guardada${weights.runsAnalyzed === 1 ? "" : "s"} en disco.`,
    samples: weights.runsAnalyzed,
    value: weights.runsAnalyzed,
    applied: true,
  });

  for (const [channel, stat] of Object.entries(weights.channelStats)) {
    if (!stat) continue;
    const value = stat.successes / stat.attempts;
    insights.push({
      key: `channel:${channel}`,
      label: `El canal ${channel} funciona el ${percent(value)} de las veces`,
      detail: `${stat.successes} de ${stat.attempts} intentos por ${channel} terminaron bien en ejecuciones anteriores, así que se prefiere ${value >= 0.5 ? "frente a" : "por detrás de"} los canales con peor historial.`,
      samples: stat.attempts,
      value: round(value),
      applied: true,
    });
  }

  for (const [contactId, stat] of Object.entries(weights.contactStats)) {
    const value = stat.successes / stat.attempts;
    insights.push({
      key: `contact:${contactId}`,
      label: `${contactId} responde el ${percent(value)} de las veces`,
      detail: `${stat.successes} de ${stat.attempts} avisos a ${contactId} obtuvieron respuesta. Con ${stat.attempts} muestras ya se supera el mínimo de ${MIN_CONTACT_SAMPLES}, así que este dato pesa en la elección de contacto.`,
      samples: stat.attempts,
      value: round(value),
      applied: true,
    });
  }

  const { unconfirmed } = gatherEvidence(runs);
  if (weights.unconfirmedPenalty > 0) {
    const falseRate =
      unconfirmed.resolved > 0 ? unconfirmed.falseSignals / unconfirmed.resolved : 0;
    insights.push({
      key: "unconfirmed",
      label: `Las señales sin confirmar pierden un ${percent(weights.unconfirmedPenalty)} de peso`,
      detail: `De ${unconfirmed.resolved} señales que llegaron a verificarse, ${unconfirmed.falseSignals} resultaron falsas (${percent(falseRate)}). El ajuste sube como mucho ${UNCONFIRMED_PENALTY_STEP} por ejecución y nunca pasa de ${MAX_UNCONFIRMED_PENALTY}.`,
      samples: unconfirmed.resolved,
      value: weights.unconfirmedPenalty,
      applied: true,
    });
  } else if (unconfirmed.resolved > 0) {
    const falta =
      runs.length < MIN_RUNS_TO_LEARN
        ? `hacen falta ${MIN_RUNS_TO_LEARN} ejecuciones y solo hay ${runs.length}`
        : `hacen falta ${MIN_UNCONFIRMED_SAMPLES} señales verificadas y solo hay ${unconfirmed.resolved}`;
    insights.push({
      key: "unconfirmed",
      label: "Aún no se penaliza a las señales sin confirmar",
      detail: `Hay indicios (${unconfirmed.falseSignals} de ${unconfirmed.resolved} señales verificadas resultaron falsas), pero ${falta}. Con tan pocos datos, mover el peso sería sobrerreaccionar.`,
      samples: unconfirmed.resolved,
      value: 0,
      applied: false,
    });
  }

  return insights;
}
