// OWNER: calibrated triage and verification agent.
//
// Signal triage with three outcomes. The challenge asks whether the system
// decides something sensible WITHOUT having all the data, and a confidence
// label (low/medium/high) only allows two answers: the signal counts or it doesn't.
// The middle one is missing, which is the interesting one.
//
//   p >= 0.85  -> "act"      act on the signal.
//   0.5 <= p   -> "verify"   DO NOT wait: generate a VERIFICATION ACTION,
//                            meaning, call someone to ask. Verifying is acting,
//                            not waiting.
//   p < 0.5    -> "discard"  discard, with visible reason.
//
// HOW EACH PROBABILITY IS DERIVED (all deterministic, without language models;
// every line can be explained verbally to the jury):
//
//   r        = learned source reliability (SourceReliability), 0.6 if source is unknown.
//   c        = reported confidence of signal: low 0.50, medium 0.75, high 0.95.
//   k        = 1 + 0.5*ln(occurrences): repeated reports reinforce with diminishing
//              returns (same criterion as occurrenceFactor in lib/priority.ts).
//   pClaim   = (1 - (1 - c)^k) * 0.7^(contradicting signals), floor 0.4.
//   pTruthful= pClaim * r, unless signal is already resolved: confirmed 0.97,
//              discarded 0.03.
//   pRelevant= base by severity (0.35 / 0.55 / 0.78 / 0.90)
//              + zone status (watch +0.02; active/critical +0.05)
//              + corroboration (+0.06 per consistent live signal, cap +0.12)
//              - contradiction (-0.12 per identical discarded signal, cap -0.25)
//              - 0.15 if zone does not exist on map.
//   urgency  = (base by severity + zone status + minutes to impact)
//              * freshness, with freshness = max(0.6; 0.5^(age / 45 min)).
//   confidence = fusion of independent sources:
//              C = 1 - PROD(1 - p_i * r_i)  (see fuseConfidence).
//
// THRESHOLDS THAT MOVE WITH URGENCY. Erring by staying silent in the face of a
// critical signal costs far more than erring by calling, so thresholds
// drop with urgency:
//
//   act threshold     = 0.85 - 0.08 * urgency
//   verify threshold  = 0.50 - 0.15 * urgency
//
// The verify threshold yields twice as much because asking is cheap and staying silent
// is not. It is declared asymmetric cost, not relaxed criteria.
//
// FUSION BY PROXIMITY AND TIME. Multiple signals at the same location and within a short
// window are fused, and confidence increases only if they come from independent sources.
// The zone map is NOT georeferenced (coordinates are grid units, not meters),
// so the 500 m rule applies at zone level: by default only the same zone corroborates,
// and `nearbyZoneUnits` allows accepting adjacent zones at a discount.
//
// SWAPPABLE ARCHITECTURE. This module falls entirely on the side of closed and massive
// questions (is it relevant?, is it duplicate?, is it urgent?, did the call confirm
// the fire?), which is precisely what is delegated to a fast classifier.
// It never plans or drafts messages.
//
// The fallback chain is: Jev -> small LLM with structured output -> deterministic engine.
// The deterministic engine is the final step and always available, so triage never fails
// to respond: if Jev goes down mid-demo or runs out of quota, decisions continue.
//
// CONTRACT FOR CONNECTING JEV (or intermediate LLM). Simply implement `SignalAssessor`
// and register it:
//
//   import { registerAssessor } from "@/lib/triage";
//   registerAssessor({
//     name: "jev",                       // "jev" | "llm"; copied into assessedBy
//     available: () => Boolean(client),  // false => passes to next step
//     costPerSignalEur: 0.0004,          // optional, for display cost
//     assess: (signal, context) => ({ ...SignalAssessment })
//   });
//   // and start with TRIAGE_ASSESSOR=jev  (or TRIAGE_ASSESSOR=jev,llm)
//
// INPUT: `TriageSignal` (raw payload or normalized CrisisEvent) and `TriageContext`
// (reliability by source, live signals, zones, thresholds, reference timestamp).
// No additional state: assessment is a pure function of these two arguments.
//
// OUTPUT: a complete `SignalAssessment` (lib/types.ts), with
// `pRelevant`, `pTruthful`, `urgency` and `confidence` in [0, 1];
// `decision` in "act" | "verify" | "discard", consistent with thresholds
// resolved by `resolveThresholds`; `rationale` in a single line in English;
// `assessedBy` with the REAL name of whoever assessed (never sign as Jev an
// assessment performed by another); applied `sourceReliability`; and `assessedAt` in ISO.
//
// IMPLEMENTER RULES: must be fast (called per signal), must not throw (if it throws,
// `assessSignal` falls back to deterministic and notes it in rationale), and must be
// stable for identical input, because the UI compares assessments across replannings.
//
// COST AND LATENCY. `assessSignalTimed` measures each decision and `summarizeTriage`
// summarizes the batch ("40 signals triaged in 1.2 s for 0.0160 €"), which is the
// measurable argument displayed on screen. The deterministic engine costs 0 € and
// serves as a baseline against which to compare the external classifier.

import { rolesForCategory, selectContactByRole } from "./contacts";
import type {
  ActionChannel,
  Assessor,
  Confidence,
  Contact,
  ContactRole,
  CrisisEvent,
  CrisisZone,
  EventSource,
  IncomingEventPayload,
  Severity,
  SignalAssessment,
  SourceReliability,
  TriageDecision,
} from "./types";

// ---------------------------------------------------------------------------
// Thresholds and constants
// ---------------------------------------------------------------------------

export interface TriageThresholds {
  /** Confidence threshold above which to act without asking. */
  act: number;
  /** Confidence threshold above which to verify instead of discarding. */
  verify: number;
  /**
   * How much the act threshold drops with maximum urgency. Asymmetric cost:
   * staying silent on a critical signal costs more than acting redundantly.
   */
  urgencyRelief: number;
  /**
   * How much the verify threshold drops with maximum urgency. Higher than act
   * relief because asking is cheap: the more urgent the signal, the cheaper to
   * call and the more expensive to stay silent. Learning adjusts it: if signals
   * above 0.8 are always confirmed, threshold is lowered.
   */
  verifyUrgencyRelief: number;
  /** Minimum relevance to act. Below this, at most verified. */
  relevanceForAct: number;
  /** Minimum relevance to bother someone with verification. */
  relevanceForVerify: number;
}

export const defaultTriageThresholds: TriageThresholds = {
  act: 0.85,
  verify: 0.5,
  urgencyRelief: 0.08,
  verifyUrgencyRelief: 0.15,
  relevanceForAct: 0.6,
  relevanceForVerify: 0.35,
};

/** Default reliability applied to a source with no history yet. */
export const DEFAULT_SOURCE_RELIABILITY = 0.6;

/**
 * Weight of a second signal from the SAME source during fusion. Two reports from
 * the same sensor are not two independent witnesses: correlation is explicitly
 * discounted instead of multiplying confidence as if they were independent.
 */
export const SAME_SOURCE_WEIGHT = 0.25;

/**
 * Window in minutes within which two signals at the same location are considered
 * the same event and fused. Outside the window, an older signal no longer
 * corroborates a new one: it may refer to something else.
 */
export const FUSION_WINDOW_MINUTES = 10;

/**
 * Radius in map units to accept signals from another zone as corroboration.
 * Default 0: only the same zone corroborates. The map is not georeferenced,
 * so there is no honest way to translate the 500 meters rule into these units;
 * the parameter is left open for when signals carry real coordinates.
 */
export const DEFAULT_NEARBY_ZONE_UNITS = 0;

/** Discount for corroboration coming from an adjacent zone rather than the same location. */
export const NEARBY_ZONE_DISCOUNT = 0.6;

/** Cost per signal for deterministic engine: zero euros, the baseline to beat. */
export const DETERMINISTIC_COST_EUR = 0;

/** Minimum observations before adjusting source reliability. */
export const MIN_SOURCE_SAMPLES = 4;

/** Maximum reliability adjustment per observation. */
export const SOURCE_RELIABILITY_STEP = 0.05;

/** Floor and ceiling for reliability: no source always lies or is always right. */
export const MIN_SOURCE_RELIABILITY = 0.15;
export const MAX_SOURCE_RELIABILITY = 0.98;

/** Reported confidence translated to probability of claim being true. */
const claimByConfidence: Record<Confidence, number> = {
  low: 0.5,
  medium: 0.75,
  high: 0.95,
};

/** Base probability that a signal is relevant, by reported severity. */
const relevanceBySeverity: Record<Severity, number> = {
  low: 0.35,
  medium: 0.55,
  high: 0.78,
  critical: 0.9,
};

/** Base urgency by reported severity. */
const urgencyBySeverity: Record<Severity, number> = {
  low: 0.2,
  medium: 0.45,
  high: 0.75,
  critical: 0.95,
};

const severityLabel: Record<Severity, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  critical: "critical",
};

const confidenceLabel: Record<Confidence, string> = {
  low: "low",
  medium: "medium",
  high: "high",
};

const sourceLabel: Record<EventSource, string> = {
  happyrobot: "HappyRobot",
  sensor: "sensor",
  operator: "operator",
  public: "citizen report",
  demo: "demo",
  scenario: "scenario",
};

const roleLabel: Record<ContactRole, string> = {
  "field-coordinator": "field coordinator",
  "medical-lead": "medical lead",
  "public-safety": "public safety",
  volunteer: "volunteer",
  "operations-lead": "operations room",
  authority: "emergency authority",
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function percent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

function resolveNow(now?: number | string | Date): number {
  if (now === undefined) return Date.now();
  if (typeof now === "number") return now;
  const parsed = now instanceof Date ? now.getTime() : Date.parse(now);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

/** Age in minutes, never negative. An unreadable timestamp counts as recent. */
function ageInMinutes(iso: string | null | undefined, now: number): number {
  if (!iso) return 0;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, (now - at) / 60000);
}

/** Equivalent categories: "evacuacion-costa" and "evacuacion" discuss the same topic. */
function sameTopic(a: string, b: string): boolean {
  const left = normalizeTopic(a);
  const right = normalizeTopic(b);
  return left === right || left.includes(right) || right.includes(left);
}

function normalizeTopic(category: string): string {
  return category
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-");
}

/** Learned reliability of a source, or default value if no history exists. */
export function reliabilityOf(
  reliability: SourceReliability[] | undefined,
  source: EventSource,
): number {
  const entry = reliability?.find((candidate) => candidate.source === source);
  return clamp(
    entry?.reliability ?? DEFAULT_SOURCE_RELIABILITY,
    MIN_SOURCE_RELIABILITY,
    MAX_SOURCE_RELIABILITY,
  );
}

// ---------------------------------------------------------------------------
// Triage inputs
// ---------------------------------------------------------------------------

/**
 * Signal to assess. Can be a newly arrived raw payload or a
 * `CrisisEvent` already normalized by the store.
 */
export type TriageSignal = IncomingEventPayload & {
  id?: string;
  occurrences?: number;
  createdAt?: string;
};

export interface TriageContext {
  /** Learned reliability by source (state.sourceReliability). */
  sourceReliability?: SourceReliability[];
  /** Signals already present, to corroborate or contradict. */
  events?: CrisisEvent[];
  /** Known zones, to know if signal points to a real place. */
  zones?: CrisisZone[];
  /** Custom thresholds. Unspecified fields use defaults. */
  thresholds?: Partial<TriageThresholds>;
  /** Minutes within which another signal corroborates. Defaults to 10. */
  fusionWindowMinutes?: number;
  /**
   * Radius in map units to accept corroboration from neighboring zones.
   * Defaults to 0: only the same zone counts.
   */
  nearbyZoneUnits?: number;
  /** Reference timestamp. Fixing it makes assessment reproducible. */
  now?: number | string | Date;
}

export function resolveThresholds(partial?: Partial<TriageThresholds>): TriageThresholds {
  if (!partial) return defaultTriageThresholds;
  return { ...defaultTriageThresholds, ...partial };
}

// ---------------------------------------------------------------------------
// Confidence fusion
// ---------------------------------------------------------------------------

export interface FusionSignal {
  source: EventSource;
  /** Probability that what the signal asserts is true, excluding source reliability. */
  probability: number;
  /** Source reliability. If omitted, default value is used. */
  reliability?: number;
}

export interface FusionOptions {
  /** Weight of repeated signals from the same source. 0 = only the best one counts. */
  sameSourceWeight?: number;
}

/**
 * Fuses independent sources: C = 1 - PROD(1 - p_i * r_i).
 *
 * Two independent witnesses carry more weight than one, but with diminishing
 * returns. Two signals from the SAME source are not independent: within a source,
 * only the strongest counts fully and the others enter with weight
 * `sameSourceWeight`, so they never inflate confidence like two distinct witnesses.
 */
export function fuseConfidence(signals: FusionSignal[], options: FusionOptions = {}): number {
  if (!signals || signals.length === 0) return 0;
  const sameSourceWeight = clamp(options.sameSourceWeight ?? SAME_SOURCE_WEIGHT);

  const bySource = new Map<EventSource, number[]>();
  for (const signal of signals) {
    const probability = clamp(signal.probability);
    const reliability = clamp(signal.reliability ?? DEFAULT_SOURCE_RELIABILITY);
    const evidence = clamp(probability * reliability);
    const group = bySource.get(signal.source) ?? [];
    group.push(evidence);
    bySource.set(signal.source, group);
  }

  let complement = 1;
  for (const group of bySource.values()) {
    const sorted = [...group].sort((a, b) => b - a);
    // First signal from the source counts fully; subsequent ones are discounted
    // for correlation. With sameSourceWeight = 0, repeating the same source adds
    // absolutely nothing.
    let groupComplement = 1 - sorted[0];
    for (const evidence of sorted.slice(1)) {
      groupComplement *= 1 - sameSourceWeight * evidence;
    }
    complement *= groupComplement;
  }

  return round(clamp(1 - complement, 0, 0.99));
}

// ---------------------------------------------------------------------------
// Learned source reliability
// ---------------------------------------------------------------------------

/**
 * Incorporates signal outcome into its source reliability.
 *
 * Same criterion as lib/learning.ts: minimum samples before concluding
 * anything and bounded movement per observation. A system that overreacts to
 * a single mistake is worse than one that does not learn, so the first false report
 * from a source is noted but does not shift its reliability.
 *
 * Returns a new list: state is cloned when served via the API and
 * in-place mutation should be avoided.
 */
export function updateSourceReliability(
  reliability: SourceReliability[],
  source: EventSource,
  wasConfirmed: boolean,
): SourceReliability[] {
  const list = reliability ? [...reliability] : [];
  const index = list.findIndex((candidate) => candidate.source === source);
  const current: SourceReliability =
    index >= 0
      ? list[index]
      : { source, reliability: DEFAULT_SOURCE_RELIABILITY, observations: 0, confirmed: 0 };

  const observations = current.observations + 1;
  const confirmed = current.confirmed + (wasConfirmed ? 1 : 0);

  // Cold start: observation accumulates, but reliability does not shift
  // until sufficient samples exist.
  let next = current.reliability;
  if (observations >= MIN_SOURCE_SAMPLES) {
    const observedRate = confirmed / observations;
    const delta = clamp(
      observedRate - current.reliability,
      -SOURCE_RELIABILITY_STEP,
      SOURCE_RELIABILITY_STEP,
    );
    next = clamp(current.reliability + delta, MIN_SOURCE_RELIABILITY, MAX_SOURCE_RELIABILITY);
  }

  const updated: SourceReliability = {
    source,
    reliability: round(next),
    observations,
    confirmed,
  };

  if (index >= 0) list[index] = updated;
  else list.push(updated);
  return list;
}

/** A human-readable line explaining why a source has its current reliability. */
export function explainSourceReliability(entry: SourceReliability): string {
  if (entry.observations < MIN_SOURCE_SAMPLES) {
    return `${sourceLabel[entry.source]}: baseline reliability ${percent(entry.reliability)}; ${entry.observations} of ${MIN_SOURCE_SAMPLES} samples needed to adjust.`;
  }
  return `${sourceLabel[entry.source]}: reliability ${percent(entry.reliability)} after ${entry.confirmed} confirmations across ${entry.observations} resolved signals.`;
}

// ---------------------------------------------------------------------------
// Deterministic engine
// ---------------------------------------------------------------------------

interface Supporter {
  event: CrisisEvent;
  /** 1 if from the same location; discounted if from a neighboring zone. */
  weight: number;
}

interface Corroboration {
  /** Live signals at same location and topic, within fusion window. */
  supporting: Supporter[];
  /** Signals at same location and topic already discarded as false. */
  contradicting: CrisisEvent[];
}

/**
 * Distance between signal zone and another signal's zone, in map units.
 * null if either zone is not on the map.
 */
function zoneDistance(zones: CrisisZone[], a: string | undefined, b: string): number | null {
  const from = zones.find((zone) => zone.id === a);
  const to = zones.find((zone) => zone.id === b);
  if (!from || !to) return null;
  const dx = from.coordinates.x - to.coordinates.x;
  const dy = from.coordinates.y - to.coordinates.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Signals reporting the same event: same topic, same location (same zone or,
 * if radius is expanded, a neighboring zone) and within the fusion window.
 *
 * Those already discarded as false count regardless of when discarded:
 * a debunked rumor from half an hour ago is still a debunked rumor.
 */
function gatherCorroboration(
  signal: TriageSignal,
  context: TriageContext,
  now: number,
): Corroboration {
  const events = context.events ?? [];
  const zones = context.zones ?? [];
  const zoneId = signal.zoneId;
  const category = signal.category ?? "";
  const windowMinutes = context.fusionWindowMinutes ?? FUSION_WINDOW_MINUTES;
  const radius = context.nearbyZoneUnits ?? DEFAULT_NEARBY_ZONE_UNITS;
  const supporting: Supporter[] = [];
  const contradicting: CrisisEvent[] = [];

  for (const event of events) {
    if (signal.id && event.id === signal.id) continue;
    if (!zoneId || !category) continue;
    if (!sameTopic(event.category, category)) continue;

    const sameSpot = event.zoneId === zoneId;
    let weight = 1;
    if (!sameSpot) {
      if (radius <= 0) continue;
      const distance = zoneDistance(zones, zoneId, event.zoneId);
      if (distance === null || distance > radius) continue;
      weight = NEARBY_ZONE_DISCOUNT;
    }

    if (event.confirmed === false) {
      contradicting.push(event);
      continue;
    }

    // Outside the fusion window it is not the same event, but a different moment.
    if (ageInMinutes(event.createdAt, now) > windowMinutes) continue;
    supporting.push({ event, weight });
  }

  return { supporting, contradicting };
}

/** Probability that the claim is true, before applying source reliability. */
function claimProbability(
  confidence: Confidence,
  occurrences: number,
  contradictions: number,
): number {
  const base = claimByConfidence[confidence] ?? claimByConfidence.medium;
  const count = Math.max(1, Math.floor(occurrences || 1));
  // Repeating reinforces with diminishing returns: complement is raised to
  // k = 1 + 0.5*ln(n). A report repeated three times is not worth three times as much.
  const k = 1 + 0.5 * Math.log(count);
  const reinforced = 1 - Math.pow(1 - base, k);
  // Each already discarded signal on the same topic subtracts credibility, with floor:
  // someone having been mistaken before does not prove this is false.
  const penalty = Math.max(0.4, Math.pow(0.7, contradictions));
  return clamp(reinforced * penalty);
}

function relevanceProbability(
  signal: TriageSignal,
  zone: CrisisZone | undefined,
  zonesKnown: boolean,
  corroboration: Corroboration,
): number {
  const severity = signal.severity ?? "medium";
  let value = relevanceBySeverity[severity] ?? relevanceBySeverity.medium;

  if (zone) {
    if (zone.status === "active" || zone.status === "critical") value += 0.05;
    else if (zone.status === "watch") value += 0.02;
  } else if (zonesKnown) {
    // Points to a zone not on the map: could be relevant, but unknown where to place it.
    value -= 0.15;
  }

  const support = corroboration.supporting.reduce((acc, item) => acc + item.weight, 0);
  value += Math.min(0.12, 0.06 * support);
  value -= Math.min(0.25, 0.12 * corroboration.contradicting.length);

  return clamp(round(value));
}

function urgencyEstimate(signal: TriageSignal, zone: CrisisZone | undefined, now: number): number {
  const severity = signal.severity ?? "medium";
  let value = urgencyBySeverity[severity] ?? urgencyBySeverity.medium;

  if (zone) {
    if (zone.status === "critical") value += 0.08;
    else if (zone.status === "active") value += 0.04;

    const minutes = zone.minutesToImpact;
    if (typeof minutes === "number") {
      if (minutes <= 15) value += 0.1;
      else if (minutes <= 30) value += 0.05;
    }
  }

  // What was known half an hour ago is less urgent, but urgency never drops to zero.
  const freshness = Math.max(0.6, Math.pow(0.5, ageInMinutes(signal.createdAt, now) / 45));
  return clamp(round(value * freshness));
}

function buildRationale(input: {
  signal: TriageSignal;
  decision: TriageDecision;
  confidence: number;
  pRelevant: number;
  reliability: number;
  actThreshold: number;
  verifyThreshold: number;
  corroboration: Corroboration;
  thresholds: TriageThresholds;
}): string {
  const { signal, decision, confidence, pRelevant, reliability, corroboration } = input;
  const source = sourceLabel[signal.source ?? "happyrobot"] ?? "unknown source";
  const confianza = confidenceLabel[signal.confidence ?? "medium"];
  const gravedad = severityLabel[signal.severity ?? "medium"];

  const partes: string[] = [
    `${source} (reliability ${percent(reliability)}), ${gravedad} severity and ${confianza} reported confidence`,
  ];
  if ((signal.occurrences ?? 1) > 1) partes.push(`${signal.occurrences} equivalent reports`);
  if (corroboration.supporting.length > 0) {
    partes.push(`${corroboration.supporting.length} consistent signal(s) in the same zone`);
  }
  if (corroboration.contradicting.length > 0) {
    partes.push(
      `${corroboration.contradicting.length} signal(s) already discarded on the same matter`,
    );
  }
  if (signal.confirmed === true) partes.push("signal already confirmed");
  if (signal.confirmed === false) partes.push("signal already discarded by an operator");

  const cabecera = partes.join("; ");

  if (decision === "act") {
    return `${cabecera}. Fused confidence ${percent(confidence)} above ${percent(input.actThreshold)} threshold: acting.`;
  }
  if (decision === "verify") {
    if (pRelevant < input.thresholds.relevanceForAct && confidence >= input.actThreshold) {
      return `${cabecera}. Credible (${percent(confidence)}) but relevance ${percent(pRelevant)}: verifying before moving resources.`;
    }
    return `${cabecera}. Fused confidence ${percent(confidence)} between ${percent(input.verifyThreshold)} and ${percent(input.actThreshold)}: verifying via call.`;
  }
  if (pRelevant < input.thresholds.relevanceForVerify) {
    return `${cabecera}. Relevance below threshold: discarded.`;
  }
  return `${cabecera}. Fused confidence ${percent(confidence)} below ${percent(input.verifyThreshold)} threshold: discarded.`;
}

/** Deterministic assessment of a signal. Same inputs, same output. */
function assessDeterministic(signal: TriageSignal, context: TriageContext = {}): SignalAssessment {
  const thresholds = resolveThresholds(context.thresholds);
  const now = resolveNow(context.now);
  const source = signal.source ?? "happyrobot";
  const reliability = reliabilityOf(context.sourceReliability, source);

  const zones = context.zones ?? [];
  const zone = zones.find((candidate) => candidate.id === signal.zoneId);
  const corroboration = gatherCorroboration(signal, context, now);

  // 1. Is what it reports true?
  const pClaim = claimProbability(
    signal.confidence ?? "medium",
    signal.occurrences ?? 1,
    corroboration.contradicting.length,
  );
  const pTruthful =
    signal.confirmed === true
      ? 0.97
      : signal.confirmed === false
        ? 0.03
        : clamp(pClaim * reliability);

  // 2. Does it matter for this crisis?
  const pRelevant = relevanceProbability(signal, zone, zones.length > 0, corroboration);

  // 3. Is it urgent?
  const urgency = urgencyEstimate(signal, zone, now);

  // 4. Fused confidence: this signal plus corroborating ones, grouped by
  //    source to avoid double-counting the same witness.
  const fusion: FusionSignal[] = [{ source, probability: pClaim, reliability }];
  for (const { event, weight } of corroboration.supporting) {
    fusion.push({
      source: event.source,
      probability: claimProbability(event.confidence, event.occurrences, 0) * weight,
      reliability: reliabilityOf(context.sourceReliability, event.source),
    });
  }
  const fused =
    signal.confirmed === true ? 0.97 : signal.confirmed === false ? 0.03 : fuseConfidence(fusion);
  const confidence = round(clamp(fused));

  // 5. Decision. Threshold drops with urgency: erring by staying silent
  //    on a critical signal costs more than erring by calling.
  const actThreshold = round(clamp(thresholds.act - thresholds.urgencyRelief * urgency, 0.2, 1));
  const verifyThreshold = round(
    clamp(thresholds.verify - thresholds.verifyUrgencyRelief * urgency, 0.1, 1),
  );

  let decision: TriageDecision;
  if (confidence >= actThreshold && pRelevant >= thresholds.relevanceForAct) {
    decision = "act";
  } else if (confidence >= verifyThreshold && pRelevant >= thresholds.relevanceForVerify) {
    decision = "verify";
  } else {
    decision = "discard";
  }

  return {
    pRelevant,
    pTruthful: round(pTruthful),
    urgency,
    confidence,
    decision,
    rationale: buildRationale({
      signal,
      decision,
      confidence,
      pRelevant,
      reliability,
      actThreshold,
      verifyThreshold,
      corroboration,
      thresholds,
    }),
    assessedBy: "deterministic",
    sourceReliability: round(reliability),
    assessedAt: new Date(now).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Swappable assessors
// ---------------------------------------------------------------------------

/**
 * Contract for a signal assessor. The deterministic engine implements it
 * and serves as permanent fallback; an external classifier (Jev/TypeSafe) can
 * implement it when access becomes available without touching the rest of the system.
 */
export interface SignalAssessor {
  /** Who signs the assessment. Copied as-is into `assessment.assessedBy`. */
  readonly name: Assessor;
  /** If returning false, skipped and falls back to deterministic engine. */
  available(): boolean;
  assess(signal: TriageSignal, context?: TriageContext): SignalAssessment;
}

/** Deterministic engine: always available, default. */
export const deterministicAssessor: SignalAssessor = {
  name: "deterministic",
  available: () => true,
  assess: (signal, context) => assessDeterministic(signal, context),
};

/**
 * Placeholder for external classifier. While Jev is in early access,
 * there is no client to call, so this assessor reports NOT available and
 * the system works identically without it. Adds no dependencies or network calls.
 *
 * When access is available: implement `SignalAssessor` in a separate module,
 * register with `registerAssessor(...)` at startup, and set TRIAGE_ASSESSOR=jev.
 * If the client fails or times out, returning false from `available()` falls
 * back to deterministic without touching the store.
 */
export const externalAssessorPlaceholder: SignalAssessor = {
  name: "jev",
  available: () => false,
  assess: (signal, context) => {
    // Never lie about who assessed: without external client, assessment is
    // deterministic and signed as such.
    const assessment = assessDeterministic(signal, context);
    return {
      ...assessment,
      rationale: `External assessor unavailable; deterministic fallback. ${assessment.rationale}`,
    };
  },
};

let registeredAssessor: SignalAssessor | null = null;

/** Connects (or disconnects, with null) the external assessor. */
export function registerAssessor(assessor: SignalAssessor | null): void {
  registeredAssessor = assessor;
}

/** Assessor name requested via environment. Defaults to deterministic. */
export function requestedAssessorName(): string {
  return (process.env.TRIAGE_ASSESSOR ?? "deterministic").trim().toLowerCase();
}

/**
 * Effective assessor: registered one only if requested by env AND declared
 * available. Otherwise, deterministic.
 */
export function selectAssessor(): SignalAssessor {
  const requested = requestedAssessorName();
  if (requested === "deterministic" || !registeredAssessor) return deterministicAssessor;
  if (registeredAssessor.name !== requested) return deterministicAssessor;
  try {
    if (!registeredAssessor.available()) return deterministicAssessor;
  } catch {
    return deterministicAssessor;
  }
  return registeredAssessor;
}

/**
 * Assesses a signal and returns calibrated triage. If external assessor
 * fails for any reason, falls back to deterministic: triage never stops responding.
 */
export function assessSignal(signal: TriageSignal, context: TriageContext = {}): SignalAssessment {
  const assessor = selectAssessor();
  if (assessor === deterministicAssessor) return assessDeterministic(signal, context);
  try {
    return assessor.assess(signal, context);
  } catch {
    const fallback = assessDeterministic(signal, context);
    return {
      ...fallback,
      rationale: `Assessor ${assessor.name} failed; deterministic fallback. ${fallback.rationale}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Verification request
// ---------------------------------------------------------------------------

/** Specific doubt to resolve during verification call. */
export type VerificationDoubt = "veracidad" | "relevancia" | "alcance";

export interface VerificationRequest {
  eventId: string;
  zoneId: string;
  /** Dominant doubt: decides what is asked. */
  doubt: VerificationDoubt;
  /** Role being questioned. */
  role: ContactRole;
  /** Specific contact, if contacts were passed in context. */
  contactId: string | null;
  /** Human-readable recipient, ready for `Action.target`. */
  target: string;
  channel: ActionChannel;
  /** Two or three concise, closed questions. */
  questions: string[];
  /** Drafted objective, ready for `Action.objective`. */
  objective: string;
  /** Reason for `Action.reason`. */
  reason: string;
}

export interface VerificationContext {
  zones?: CrisisZone[];
  contacts?: Contact[];
}

/**
 * What to ask and whom to resolve the specific doubt about a signal.
 *
 * Not a questionnaire: two or three closed questions that can be answered
 * by phone in thirty seconds and alter the decision depending on the response.
 */
export function buildVerificationRequest(
  event: CrisisEvent,
  assessment: SignalAssessment,
  context: VerificationContext = {},
): VerificationRequest {
  const zone = context.zones?.find((candidate) => candidate.id === event.zoneId);
  const zoneName = zone?.name ?? event.zoneId;
  const role = rolesForCategory(event.category)[0] ?? "operations-lead";
  const contact = context.contacts
    ? selectContactByRole(context.contacts, event.zoneId, role)
    : null;

  // Dominant doubt is the weakest pillar: doubt truth -> ask about facts;
  // doubt relevance -> ask about fit; if both are solid but signal is severe,
  // ask about scope to dimension the response.
  const doubt: VerificationDoubt =
    assessment.pTruthful <= assessment.pRelevant
      ? "veracidad"
      : assessment.pRelevant < 0.6
        ? "relevancia"
        : "alcance";

  const hecho = event.title.trim().replace(/\.$/, "");
  const questions: string[] = [];

  if (doubt === "veracidad") {
    questions.push(`Are you currently witnessing ${hecho.toLowerCase()} in ${zoneName}? (yes/no)`);
    questions.push(
      "Did you verify this in person or was it reported to you? (in person/reported to me)",
    );
  } else if (doubt === "relevancia") {
    questions.push(
      `Is this incident within ${zoneName} or in another zone? (this zone/other zone)`,
    );
    questions.push(`Is it related to ${event.category.replace(/-/g, " ")}? (yes/no)`);
  } else {
    questions.push(`Is ${hecho.toLowerCase()} still active in ${zoneName}? (yes/no)`);
  }

  // Third question: sizing or timing, depending on what remains unknown.
  if (event.severity === "high" || event.severity === "critical") {
    questions.push("How many people are currently affected? (approximate number)");
  } else if (assessment.urgency >= 0.5) {
    questions.push("Is intervention needed within the next 15 minutes? (yes/no)");
  }

  const channel: ActionChannel = assessment.urgency >= 0.5 ? "call" : "sms";
  const target = contact?.name ?? `${roleLabel[role]} lead in ${zoneName}`;
  const canal = channel === "call" ? "Call" : "Text";

  const objective = `${canal} ${target} to verify "${event.title}" in ${zoneName}: ${questions.join(" ")}`;

  const reason = `Intermediate triage: confidence ${percent(assessment.confidence)}, relevance ${percent(assessment.pRelevant)}. Verify ${doubt} before committing resources.`;

  return {
    eventId: event.id,
    zoneId: event.zoneId,
    doubt,
    role,
    contactId: contact?.id ?? null,
    target,
    channel,
    questions,
    objective,
    reason,
  };
}

/** UI shortcut: decision label. */
export const decisionLabel: Record<TriageDecision, string> = {
  act: "Act",
  verify: "Verify",
  discard: "Discard",
};
