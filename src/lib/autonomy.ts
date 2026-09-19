// OWNER: graduated autonomy and opportunity cost agent.
//
// Two challenge questions are answered here:
//
//  1. "Decides and acts on its own". A system that asks permission for everything is
//     an assistant with buttons. One that never asks is not
//     supervisable. The solution is graduation by reversibility: what can be
//     undone is done autonomously by the system; what cannot be undone is signed
//     off by a human.
//  2. "You have three ambulances and five sites requesting them". Allocation leaves
//     someone waiting; here the waiting list is built detailing how long
//     each zone waits, why, and who took the resource.
//
// Design rules, in order of precedence:
//
//   a) `autonomyPaused` overrides everything. If an operator pauses autonomy,
//      absolutely everything requires human approval.
//   b) When in doubt, the most conservative level. An action that cannot be
//      classified, a missing rule, or an unknown confidence, always falls
//      back to `approval`. Never the reverse.
//   c) Irreversible actions are never automated, even with confidence 1.
//   d) An action already approved by a human is not degraded by the engine.
//
// Everything is deterministic: keyword tables and arithmetic. No language models
// and no randomness, so the same action always yields the same
// level and the rationale can be presented to a jury.

import { necesidadesDeAccion, rankResourcesForAction, resolveResourceConflicts } from "./resources";
import type {
  Action,
  ActionKind,
  AutonomyLevel,
  AutonomyRule,
  Confidence,
  CrisisEvent,
  CrisisZone,
  Resource,
  Reversibility,
  SituationState,
  WaitingDemand,
} from "./types";

// ---------------------------------------------------------------------------
// Tolerant inputs
// ---------------------------------------------------------------------------

/**
 * What this engine needs from an action. All optional by design: the
 * store calls before the action fully exists, and missing data
 * must push towards human approval, not crash.
 */
export type AccionParaAutonomia = Partial<
  Pick<
    Action,
    | "objective"
    | "channel"
    | "target"
    | "zoneId"
    | "resourceId"
    | "status"
    | "approvedBy"
    | "actionKind"
    | "verifiesEventId"
  >
>;

/** What is examined from the signal that prompted the action. */
export type SenalParaAutonomia = Partial<
  Pick<CrisisEvent, "id" | "category" | "confidence" | "confirmed" | "assessment">
>;

export interface AutonomyContext {
  /** Confidence 0..1 already calculated. Preempts any other source. */
  confidence?: number | null;
  /** Signal that prompted the action; yields category and confidence. */
  event?: SenalParaAutonomia | null;
  /** Explicit category, when known without having the signal. */
  category?: string | null;
  /** Global state switch. */
  autonomyPaused?: boolean;
}

/** State slice sufficient for decision making. */
export type EstadoParaAutonomia = Pick<SituationState, "autonomyRules" | "autonomyPaused"> &
  Partial<Pick<SituationState, "events">>;

export interface AutonomyDecision {
  level: AutonomyLevel;
  actionKind: ActionKind | null;
  reversibility: Reversibility | null;
  rule: AutonomyRule | null;
  /** Confidence used when deciding, 0..1, or null if unknown. */
  confidence: number | null;
  /** Reason in Spanish, formatted for display on screen. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Readable labels
// ---------------------------------------------------------------------------

export const ETIQUETA_NIVEL: Record<AutonomyLevel, string> = {
  auto: "Se ejecuta sola",
  "auto-notify": "Se ejecuta sola y avisa",
  approval: "Requiere aprobación humana",
};

export const ETIQUETA_REVERSIBILIDAD: Record<Reversibility, string> = {
  reversible: "reversible",
  partial: "parcialmente reversible",
  irreversible: "irreversible",
};

/** How each action kind is named within a sentence. */
export const ETIQUETA_TIPO: Record<ActionKind, string> = {
  verificar: "comprobar un dato",
  avisar: "avisar a un responsable",
  "asignar-recurso": "mover un recurso",
  "aviso-masivo": "avisar a la población",
  evacuar: "ordenar una evacuación",
  escalar: "pedir refuerzos externos",
};

function porcentaje(valor: number) {
  return `${Math.round(valor * 100)} %`;
}

/** Removes accents and converts to lowercase to compare free text. */
function normalizar(texto: string) {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Types table, ordered from most severe to least severe consequence. The first
 * match wins, so an action with traces of both evacuation and resource
 * allocation defaults to evacuation, which is conservative.
 *
 * Beware of two traps in this repository:
 *
 *  - store.ts writes ALL objectives as "Coordinar respuesta de
 *    <categoría> en <zona>". The word "coordinar" always appears, so it
 *    cannot be a keyword for anything: it would turn every action into an alert. The
 *    useful signal is the category, extracted from the objective itself. The resource
 *    agent encountered the same thing and documented it in resources.ts.
 *  - nearly all actions carry `resourceId`, because the store assigns a
 *    resource upon proposing them. Having a resource is NOT proof that the action is
 *    "asignar-recurso"; hence that field is not used as a signal.
 */
const TABLA_TIPOS: { tipo: ActionKind; claves: string[] }[] = [
  {
    tipo: "evacuar",
    claves: ["evacua", "desaloj", "realoj", "rescate", "vulnerable", "evacuation-support"],
  },
  {
    tipo: "escalar",
    claves: [
      "escala",
      "escalar",
      "refuerzo",
      "apoyo externo",
      "ayuda externa",
      "mando unico",
      "escasez",
      "resource-shortage",
      "ume",
    ],
  },
  {
    tipo: "aviso-masivo",
    claves: [
      "aviso masivo",
      "aviso a la poblacion",
      "alerta a la poblacion",
      "alerta publica",
      "alerta masiva",
      "bando municipal",
      "poblacion general",
      "vecindario",
      "vecinos",
      "residentes",
      "ciudadania",
    ],
  },
  {
    tipo: "verificar",
    claves: ["verifica", "comprueb", "comproba", "contrast", "confirmar", "cotejar"],
  },
  {
    tipo: "asignar-recurso",
    claves: [
      "asignar",
      "asignacion",
      "desplegar",
      "despliegue",
      "reasign",
      "enviar unidad",
      "incendio",
      "fuego",
      "extincion",
      "inundacion",
      "apagon",
      "logistic",
      "transporte",
      "refugio",
      "suministro",
      "triaje",
      "sanitari",
      "route-blocked",
      "ruta bloqueada",
    ],
  },
  {
    tipo: "avisar",
    claves: [
      "avisar",
      "aviso",
      "informar",
      "notificar",
      "coordinacion",
      "comunicaciones",
      "enlace",
      "seguimiento",
      "responsable",
    ],
  },
];

/** Recipients that are not a specific individual but a collective. */
const DESTINATARIOS_COLECTIVOS = [
  "poblacion",
  "vecinos",
  "residentes",
  "ciudadania",
  "abonados",
  "usuarios",
];

/** Channels used to broadcast a mass alert. */
const CANALES_DE_DIFUSION = new Set(["sms", "whatsapp", "email"]);

/**
 * Category of the signal behind the action. Explicit data is preferred;
 * otherwise extracted from the objective composed by the store.
 */
export function categoriaDeAccion(
  action: AccionParaAutonomia,
  context: AutonomyContext = {},
): string | null {
  if (context.category) return context.category;
  if (context.event?.category) return context.event.category;

  const objetivo = action.objective ?? "";
  // "Coordinar respuesta de <categoría> en <zona>."
  const extraida = /respuesta de (.+?) en /i.exec(objetivo);
  if (extraida) return extraida[1].trim();

  return null;
}

function coincide(texto: string, claves: string[]) {
  return claves.some((clave) => texto.includes(clave));
}

/**
 * Deduce the action kind from category, objective, channel, and
 * recipient. Returns null when signal is insufficient: caller
 * must treat null as "human approval", never "proceed".
 */
export function classifyAction(
  action: AccionParaAutonomia,
  context: AutonomyContext = {},
): ActionKind | null {
  // If someone already declared the type, respect it: more reliable than guessing.
  if (action.actionKind) return action.actionKind;

  const categoria = categoriaDeAccion(action, context);
  const partes = [categoria, action.objective, action.target].filter(
    (parte): parte is string => typeof parte === "string" && parte.length > 0,
  );
  if (partes.length === 0) return null;

  const texto = normalizar(partes.join(" · "));

  for (const grupo of TABLA_TIPOS) {
    if (grupo.tipo === "aviso-masivo") {
      // An alert sent via broadcast channel to a collective is mass even if
      // text does not explicitly say so.
      const colectivo = coincide(texto, DESTINATARIOS_COLECTIVOS);
      const difusion = action.channel ? CANALES_DE_DIFUSION.has(action.channel) : false;
      if (coincide(texto, grupo.claves) || (colectivo && difusion)) return "aviso-masivo";
      continue;
    }

    if (grupo.tipo === "verificar") {
      // An action opened to resolve doubt about a signal is a
      // verification, but only if it didn't match something more severe first.
      if (action.verifiesEventId) return "verificar";
      if (coincide(texto, grupo.claves)) return "verificar";
      continue;
    }

    if (coincide(texto, grupo.claves)) return grupo.tipo;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/** Maps confidence label to number, when calibrated triage is absent. */
const ESCALA_CONFIANZA: Record<Confidence, number> = {
  low: 0.35,
  medium: 0.6,
  high: 0.85,
};

/**
 * Confidence 0..1 used for decision. In order: explicit value,
 * calibrated signal triage, and as last resort confidence label
 * adjusted for verification. null = unknown, which pushes to approval.
 */
export function confianzaDeContexto(context: AutonomyContext = {}): number | null {
  if (typeof context.confidence === "number" && Number.isFinite(context.confidence)) {
    return Math.min(1, Math.max(0, context.confidence));
  }

  const event = context.event;
  if (!event) return null;

  if (
    typeof event.assessment?.confidence === "number" &&
    Number.isFinite(event.assessment.confidence)
  ) {
    return Math.min(1, Math.max(0, event.assessment.confidence));
  }

  // A discarded signal supports nothing; one confirmed by a human or a
  // sensor is worth more than its source label.
  if (event.confirmed === false) return 0.1;
  if (!event.confidence) return event.confirmed === true ? 0.95 : null;

  const base = ESCALA_CONFIANZA[event.confidence];
  return event.confirmed === true ? Math.max(base, 0.95) : base;
}

// ---------------------------------------------------------------------------
// Autonomy decision
// ---------------------------------------------------------------------------

function decisionDeAprobacion(
  reason: string,
  actionKind: ActionKind | null,
  rule: AutonomyRule | null,
  confidence: number | null,
): AutonomyDecision {
  return {
    level: "approval",
    actionKind,
    reversibility: rule?.reversibility ?? null,
    rule,
    confidence,
    reason,
  };
}

/**
 * Decides what level of autonomy to dispatch an action with and why.
 *
 * Check order embodies the policy: global pause, previous human
 * decision, classification, rule, reversibility, and confidence threshold.
 */
export function decideAutonomy(
  action: AccionParaAutonomia,
  rules: AutonomyRule[] | null | undefined,
  context: AutonomyContext = {},
): AutonomyDecision {
  const kind = classifyAction(action, context);
  const confidence = confianzaDeContexto(context);
  const rule =
    kind && Array.isArray(rules) ? (rules.find((item) => item.actionKind === kind) ?? null) : null;

  // a) Global switch overrides everything else.
  if (context.autonomyPaused) {
    return decisionDeAprobacion(
      "Espera aprobación humana porque la autonomía está en pausa: un operador ha detenido el despacho automático y ninguna acción sale sola hasta que la reanude.",
      kind,
      rule,
      confidence,
    );
  }

  // d) What a human already signed off on is not degraded by the engine.
  if (action.approvedBy === "operator" || (action.approvedBy && action.approvedBy !== "system")) {
    return {
      level: "auto",
      actionKind: kind,
      reversibility: rule?.reversibility ?? null,
      rule,
      confidence,
      reason: `Ya la aprobó una persona (${action.approvedBy}); el motor de autonomía no degrada una decisión humana.`,
    };
  }

  // b) Without classification, no automation.
  if (!kind) {
    const objetivo = action.objective ? ` ("${action.objective}")` : "";
    return decisionDeAprobacion(
      `Espera aprobación humana porque no se ha podido clasificar el tipo de acción${objetivo}. Ante la duda se elige siempre el nivel más conservador.`,
      null,
      null,
      confidence,
    );
  }

  if (!rule) {
    return decisionDeAprobacion(
      `Espera aprobación humana porque no hay ninguna regla de autonomía vigente para "${kind}". Sin regla escrita, decide una persona.`,
      kind,
      null,
      confidence,
    );
  }

  const etiqueta = ETIQUETA_TIPO[kind];
  const reversibilidad = ETIQUETA_REVERSIBILIDAD[rule.reversibility];

  // c) Irreversible actions are never automated, even with confidence 1.
  if (rule.reversibility === "irreversible") {
    return decisionDeAprobacion(
      `Espera aprobación humana porque ${etiqueta} es irreversible: no hay forma de deshacerlo una vez hecho. ${rule.rationale}`,
      kind,
      rule,
      confidence,
    );
  }

  // Confidence threshold: partially reversible only automated if
  // information is very high quality. If confidence is unknown, it doesn't proceed.
  if (typeof rule.confidenceThreshold === "number") {
    if (confidence === null) {
      return decisionDeAprobacion(
        `Espera aprobación humana porque ${etiqueta} es ${reversibilidad} y exige confianza ≥ ${porcentaje(
          rule.confidenceThreshold,
        )}, pero no se conoce la confianza de la señal. Ante la duda se elige el nivel más conservador.`,
        kind,
        rule,
        confidence,
      );
    }

    if (confidence < rule.confidenceThreshold) {
      return decisionDeAprobacion(
        `Espera aprobación humana porque ${etiqueta} es ${reversibilidad} y la confianza es ${porcentaje(
          confidence,
        )}, por debajo del ${porcentaje(rule.confidenceThreshold)} exigido para hacerlo sin preguntar. ${rule.rationale}`,
        kind,
        rule,
        confidence,
      );
    }

    // Exceeds threshold: automated, but always notifying. Even if written
    // rule says "approval", the threshold is precisely the gate opening it.
    const level: AutonomyLevel = rule.level === "auto" ? "auto" : "auto-notify";
    return {
      level,
      actionKind: kind,
      reversibility: rule.reversibility,
      rule,
      confidence,
      reason: `Se ejecuta sola y se avisa al operador: la confianza es ${porcentaje(
        confidence,
      )} y supera el ${porcentaje(rule.confidenceThreshold)} que ${etiqueta} exige. ${rule.rationale}`,
    };
  }

  if (rule.level === "approval") {
    return decisionDeAprobacion(
      `Espera aprobación humana porque la política vigente reserva ${etiqueta} a una persona. ${rule.rationale}`,
      kind,
      rule,
      confidence,
    );
  }

  const cola =
    rule.level === "auto"
      ? "y queda registrada en la auditoría"
      : "se avisa al operador y una persona puede deshacerla";

  return {
    level: rule.level,
    actionKind: kind,
    reversibility: rule.reversibility,
    rule,
    confidence,
    reason: `Se ejecuta sola porque ${etiqueta} es ${reversibilidad}, ${cola}. ${rule.rationale}`,
  };
}

// ---------------------------------------------------------------------------
// Guardian for the store
// ---------------------------------------------------------------------------

/** Finds the signal explaining an action, to inspect its confidence. */
function senalDeLaAccion(action: AccionParaAutonomia, events: CrisisEvent[] | undefined) {
  if (!events || events.length === 0) return null;

  if (action.verifiesEventId) {
    const directa = events.find((event) => event.id === action.verifiesEventId);
    if (directa) return directa;
  }

  const objetivo = normalizar(action.objective ?? "");
  if (!action.zoneId || objetivo.length === 0) return null;

  // The most recent in the zone whose category appears in the objective:
  // exactly the one the store used to compose it.
  return (
    events.find(
      (event) =>
        event.zoneId === action.zoneId &&
        event.confirmed !== false &&
        objetivo.includes(normalizar(event.category)),
    ) ?? null
  );
}

/**
 * Complete decision from state, with signal and pause already resolved.
 * Store must use this to stamp `action.autonomy` and write
 * rationale to audit log.
 */
export function autonomyDecisionFor(
  action: AccionParaAutonomia | null | undefined,
  state: EstadoParaAutonomia | null | undefined,
): AutonomyDecision {
  if (!action || !state) {
    return decisionDeAprobacion(
      "Espera aprobación humana porque falta información para decidir la autonomía.",
      null,
      null,
      null,
    );
  }

  return decideAutonomy(action, state.autonomyRules, {
    event: senalDeLaAccion(action, state.events),
    autonomyPaused: state.autonomyPaused === true,
  });
}

/**
 * One-line guardian: can this action be dispatched without asking?
 *
 * Written to be impossible to bypass accidentally. Any gap
 * (no action, no state, no rules, no objective, status other than
 * "pending", active pause or undefined `autonomyPaused`) returns false.
 */
export function canAutoDispatch(
  action: AccionParaAutonomia | null | undefined,
  state: EstadoParaAutonomia | null | undefined,
): boolean {
  if (!action || !state) return false;
  if (!Array.isArray(state.autonomyRules) || state.autonomyRules.length === 0) return false;
  // Requires explicit false: a state without the switch is not a state
  // with autonomy enabled.
  if (state.autonomyPaused !== false) return false;
  if (!action.objective) return false;
  // Only newly proposed actions can be auto-dispatched. Everything else already has an owner.
  if (action.status !== "pending") return false;

  return autonomyDecisionFor(action, state).level !== "approval";
}

// ---------------------------------------------------------------------------
// Readable policy
// ---------------------------------------------------------------------------

export interface AutonomyPolicyLine {
  actionKind: ActionKind;
  level: AutonomyLevel;
  reversibility: Reversibility;
  levelLabel: string;
  reversibilityLabel: string;
  /** Complete sentence, ready for display. */
  text: string;
}

export interface AutonomyPolicySummary {
  headline: string;
  lines: AutonomyPolicyLine[];
}

/**
 * Readable summary of current policy. Supervision only counts if
 * understood: this is rendered on screen next to the toggle.
 */
export function describeAutonomy(
  rules: AutonomyRule[] | null | undefined,
  options: { paused?: boolean } = {},
): AutonomyPolicySummary {
  const vigentes = Array.isArray(rules) ? rules : [];

  const lines = vigentes.map<AutonomyPolicyLine>((rule) => {
    const levelLabel = ETIQUETA_NIVEL[rule.level];
    const reversibilityLabel = ETIQUETA_REVERSIBILIDAD[rule.reversibility];
    const umbral =
      typeof rule.confidenceThreshold === "number"
        ? `, y solo sin preguntar con confianza ≥ ${porcentaje(rule.confidenceThreshold)}`
        : "";

    return {
      actionKind: rule.actionKind,
      level: rule.level,
      reversibility: rule.reversibility,
      levelLabel,
      reversibilityLabel,
      text: `${ETIQUETA_TIPO[rule.actionKind]}: ${levelLabel.toLowerCase()} porque es ${reversibilityLabel}${umbral}. ${rule.rationale}`,
    };
  });

  if (vigentes.length === 0) {
    return {
      headline: "Sin política de autonomía cargada: todas las acciones esperan aprobación humana.",
      lines,
    };
  }

  if (options.paused) {
    return {
      headline: `Autonomía en pausa: los ${vigentes.length} tipos de acción esperan aprobación humana hasta que un operador la reanude.`,
      lines,
    };
  }

  const solas = vigentes.filter((rule) => rule.level !== "approval").length;
  const conUmbral = vigentes.filter(
    (rule) => rule.level === "approval" && typeof rule.confidenceThreshold === "number",
  ).length;
  const humanas = vigentes.length - solas - conUmbral;

  const partes = [
    `${solas} de ${vigentes.length} tipos de acción se ejecutan solos por ser reversibles`,
  ];
  if (conUmbral > 0) partes.push(`${conUmbral} solo con confianza muy alta`);
  if (humanas > 0) partes.push(`${humanas} los firma siempre una persona`);

  return { headline: `${partes.join("; ")}.`, lines };
}

// ---------------------------------------------------------------------------
// Opportunity cost: who waits, how long, and why
// ---------------------------------------------------------------------------

/**
 * How long a resource is occupied by a task, based on the primary need covered.
 * Planning minutes, not simulation: used to sort the queue
 * and inform operator whether a zone waits ten minutes or nearly an hour.
 */
const MINUTOS_POR_NECESIDAD: Record<string, number> = {
  extincion: 45,
  campo: 35,
  "evaluacion de monte": 20,
  evacuacion: 30,
  transporte: 25,
  refugio: 35,
  triaje: 25,
  sanitario: 25,
  "alerta publica": 10,
  comunicaciones: 15,
  coordinacion: 15,
};

const MINUTOS_POR_DEFECTO = 20;

/** Estimated minutes an action will occupy its requested resource. */
export function duracionEstimadaMinutos(action: Pick<Action, "objective" | "channel">): number {
  const principal = necesidadesDeAccion(action.objective ?? "", action.channel)[0];
  return MINUTOS_POR_NECESIDAD[principal] ?? MINUTOS_POR_DEFECTO;
}

/**
 * Waiting list ready for state: who is without a resource, which was
 * requested, who took it, how long the wait will be, and why.
 *
 * Wraps `resolveResourceConflicts` from resource agent, which allocates
 * and drafts reasons. Only adds what allocation doesn't provide: desired
 * resource and wait estimation.
 */
export function buildWaitingList(
  actions: Action[],
  resources: Resource[],
  zones: CrisisZone[],
): WaitingDemand[] {
  return construirEspera(
    resolveResourceConflicts(actions, resources, zones).waiting,
    actions,
    resources,
    zones,
  );
}

/** Translates allocation wait to `WaitingDemand[]`, including estimation. */
function construirEspera(
  waiting: ReturnType<typeof resolveResourceConflicts>["waiting"],
  actions: Action[],
  resources: Resource[],
  zones: CrisisZone[],
): WaitingDemand[] {
  const porId = new Map(actions.map((action) => [action.id, action]));
  const nombreRecurso = new Map(resources.map((resource) => [resource.id, resource.name]));
  // How many zones are already ahead in queue for each resource.
  const colaPorRecurso = new Map<string, number>();

  return waiting.map((item) => {
    const action = porId.get(item.actionId);
    const peticion = action
      ? { zoneId: action.zoneId, objective: action.objective, channel: action.channel }
      : null;

    // Which resource this action would want without competition.
    const deseado = peticion
      ? (rankResourcesForAction(peticion, resources, zones).find(
          (candidato) => candidato.compatible && candidato.resource.status !== "unavailable",
        ) ?? null)
      : null;
    const wantedResourceId = deseado?.resource.id ?? null;

    const bloqueante = item.blockedByActionId ? (porId.get(item.blockedByActionId) ?? null) : null;

    let estimatedWaitMinutes: number | null = null;
    let detalle: string;

    if (!bloqueante || !wantedResourceId) {
      // Nobody holds this resource because none capable and free exists: wait
      // does not depend on a task finishing, but on external support arriving.
      detalle =
        " Sin espera estimable: ningún recurso capaz puede liberarse para esta zona, hace falta apoyo externo.";
    } else {
      const porDelante = colaPorRecurso.get(wantedResourceId) ?? 0;
      const propia = action ? duracionEstimadaMinutos(action) : MINUTOS_POR_DEFECTO;
      const enCurso = duracionEstimadaMinutos(bloqueante);
      estimatedWaitMinutes = enCurso + porDelante * propia;
      colaPorRecurso.set(wantedResourceId, porDelante + 1);

      const nombre = nombreRecurso.get(wantedResourceId) ?? wantedResourceId;
      const cola =
        porDelante > 0
          ? ` y hay ${porDelante} ${porDelante === 1 ? "zona" : "zonas"} por delante en la cola`
          : "";
      detalle = ` Espera estimada: ~${estimatedWaitMinutes} min, porque ${nombre} tiene tarea para ~${enCurso} min${cola}.`;
    }

    return {
      actionId: item.actionId,
      zoneId: item.zoneId,
      wantedResourceId,
      blockedByActionId: item.blockedByActionId,
      estimatedWaitMinutes,
      reason: `${item.reason}${detalle}`,
    };
  });
}

/**
 * Waiting list plus allocation Spanish summary, avoiding double allocation
 * when UI requests both.
 */
export function buildWaitingReport(actions: Action[], resources: Resource[], zones: CrisisZone[]) {
  const resolution = resolveResourceConflicts(actions, resources, zones);
  return {
    waiting: construirEspera(resolution.waiting, actions, resources, zones),
    allocations: resolution.allocations,
    summary: resolution.summary,
  };
}
