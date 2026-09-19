// PROPIETARIO: agente del gemelo digital.
//
// Gemelo digital operativo: FARO mantiene una imagen percibida del mundo a
// partir de señales. En la demo también existe una verdad simulada (`world`),
// que sirve para medir precisión sin convertirla en una fuente mágica para la
// decisión. Este módulo es puro: recibe señales y mundo, devuelve métricas.

import { applyEventToWorld } from "./assumptions";
import { seedWorld } from "./seed";
import type {
  CrisisEvent,
  DigitalTwinFact,
  DigitalTwinFactStatus,
  DigitalTwinState,
  WorldState,
} from "./types";

const STALE_AFTER_MINUTES = 25;

const confidenceValue: Record<CrisisEvent["confidence"], number> = {
  low: 0.45,
  medium: 0.7,
  high: 0.9,
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizar(value: string) {
  return (value ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function signalConfidence(event: CrisisEvent, nowMs: number) {
  if (event.confirmed === false) return 0;
  const base = event.confirmed === true ? 0.98 : confidenceValue[event.confidence];
  const ageMinutes = Math.max(0, (nowMs - new Date(event.createdAt).getTime()) / 60_000);
  const decay = Math.max(0.55, Math.pow(0.5, ageMinutes / 60));
  const repetition = Math.min(1.12, 1 + Math.log(Math.max(1, event.occurrences)) * 0.05);
  return Math.min(0.99, base * decay * repetition);
}

function eventTouchesWorld(event: CrisisEvent) {
  const before = clone(seedWorld);
  return applyEventToWorld(before, event) !== before;
}

function evidenceFor(events: CrisisEvent[], predicate: (event: CrisisEvent) => boolean) {
  return events.filter((event) => event.confirmed !== false && predicate(event));
}

function strongestEvidence(events: CrisisEvent[], nowMs: number) {
  return events.reduce<CrisisEvent | null>((best, event) => {
    if (!best) return event;
    return signalConfidence(event, nowMs) > signalConfidence(best, nowMs) ? event : best;
  }, null);
}

function formatBoolean(value: boolean, truthy: string, falsy: string) {
  return value ? truthy : falsy;
}

function formatRoads(roads: string[]) {
  return roads.length > 0 ? roads.slice().sort().join(", ") : "ninguna";
}

function roadSet(roads: string[]) {
  return new Set(roads.map((road) => normalizar(road)));
}

function roadsMatch(a: string[], b: string[]) {
  const left = roadSet(a);
  const right = roadSet(b);
  if (left.size !== right.size) return false;
  return [...left].every((road) => right.has(road));
}

function statusFrom(
  confidence: number,
  matchesTruth: boolean,
  updatedAt: string | null,
  nowMs: number,
): DigitalTwinFactStatus {
  if (!updatedAt || confidence <= 0) return "unknown";
  const stale = nowMs - new Date(updatedAt).getTime() > STALE_AFTER_MINUTES * 60_000;
  if (!matchesTruth) return "mismatch";
  if (stale) return "stale";
  return confidence >= 0.85 ? "confirmed" : "inferred";
}

interface FactInput {
  id: string;
  label: string;
  variable: string;
  perceived: string;
  truth: string;
  matchesTruth: boolean;
  evidence: CrisisEvent[];
  impact: string;
}

function fact(input: FactInput, nowMs: number): DigitalTwinFact {
  const strongest = strongestEvidence(input.evidence, nowMs);
  const updatedAt = strongest?.createdAt ?? null;
  const confidence =
    input.evidence.length === 0
      ? 0
      : Math.min(
          0.99,
          input.evidence.reduce((max, event) => Math.max(max, signalConfidence(event, nowMs)), 0),
        );

  return {
    id: input.id,
    label: input.label,
    variable: input.variable,
    perceived: input.perceived,
    truth: input.truth,
    confidence,
    status: statusFrom(confidence, input.matchesTruth, updatedAt, nowMs),
    evidenceEventIds: input.evidence.map((event) => event.id),
    updatedAt,
    impact: input.impact,
  };
}

function perceivedFromSignals(events: CrisisEvent[]) {
  return events
    .filter((event) => event.confirmed !== false && eventTouchesWorld(event))
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .reduce((world, event) => applyEventToWorld(world, event), clone(seedWorld));
}

export function buildDigitalTwin(
  truth: WorldState,
  events: CrisisEvent[],
  options: { now?: string | number | Date } = {},
): DigitalTwinState {
  const nowMs =
    options.now instanceof Date
      ? options.now.getTime()
      : typeof options.now === "string"
        ? new Date(options.now).getTime()
        : typeof options.now === "number"
          ? options.now
          : Date.now();
  const updatedAt = new Date(nowMs).toISOString();
  const perceivedWorld = perceivedFromSignals(events);

  const windEvidence = evidenceFor(events, (event) => event.category === "wind-shift");
  const roadEvidence = evidenceFor(
    events,
    (event) => event.category === "route-blocked" || event.category === "route-open",
  );
  const smsEvidence = evidenceFor(
    events,
    (event) =>
      event.category === "integration-failure" &&
      normalizar(`${event.title} ${event.description}`).includes("sms"),
  );
  const voiceEvidence = evidenceFor(
    events,
    (event) =>
      event.category === "integration-failure" &&
      (normalizar(`${event.title} ${event.description}`).includes("voz") ||
        normalizar(`${event.title} ${event.description}`).includes("llamada")),
  );
  const hospitalEvidence = evidenceFor(events, (event) => event.category === "hospital-beds");

  const facts: DigitalTwinFact[] = [
    fact(
      {
        id: "wind",
        label: "Viento",
        variable: "wind.direction",
        perceived: `${perceivedWorld.windDirection} · ${perceivedWorld.windSpeedKmh} km/h`,
        truth: `${truth.windDirection} · ${truth.windSpeedKmh} km/h`,
        matchesTruth:
          normalizar(perceivedWorld.windDirection) === normalizar(truth.windDirection) &&
          perceivedWorld.windSpeedKmh === truth.windSpeedKmh,
        evidence: windEvidence,
        impact: "Sostiene el orden de prioridades y cuándo descartar un plan.",
      },
      nowMs,
    ),
    fact(
      {
        id: "roads",
        label: "Carreteras",
        variable: "roads.blocked",
        perceived: formatRoads(perceivedWorld.blockedRoads),
        truth: formatRoads(truth.blockedRoads),
        matchesTruth: roadsMatch(perceivedWorld.blockedRoads, truth.blockedRoads),
        evidence: roadEvidence,
        impact: "Decide si los recursos pueden llegar o si hay que reasignarlos.",
      },
      nowMs,
    ),
    fact(
      {
        id: "sms",
        label: "Canal SMS",
        variable: "comms.sms",
        perceived: formatBoolean(perceivedWorld.smsOperational, "operativo", "caído"),
        truth: formatBoolean(truth.smsOperational, "operativo", "caído"),
        matchesTruth: perceivedWorld.smsOperational === truth.smsOperational,
        evidence: smsEvidence,
        impact: "Determina si los avisos masivos y verificaciones por SMS son seguros.",
      },
      nowMs,
    ),
    fact(
      {
        id: "voice",
        label: "Canal voz",
        variable: "comms.voice",
        perceived: formatBoolean(perceivedWorld.voiceOperational, "operativo", "caído"),
        truth: formatBoolean(truth.voiceOperational, "operativo", "caído"),
        matchesTruth: perceivedWorld.voiceOperational === truth.voiceOperational,
        evidence: voiceEvidence,
        impact: "Determina si las llamadas de escalado pueden salir.",
      },
      nowMs,
    ),
    ...Object.keys({ ...perceivedWorld.hospitalBeds, ...truth.hospitalBeds })
      .sort()
      .map((hospitalId) =>
        fact(
          {
            id: `hospital-${hospitalId}`,
            label: hospitalId.replace(/^hospital-/, "Hospital ").replace(/-/g, " "),
            variable: `hospital.beds.${hospitalId}`,
            perceived:
              perceivedWorld.hospitalBeds[hospitalId] === undefined
                ? "sin dato"
                : `${perceivedWorld.hospitalBeds[hospitalId]} camas`,
            truth:
              truth.hospitalBeds[hospitalId] === undefined
                ? "sin dato"
                : `${truth.hospitalBeds[hospitalId]} camas`,
            matchesTruth:
              perceivedWorld.hospitalBeds[hospitalId] === truth.hospitalBeds[hospitalId],
            evidence: hospitalEvidence.filter((event) =>
              normalizar(`${event.title} ${event.description}`).includes(
                normalizar(hospitalId.replace(/^hospital-/, "").replace(/-/g, " ")),
              ),
            ),
            impact: "Condiciona evacuación sanitaria y derivación de heridos.",
          },
          nowMs,
        ),
      ),
  ];

  const known = facts.filter((item) => item.status !== "unknown");
  const matches = known.filter((item) => item.status !== "mismatch").length;
  const accuracy = known.length === 0 ? 0 : Math.round((matches / known.length) * 100);
  const mismatches = facts.filter((item) => item.status === "mismatch").length;
  const unknownFacts = facts.filter((item) => item.status === "unknown").length;
  const staleFacts = facts.filter((item) => item.status === "stale").length;
  const confirmedFacts = facts.filter((item) => item.status === "confirmed").length;

  return {
    updatedAt,
    perceivedWorld,
    facts,
    accuracy,
    confirmedFacts,
    unknownFacts,
    staleFacts,
    mismatches,
    summary:
      known.length === 0
        ? "FARO todavía no tiene evidencia suficiente para reconstruir el mundo."
        : `${accuracy}% de coincidencia con la verdad simulada; ${mismatches} divergencia(s), ${unknownFacts} dato(s) sin evidencia.`,
  };
}
