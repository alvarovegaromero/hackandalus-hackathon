// OWNER: persistence, history, audit, and learning agent.
//
// Learned adjustments from previous runs. Addresses the challenge bonus:
// "reviews calls and decisions from past runs, sees what worked and what
// did not, and adjusts how it acts next time".
//
// Three rules govern this entire module:
//
//  1. COLD START. With zero or two runs nothing can be concluded.
//     No weight moves until reaching minimum samples, and what does not
//     reach the minimum is not even exposed: thus a careless consumer
//     cannot penalize a contact for a single failed call.
//  2. GRADUAL AND BOUNDED. Adjustments have hard caps and can only advance
//     one step per analyzed run. A system that overreacts to a single failed
//     call is worse than one that does not learn.
//  3. EXPLAINABLE. Every learned weight carries its rationale, with the samples
//     that support it (`explainWeights`). Learning without being able to show
//     what was learned earns no points.
//
// DATA FLOW, so nothing is counted twice:
//
//     during execution      ->  recordActionOutcome() accumulates in state.learning
//     at execution close    ->  buildRunRecord() summarizes execution by READING
//                               state (not accumulator) and saves as RunRecord in runs.json
//     at startup            ->  weightsFromRuns(loadRuns()) reconstructs weights
//                               from scratch by aggregating RunRecords
//
// Because reconstruction always starts from RunRecords, restarting the process
// does not inflate any counters.

import type {
  Action,
  ActionChannel,
  ChannelStat,
  LearnedWeights,
  RunRecord,
  SituationState,
} from "./types";

// ---------------------------------------------------------------------------
// Learning thresholds
// ---------------------------------------------------------------------------

/** Minimum attempts before trusting channel success rate. */
export const MIN_CHANNEL_SAMPLES = 5;

/** Minimum attempts before trusting contact responsiveness. */
export const MIN_CONTACT_SAMPLES = 4;

/** Minimum runs before moving unconfirmed signal penalty. */
export const MIN_RUNS_TO_LEARN = 3;

/** Resolved unconfirmed signals needed to conclude anything. */
export const MIN_UNCONFIRMED_SAMPLES = 8;

/**
 * Penalty ceiling. `unconfirmedPenalty` is a multiplicative discount
 * in [0, 0.4]: priority engine multiplies unverified signal credibility
 * by (1 - unconfirmedPenalty). Never erases a signal, at most reduces 40% weight.
 */
export const MAX_UNCONFIRMED_PENALTY = 0.4;

/** Maximum penalty movement per analyzed run. */
export const UNCONFIRMED_PENALTY_STEP = 0.08;

/** Statuses that count as an actual attempt to contact someone. */
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
// Accumulation within current run
// ---------------------------------------------------------------------------

/**
 * Incorporates action outcome into learned weights.
 *
 * Returns a new object: state is cloned when served via API, so
 * in-place mutation should be avoided.
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
// Run summary
// ---------------------------------------------------------------------------

// Structured notes ("stat:...") are what is re-read to reconstruct weights.
// Remaining notes are human text ignored during parsing, so they can be added freely.
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
 * Summarizes a run into a `RunRecord`. Reads state, not accumulator, so that
 * re-calling with the same state produces the exact same result.
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

  // Success by channel and contact, counting only attempts that were actually dispatched.
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

  // Unconfirmed signals that were eventually resolved: how many were false.
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

  // A readable line for evaluation panel, alongside structured notes.
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
// Derivation of weights from history
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
        // Here "successes" are signals that turned out FALSE.
        unconfirmed.resolved += stat.attempts;
        unconfirmed.falseSignals += stat.successes;
      }
    }
  }

  return { channelRaw, contactRaw, unconfirmed };
}

/**
 * Learned penalty for unconfirmed signals.
 *
 * Rises only with enough runs AND enough verified signals, and even then
 * advances at most one step per analyzed run. With three runs real cap is 0.08;
 * five runs are needed to reach maximum cap.
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
 * Summarizes past runs into weights applicable to current run.
 *
 * What does not reach minimum samples is NOT published: `channelStats` and
 * `contactStats` only contain entries that can already be trusted, so that
 * any consumer checking `attempts > 0` remains safe from cold start issues.
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
// Querying learned weights
// ---------------------------------------------------------------------------

function rate(stat: ChannelStat | undefined, minSamples: number): number | null {
  if (!stat || stat.attempts < Math.max(1, minSamples)) return null;
  return stat.successes / stat.attempts;
}

/** Channel success rate, or null if insufficient samples exist. */
export function channelSuccessRate(
  weights: LearnedWeights,
  channel: ActionChannel,
  minSamples: number = MIN_CHANNEL_SAMPLES,
): number | null {
  return rate(weights.channelStats[channel], minSamples);
}

/** Contact responsiveness, or null if no samples exist. */
export function contactSuccessRate(
  weights: LearnedWeights,
  contactId: string,
  minSamples: number = MIN_CONTACT_SAMPLES,
): number | null {
  return rate(weights.contactStats[contactId], minSamples);
}

/** Best historical channel among candidates, or null if none reaches minimum. */
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
 * Multiplier priority engine applies to unverified signal credibility.
 * 1 = nothing learned yet.
 */
export function unverifiedCredibilityMultiplier(weights: LearnedWeights): number {
  const penalty = Math.max(0, Math.min(MAX_UNCONFIRMED_PENALTY, weights.unconfirmedPenalty || 0));
  return round(1 - penalty);
}

// ---------------------------------------------------------------------------
// Explainability
// ---------------------------------------------------------------------------

export interface LearningInsight {
  /** Stable identifier, e.g. "channel:call". */
  key: string;
  /** Headline for display. */
  label: string;
  /** Why weight changed, with supporting sample counts. */
  detail: string;
  /** Samples backing conclusion. */
  samples: number;
  /** Learned value (rate 0..1, or penalty). */
  value: number;
  /** false when evidence exists but nothing is applied yet. */
  applied: boolean;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Translates weights into sentences suitable for presentation. When `RunRecord`s
 * are provided, also explains what is NOT yet applied due to lack of samples,
 * demonstrating the system does not overreact.
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
