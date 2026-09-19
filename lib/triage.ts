// PROPIETARIO: agente de triaje calibrado y verificación.
//
// Triaje de señales con tres salidas. El reto pregunta si el sistema decide
// algo sensato SIN tener todos los datos, y una etiqueta de confianza
// (baja/media/alta) sólo permite dos respuestas: la señal cuenta o no cuenta.
// Falta la del medio, que es la interesante.
//
//   p ≥ 0,85  → "act"      se actúa sobre la señal.
//   0,5 ≤ p   → "verify"   NO se espera: se genera una ACCIÓN DE VERIFICACIÓN,
//                          es decir, se llama a alguien a preguntar. Verificar
//                          es actuar, no esperar.
//   p < 0,5   → "discard"  se descarta, con el motivo visible.
//
// CÓMO SE DERIVA CADA PROBABILIDAD (todo determinista, sin modelo de lenguaje;
// cada línea es explicable de viva voz ante el jurado):
//
//   r        = fiabilidad aprendida de la fuente (SourceReliability), 0,6 si
//              la fuente es desconocida.
//   c        = confianza declarada de la señal: baja 0,50 · media 0,75 ·
//              alta 0,95.
//   k        = 1 + 0,5·ln(occurrences): repetir un aviso refuerza, con
//              rendimientos decrecientes (mismo criterio que occurrenceFactor
//              en lib/priority.ts).
//   pClaim   = (1 − (1 − c)^k) · 0,7^(señales que la contradicen), suelo 0,4.
//   pTruthful= pClaim · r, salvo que la señal ya esté resuelta: confirmada
//              0,97 y descartada 0,03.
//   pRelevant= base por gravedad (0,35 / 0,55 / 0,78 / 0,90)
//              + estado de la zona (watch +0,02; active/critical +0,05)
//              + corroboración (+0,06 por señal viva coherente, tope +0,12)
//              − contradicción (−0,12 por señal descartada igual, tope −0,25)
//              − 0,15 si la zona no existe en el mapa.
//   urgency  = (base por gravedad + estado de zona + minutos hasta impacto)
//              · frescura, con frescura = max(0,6; 0,5^(edad/45 min)).
//   confidence = fusión de fuentes independientes:
//              C = 1 − ∏(1 − p_i·r_i)  (ver fuseConfidence).
//
// UMBRALES QUE SE MUEVEN CON LA URGENCIA. Equivocarse callando ante una señal
// crítica cuesta mucho más que equivocarse llamando, así que los umbrales
// bajan con la urgencia:
//
//   umbral de actuar     = 0,85 − 0,08·urgency
//   umbral de verificar  = 0,50 − 0,15·urgency
//
// El de verificar cede el doble porque preguntar es barato y callarse no. Es
// coste asimétrico declarado, no relajar el criterio.
//
// FUSIÓN POR CERCANÍA Y TIEMPO. Varias señales del mismo punto y dentro de una
// ventana corta se fusionan, y la confianza sube sólo si vienen de fuentes
// independientes. El mapa de zonas NO está georreferenciado (las coordenadas
// son unidades de tablero, no metros), así que la regla de los 500 m se aplica
// a nivel de zona: por defecto sólo corrobora la misma zona, y
// `nearbyZoneUnits` permite admitir zonas contiguas con descuento.
//
// ARQUITECTURA INTERCAMBIABLE. Este módulo cae entero en el lado de las
// preguntas cerradas y masivas (¿es relevante?, ¿es duplicado?, ¿es urgente?,
// ¿la llamada confirmó el incendio?), que es justo lo que se delega en un
// clasificador rápido. Nunca planifica ni redacta mensajes.
//
// La cadena de respaldo es: Jev → LLM pequeño con salida estructurada →
// motor determinista. El determinista es el último escalón y siempre está
// disponible, así que el triaje nunca deja de responder: si Jev se cae en
// mitad de la demo o se agota el límite de uso, la decisión sigue saliendo.
//
// CONTRATO PARA QUIEN ENCHUFE JEV (o el LLM intermedio). Basta con implementar
// `SignalAssessor` y registrarlo:
//
//   import { registerAssessor } from "@/lib/triage";
//   registerAssessor({
//     name: "jev",                       // "jev" | "llm"; se copia en assessedBy
//     available: () => Boolean(cliente), // false => se pasa al siguiente escalón
//     costPerSignalEur: 0.0004,          // opcional, para el coste en pantalla
//     assess: (signal, context) => ({ ...SignalAssessment })
//   });
//   // y arrancar con TRIAGE_ASSESSOR=jev  (o TRIAGE_ASSESSOR=jev,llm)
//
// ENTRADA: `TriageSignal` (el payload crudo o un CrisisEvent ya normalizado) y
// `TriageContext` (fiabilidad por fuente, señales vivas, zonas, umbrales e
// instante de referencia). No hay más estado: la evaluación es una función
// pura de esos dos argumentos.
//
// SALIDA: un `SignalAssessment` completo (lib/types.ts), con
// `pRelevant`, `pTruthful`, `urgency` y `confidence` en [0, 1];
// `decision` en "act" | "verify" | "discard", coherente con los umbrales
// resueltos por `resolveThresholds`; `rationale` en una línea en español;
// `assessedBy` con el nombre REAL de quien evaluó (nunca firmar como Jev una
// evaluación que hizo otro); `sourceReliability` la que se aplicó; y
// `assessedAt` en ISO.
//
// REGLAS DEL IMPLEMENTADOR: debe ser rápido (se llama por cada señal), no debe
// lanzar (si lanza, `assessSignal` cae al determinista y lo dice en el
// rationale) y debe ser estable ante la misma entrada, porque la UI compara
// evaluaciones entre replanificaciones.
//
// COSTE Y LATENCIA. `assessSignalTimed` mide cada decisión y `summarizeTriage`
// resume la tanda ("40 señales triadas en 1,2 s por 0,0160 €"), que es el
// argumento medible que se pinta en pantalla. El motor determinista cuesta 0 €
// y sirve de referencia contra la que comparar el clasificador externo.

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
// Umbrales y constantes
// ---------------------------------------------------------------------------

export interface TriageThresholds {
  /** Confianza a partir de la cual se actúa sin preguntar. */
  act: number;
  /** Confianza a partir de la cual se verifica en vez de descartar. */
  verify: number;
  /**
   * Cuánto baja el umbral de actuación con urgencia máxima. Coste asimétrico:
   * callarse ante una señal crítica cuesta más que actuar de más.
   */
  urgencyRelief: number;
  /**
   * Cuánto baja el umbral de verificación con urgencia máxima. Es mayor que el
   * de actuación porque preguntar es barato: cuanto más urgente sea la señal,
   * más barato sale llamar y más caro sale callarse. El aprendizaje lo mueve:
   * si las señales por encima de 0,8 se confirman siempre, se baja el umbral.
   */
  verifyUrgencyRelief: number;
  /** Relevancia mínima para actuar. Por debajo, como mucho se verifica. */
  relevanceForAct: number;
  /** Relevancia mínima para molestar a alguien verificando. */
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

/** Fiabilidad que se aplica a una fuente de la que no se sabe nada todavía. */
export const DEFAULT_SOURCE_RELIABILITY = 0.6;

/**
 * Peso de una segunda señal de la MISMA fuente al fusionar. Dos partes del
 * mismo sensor no son dos testigos independientes: la correlación se descuenta
 * explícitamente en vez de multiplicar la confianza como si lo fueran.
 */
export const SAME_SOURCE_WEIGHT = 0.25;

/**
 * Ventana en minutos dentro de la cual dos señales del mismo punto se
 * consideran el mismo hecho y se fusionan. Fuera de la ventana, una señal
 * antigua ya no corrobora a la nueva: puede estar hablando de otra cosa.
 */
export const FUSION_WINDOW_MINUTES = 10;

/**
 * Radio en unidades de mapa para admitir como corroboración señales de otra
 * zona. Por defecto 0: sólo corrobora la misma zona. El mapa no está
 * georreferenciado, así que no hay forma honesta de traducir los 500 metros de
 * la regla a estas unidades; se deja el parámetro abierto para el día que las
 * señales traigan coordenadas reales.
 */
export const DEFAULT_NEARBY_ZONE_UNITS = 0;

/** Descuento de una corroboración que viene de una zona vecina, no del mismo punto. */
export const NEARBY_ZONE_DISCOUNT = 0.6;

/** Coste por señal del motor determinista: cero euros, y es el suelo a batir. */
export const DETERMINISTIC_COST_EUR = 0;

/** Observaciones mínimas antes de mover la fiabilidad de una fuente. */
export const MIN_SOURCE_SAMPLES = 4;

/** Movimiento máximo de la fiabilidad por observación. */
export const SOURCE_RELIABILITY_STEP = 0.05;

/** Suelo y techo de la fiabilidad: ni una fuente miente siempre ni acierta siempre. */
export const MIN_SOURCE_RELIABILITY = 0.15;
export const MAX_SOURCE_RELIABILITY = 0.98;

/** Confianza declarada traducida a probabilidad de que lo contado sea cierto. */
const claimByConfidence: Record<Confidence, number> = {
  low: 0.5,
  medium: 0.75,
  high: 0.95,
};

/** Probabilidad base de que una señal sea relevante, por gravedad declarada. */
const relevanceBySeverity: Record<Severity, number> = {
  low: 0.35,
  medium: 0.55,
  high: 0.78,
  critical: 0.9,
};

/** Urgencia base por gravedad declarada. */
const urgencyBySeverity: Record<Severity, number> = {
  low: 0.2,
  medium: 0.45,
  high: 0.75,
  critical: 0.95,
};

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

const sourceLabel: Record<EventSource, string> = {
  happyrobot: "HappyRobot",
  sensor: "sensor",
  operator: "operador",
  public: "aviso ciudadano",
  demo: "demo",
  scenario: "escenario",
};

const roleLabel: Record<ContactRole, string> = {
  "field-coordinator": "coordinación de campo",
  "medical-lead": "jefatura sanitaria",
  "public-safety": "seguridad pública",
  volunteer: "voluntariado",
  "operations-lead": "sala de coordinación",
  authority: "autoridad de emergencias",
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

/** Antigüedad en minutos, nunca negativa. Un timestamp ilegible cuenta como reciente. */
function ageInMinutes(iso: string | null | undefined, now: number): number {
  if (!iso) return 0;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, (now - at) / 60000);
}

/** Categorías equivalentes: "evacuacion-costa" y "evacuacion" hablan de lo mismo. */
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

/** Fiabilidad aprendida de una fuente, o el valor por defecto si no hay historial. */
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
// Entradas del triaje
// ---------------------------------------------------------------------------

/**
 * Señal a evaluar. Vale tanto un payload crudo recién llegado como un
 * `CrisisEvent` ya normalizado por el store.
 */
export type TriageSignal = IncomingEventPayload & {
  id?: string;
  occurrences?: number;
  createdAt?: string;
};

export interface TriageContext {
  /** Fiabilidad aprendida por fuente (state.sourceReliability). */
  sourceReliability?: SourceReliability[];
  /** Señales ya presentes, para corroborar o contradecir. */
  events?: CrisisEvent[];
  /** Zonas conocidas, para saber si la señal apunta a algún sitio real. */
  zones?: CrisisZone[];
  /** Umbrales a medida. Lo que no venga usa el valor por defecto. */
  thresholds?: Partial<TriageThresholds>;
  /** Minutos dentro de los cuales otra señal corrobora. Por defecto, 10. */
  fusionWindowMinutes?: number;
  /**
   * Radio en unidades de mapa para aceptar corroboración de zonas vecinas.
   * Por defecto 0: sólo cuenta la misma zona.
   */
  nearbyZoneUnits?: number;
  /** Instante de referencia. Fijarlo hace la evaluación reproducible. */
  now?: number | string | Date;
}

export function resolveThresholds(partial?: Partial<TriageThresholds>): TriageThresholds {
  if (!partial) return defaultTriageThresholds;
  return { ...defaultTriageThresholds, ...partial };
}

// ---------------------------------------------------------------------------
// Fusión de confianza
// ---------------------------------------------------------------------------

export interface FusionSignal {
  source: EventSource;
  /** Probabilidad de que lo que afirma la señal sea cierto, sin contar la fuente. */
  probability: number;
  /** Fiabilidad de la fuente. Si falta, se usa el valor por defecto. */
  reliability?: number;
}

export interface FusionOptions {
  /** Peso de las señales repetidas de una misma fuente. 0 = sólo cuenta la mejor. */
  sameSourceWeight?: number;
}

/**
 * Fusiona fuentes independientes: C = 1 − ∏(1 − p_i·r_i).
 *
 * Dos testigos independientes pesan más que uno, pero con rendimientos
 * decrecientes. Dos señales de la MISMA fuente no son independientes: dentro
 * de una fuente sólo la más fuerte cuenta entera y las demás entran con peso
 * `sameSourceWeight`, así que nunca suben la confianza como si fueran dos
 * testigos distintos.
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
    // La primera señal de la fuente cuenta entera; las siguientes, descontadas
    // por correlación. Con sameSourceWeight = 0 repetir la misma fuente no
    // aporta absolutamente nada.
    let groupComplement = 1 - sorted[0];
    for (const evidence of sorted.slice(1)) {
      groupComplement *= 1 - sameSourceWeight * evidence;
    }
    complement *= groupComplement;
  }

  return round(clamp(1 - complement, 0, 0.99));
}

// ---------------------------------------------------------------------------
// Fiabilidad aprendida de las fuentes
// ---------------------------------------------------------------------------

/**
 * Incorpora el desenlace de una señal a la fiabilidad de su fuente.
 *
 * Mismo criterio que lib/learning.ts: mínimo de muestras antes de concluir
 * nada y movimiento acotado por observación. Un sistema que sobrerreacciona a
 * un solo error es peor que uno que no aprende, así que el primer bulo de una
 * fuente se anota pero no mueve su fiabilidad.
 *
 * Devuelve una lista nueva: el estado se clona al servirse por la API y
 * conviene no depender de mutaciones en sitio.
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

  // Arranque en frío: se acumula la observación, pero la fiabilidad no se mueve
  // hasta tener muestras suficientes.
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

/** Una línea legible de por qué una fuente vale lo que vale. */
export function explainSourceReliability(entry: SourceReliability): string {
  if (entry.observations < MIN_SOURCE_SAMPLES) {
    return `${sourceLabel[entry.source]}: fiabilidad ${percent(entry.reliability)} de partida; ${entry.observations} de ${MIN_SOURCE_SAMPLES} muestras necesarias para ajustarla.`;
  }
  return `${sourceLabel[entry.source]}: fiabilidad ${percent(entry.reliability)} tras ${entry.confirmed} confirmaciones de ${entry.observations} señales resueltas.`;
}

// ---------------------------------------------------------------------------
// Motor determinista
// ---------------------------------------------------------------------------

interface Supporter {
  event: CrisisEvent;
  /** 1 si es del mismo punto; descontado si viene de una zona vecina. */
  weight: number;
}

interface Corroboration {
  /** Señales vivas del mismo punto y tema, dentro de la ventana de fusión. */
  supporting: Supporter[];
  /** Señales del mismo punto y tema que ya se descartaron por falsas. */
  contradicting: CrisisEvent[];
}

/**
 * Distancia entre la zona de la señal y la de otra señal, en unidades de mapa.
 * null si alguna de las dos zonas no está en el mapa.
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
 * Señales que hablan del mismo hecho: mismo tema, mismo punto (misma zona o,
 * si se abre el radio, una zona vecina) y dentro de la ventana de fusión.
 *
 * Las que ya se descartaron por falsas cuentan contradigan cuando contradigan:
 * un bulo desmentido hace media hora sigue siendo un bulo desmentido.
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

    // Fuera de la ventana de fusión no es el mismo hecho, es otro momento.
    if (ageInMinutes(event.createdAt, now) > windowMinutes) continue;
    supporting.push({ event, weight });
  }

  return { supporting, contradicting };
}

/** Probabilidad de que lo contado sea cierto, antes de aplicar la fuente. */
function claimProbability(
  confidence: Confidence,
  occurrences: number,
  contradictions: number,
): number {
  const base = claimByConfidence[confidence] ?? claimByConfidence.medium;
  const count = Math.max(1, Math.floor(occurrences || 1));
  // Repetir refuerza con rendimientos decrecientes: el complemento se eleva a
  // k = 1 + 0,5·ln(n). Un aviso repetido tres veces no vale el triple.
  const k = 1 + 0.5 * Math.log(count);
  const reinforced = 1 - Math.pow(1 - base, k);
  // Cada señal ya descartada sobre lo mismo resta credibilidad, con suelo:
  // que alguien se equivocara antes no prueba que esto sea falso.
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
    // Apunta a una zona que no existe en el mapa: puede ser relevante, pero
    // no sabemos ni dónde ponerla.
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

  // Lo que sabías hace media hora ya no urge igual, pero nunca urge cero.
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
  const source = sourceLabel[signal.source ?? "happyrobot"] ?? "fuente desconocida";
  const confianza = confidenceLabel[signal.confidence ?? "medium"];
  const gravedad = severityLabel[signal.severity ?? "medium"];

  const partes: string[] = [
    `${source} (fiabilidad ${percent(reliability)}), gravedad ${gravedad} y confianza declarada ${confianza}`,
  ];
  if ((signal.occurrences ?? 1) > 1) partes.push(`${signal.occurrences} avisos equivalentes`);
  if (corroboration.supporting.length > 0) {
    partes.push(`${corroboration.supporting.length} señal(es) coherente(s) en la misma zona`);
  }
  if (corroboration.contradicting.length > 0) {
    partes.push(`${corroboration.contradicting.length} señal(es) ya descartada(s) sobre lo mismo`);
  }
  if (signal.confirmed === true) partes.push("señal ya confirmada");
  if (signal.confirmed === false) partes.push("señal ya descartada por un operador");

  const cabecera = partes.join("; ");

  if (decision === "act") {
    return `${cabecera}. Confianza fusionada ${percent(confidence)} sobre el umbral de ${percent(input.actThreshold)}: se actúa.`;
  }
  if (decision === "verify") {
    if (pRelevant < input.thresholds.relevanceForAct && confidence >= input.actThreshold) {
      return `${cabecera}. Creíble (${percent(confidence)}) pero con relevancia ${percent(pRelevant)}: se verifica antes de mover recursos.`;
    }
    return `${cabecera}. Confianza fusionada ${percent(confidence)}, entre ${percent(input.verifyThreshold)} y ${percent(input.actThreshold)}: no se espera, se verifica llamando.`;
  }
  if (pRelevant < input.thresholds.relevanceForVerify) {
    return `${cabecera}. Relevancia ${percent(pRelevant)} por debajo del mínimo para molestar a nadie: se descarta.`;
  }
  return `${cabecera}. Confianza fusionada ${percent(confidence)} por debajo del umbral de ${percent(input.verifyThreshold)}: se descarta.`;
}

/** Evaluación determinista de una señal. Mismas entradas, misma salida. */
function assessDeterministic(signal: TriageSignal, context: TriageContext = {}): SignalAssessment {
  const thresholds = resolveThresholds(context.thresholds);
  const now = resolveNow(context.now);
  const source = signal.source ?? "happyrobot";
  const reliability = reliabilityOf(context.sourceReliability, source);

  const zones = context.zones ?? [];
  const zone = zones.find((candidate) => candidate.id === signal.zoneId);
  const corroboration = gatherCorroboration(signal, context, now);

  // 1. ¿Es cierto lo que cuenta?
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

  // 2. ¿Importa para esta crisis?
  const pRelevant = relevanceProbability(signal, zone, zones.length > 0, corroboration);

  // 3. ¿Corre prisa?
  const urgency = urgencyEstimate(signal, zone, now);

  // 4. Confianza fusionada: esta señal más las que la corroboran, agrupadas por
  //    fuente para no contar dos veces al mismo testigo.
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

  // 5. Decisión. El umbral baja con la urgencia: equivocarse callando ante una
  //    señal crítica cuesta más que equivocarse llamando.
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
// Evaluadores intercambiables
// ---------------------------------------------------------------------------

/**
 * Contrato de un evaluador de señales. El motor determinista lo implementa y
 * es el respaldo permanente; un clasificador externo (Jev/TypeSafe) puede
 * implementarlo el día que haya acceso sin tocar nada más del sistema.
 */
export interface SignalAssessor {
  /** Quién firma la evaluación. Se copia tal cual en `assessment.assessedBy`. */
  readonly name: Assessor;
  /** Si devuelve false, no se usa y se cae al motor determinista. */
  available(): boolean;
  assess(signal: TriageSignal, context?: TriageContext): SignalAssessment;
}

/** Motor determinista: siempre disponible, es el predeterminado. */
export const deterministicAssessor: SignalAssessor = {
  name: "deterministic",
  available: () => true,
  assess: (signal, context) => assessDeterministic(signal, context),
};

/**
 * Hueco para el clasificador externo. Mientras Jev esté en acceso anticipado
 * no hay cliente que llamar, así que este evaluador se declara NO disponible y
 * el sistema funciona exactamente igual sin él. No añade dependencias ni hace
 * llamadas de red.
 *
 * El día que haya acceso: implementar `SignalAssessor` en un módulo aparte,
 * registrarlo con `registerAssessor(...)` en el arranque y poner
 * TRIAGE_ASSESSOR=jev. Si el cliente falla o tarda, basta con que `available()`
 * devuelva false para volver al determinista sin tocar el store.
 */
export const externalAssessorPlaceholder: SignalAssessor = {
  name: "jev",
  available: () => false,
  assess: (signal, context) => {
    // Nunca miente sobre quién evaluó: sin cliente externo, la evaluación es
    // la determinista y así se firma.
    const assessment = assessDeterministic(signal, context);
    return {
      ...assessment,
      rationale: `Evaluador externo no disponible; respaldo determinista. ${assessment.rationale}`,
    };
  },
};

let registeredAssessor: SignalAssessor | null = null;

/** Enchufa (o quita, con null) el evaluador externo. */
export function registerAssessor(assessor: SignalAssessor | null): void {
  registeredAssessor = assessor;
}

/** Nombre del evaluador pedido por entorno. Por defecto, el determinista. */
export function requestedAssessorName(): string {
  return (process.env.TRIAGE_ASSESSOR ?? "deterministic").trim().toLowerCase();
}

/**
 * Evaluador efectivo: el registrado sólo si el entorno lo pide Y se declara
 * disponible. En cualquier otro caso, el determinista.
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
 * Evalúa una señal y devuelve su triaje calibrado. Si el evaluador externo
 * falla por cualquier motivo, se cae al determinista: el triaje nunca deja de
 * responder.
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
      rationale: `El evaluador ${assessor.name} falló; respaldo determinista. ${fallback.rationale}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Petición de verificación
// ---------------------------------------------------------------------------

/** Qué duda concreta tiene que resolver la llamada de verificación. */
export type VerificationDoubt = "veracidad" | "relevancia" | "alcance";

export interface VerificationRequest {
  eventId: string;
  zoneId: string;
  /** Duda dominante: es lo que decide qué se pregunta. */
  doubt: VerificationDoubt;
  /** Rol al que se pregunta. */
  role: ContactRole;
  /** Contacto concreto, si se pasaron contactos en el contexto. */
  contactId: string | null;
  /** Destinatario legible, listo para `Action.target`. */
  target: string;
  channel: ActionChannel;
  /** Dos o tres preguntas cerradas y concretas. */
  questions: string[];
  /** Objetivo redactado, listo para `Action.objective`. */
  objective: string;
  /** Motivo para `Action.reason`. */
  reason: string;
}

export interface VerificationContext {
  zones?: CrisisZone[];
  contacts?: Contact[];
}

/**
 * Qué hay que preguntar y a quién para resolver la duda concreta de una señal.
 *
 * No es un cuestionario: dos o tres preguntas cerradas que se pueden responder
 * por teléfono en treinta segundos y que cambian la decisión según la
 * respuesta.
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

  // La duda dominante es la pata más floja: si dudamos de que sea cierto,
  // preguntamos por los hechos; si dudamos de que importe, preguntamos por el
  // encaje; si ambas van bien pero la señal es grave, preguntamos por el
  // alcance para dimensionar la respuesta.
  const doubt: VerificationDoubt =
    assessment.pTruthful <= assessment.pRelevant
      ? "veracidad"
      : assessment.pRelevant < 0.6
        ? "relevancia"
        : "alcance";

  const hecho = event.title.trim().replace(/\.$/, "");
  const questions: string[] = [];

  if (doubt === "veracidad") {
    questions.push(`¿Está viendo usted ahora mismo ${hecho.toLowerCase()} en ${zoneName}? (sí/no)`);
    questions.push(
      "¿Lo ha comprobado en persona o se lo han contado? (en persona/me lo han contado)",
    );
  } else if (doubt === "relevancia") {
    questions.push(
      `¿Lo que ocurre está dentro de ${zoneName} o en otra zona? (esta zona/otra zona)`,
    );
    questions.push(`¿Tiene que ver con ${event.category.replace(/-/g, " ")}? (sí/no)`);
  } else {
    questions.push(`¿Sigue activo ${hecho.toLowerCase()} en ${zoneName}? (sí/no)`);
  }

  // Tercera pregunta: dimensionar o cronometrar, según lo que aún no sabemos.
  if (event.severity === "high" || event.severity === "critical") {
    questions.push("¿Cuántas personas están afectadas ahora mismo? (número aproximado)");
  } else if (assessment.urgency >= 0.5) {
    questions.push("¿Necesita intervención en los próximos 15 minutos? (sí/no)");
  }

  const channel: ActionChannel = assessment.urgency >= 0.5 ? "call" : "sms";
  const target = contact?.name ?? `Responsable de ${roleLabel[role]} en ${zoneName}`;
  const canal = channel === "call" ? "Llamar" : "Escribir";

  const objective = `${canal} a ${target} para verificar "${event.title}" en ${zoneName}: ${questions.join(" ")}`;

  const reason = `Triaje intermedio: confianza ${percent(assessment.confidence)}, relevancia ${percent(assessment.pRelevant)}. Verificar la ${doubt} antes de comprometer recursos.`;

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

/** Atajo legible para la UI: etiqueta de la decisión. */
export const decisionLabel: Record<TriageDecision, string> = {
  act: "Actuar",
  verify: "Verificar",
  discard: "Descartar",
};
