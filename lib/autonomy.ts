// PROPIETARIO: agente de autonomía graduada y coste de oportunidad.
//
// Dos preguntas del reto se responden aquí:
//
//  1. "Decide y actúa por su cuenta". Un sistema que pide permiso para todo es
//     un asistente con botones. Uno que no lo pide para nada no es
//     supervisable. La salida es graduar por reversibilidad: lo que se puede
//     deshacer lo hace el sistema solo, lo que no se puede deshacer lo firma
//     una persona.
//  2. "Tienes tres ambulancias y cinco sitios pidiéndolas". Repartir deja a
//     alguien esperando; aquí se construye la lista de espera con cuánto
//     espera cada zona, por qué y quién se llevó el recurso.
//
// Reglas de diseño, en este orden de mando:
//
//   a) `autonomyPaused` manda sobre todo. Si un operador para la autonomía,
//      absolutamente todo pasa a aprobación humana.
//   b) Ante la duda, el nivel más conservador. Una acción que no se puede
//      clasificar, o una regla que falta, o una confianza desconocida, caen
//      siempre en `approval`. Nunca al revés.
//   c) Lo irreversible no se automatiza jamás, ni con confianza 1.
//   d) Una acción que ya aprobó una persona no la degrada el motor.
//
// Todo es determinista: tablas de palabras clave y aritmética. Sin modelos de
// lenguaje y sin aleatoriedad, para que la misma acción dé siempre el mismo
// nivel y el motivo se pueda enseñar a un jurado.

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
// Entradas tolerantes
// ---------------------------------------------------------------------------

/**
 * Lo que este motor necesita de una acción. Todo opcional a propósito: el
 * store llama antes de que la acción exista del todo, y la falta de datos
 * tiene que empujar hacia la aprobación humana, no reventar.
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

/** Lo que se mira de la señal que originó la acción. */
export type SenalParaAutonomia = Partial<
  Pick<CrisisEvent, "id" | "category" | "confidence" | "confirmed" | "assessment">
>;

export interface AutonomyContext {
  /** Confianza 0..1 ya calculada. Manda sobre cualquier otra fuente. */
  confidence?: number | null;
  /** Señal que originó la acción; de ella salen categoría y confianza. */
  event?: SenalParaAutonomia | null;
  /** Categoría explícita, cuando se conoce sin tener la señal delante. */
  category?: string | null;
  /** Interruptor general del estado. */
  autonomyPaused?: boolean;
}

/** Trozo de estado que basta para decidir. */
export type EstadoParaAutonomia = Pick<SituationState, "autonomyRules" | "autonomyPaused"> &
  Partial<Pick<SituationState, "events">>;

export interface AutonomyDecision {
  level: AutonomyLevel;
  actionKind: ActionKind | null;
  reversibility: Reversibility | null;
  rule: AutonomyRule | null;
  /** Confianza usada al decidir, 0..1, o null si no se conocía. */
  confidence: number | null;
  /** Motivo en español, escrito para enseñarlo en pantalla. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Etiquetas legibles
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

/** Cómo se nombra cada tipo de acción dentro de una frase. */
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

/** Quita acentos y baja a minúsculas para poder comparar texto libre. */
function normalizar(texto: string) {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// ---------------------------------------------------------------------------
// Clasificación
// ---------------------------------------------------------------------------

/**
 * Tabla de tipos, ordenada de consecuencia más grave a más leve. La primera
 * coincidencia gana, así que una acción que huele a evacuación y a asignación
 * de recurso a la vez se queda en evacuación, que es lo conservador.
 *
 * Ojo con dos trampas de este repositorio:
 *
 *  - store.ts redacta TODOS los objetivos como "Coordinar respuesta de
 *    <categoría> en <zona>". La palabra "coordinar" aparece siempre, así que
 *    no puede ser clave de nada: convertiría cualquier acción en un aviso. La
 *    señal útil es la categoría, que se extrae del propio objetivo. El agente
 *    de recursos se topó con lo mismo y lo dejó documentado en resources.ts.
 *  - casi todas las acciones llevan `resourceId`, porque el store asigna un
 *    recurso al proponerlas. Llevar recurso NO es prueba de que la acción sea
 *    "asignar-recurso"; por eso el campo no se usa como señal.
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

/** Destinatarios que no son una persona concreta sino un colectivo. */
const DESTINATARIOS_COLECTIVOS = [
  "poblacion",
  "vecinos",
  "residentes",
  "ciudadania",
  "abonados",
  "usuarios",
];

/** Canales por los que se puede lanzar un aviso masivo. */
const CANALES_DE_DIFUSION = new Set(["sms", "whatsapp", "email"]);

/**
 * Categoría de la señal que hay detrás de la acción. Se prefiere el dato
 * explícito; si no lo hay, se extrae del objetivo que redacta el store.
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
 * Deduce el tipo de acción a partir de la categoría, el objetivo, el canal y
 * el destinatario. Devuelve null cuando no hay señal suficiente: quien llama
 * tiene que tratar ese null como "aprobación humana", nunca como "adelante".
 */
export function classifyAction(
  action: AccionParaAutonomia,
  context: AutonomyContext = {},
): ActionKind | null {
  // Si alguien ya declaró el tipo, se respeta: es más fiable que adivinarlo.
  if (action.actionKind) return action.actionKind;

  const categoria = categoriaDeAccion(action, context);
  const partes = [categoria, action.objective, action.target].filter(
    (parte): parte is string => typeof parte === "string" && parte.length > 0,
  );
  if (partes.length === 0) return null;

  const texto = normalizar(partes.join(" · "));

  for (const grupo of TABLA_TIPOS) {
    if (grupo.tipo === "aviso-masivo") {
      // Un aviso por canal de difusión a un colectivo es masivo aunque el
      // texto no lo diga con esas palabras.
      const colectivo = coincide(texto, DESTINATARIOS_COLECTIVOS);
      const difusion = action.channel ? CANALES_DE_DIFUSION.has(action.channel) : false;
      if (coincide(texto, grupo.claves) || (colectivo && difusion)) return "aviso-masivo";
      continue;
    }

    if (grupo.tipo === "verificar") {
      // Una acción abierta para resolver la duda sobre una señal es una
      // verificación, pero solo si no ha encajado antes en algo más grave.
      if (action.verifiesEventId) return "verificar";
      if (coincide(texto, grupo.claves)) return "verificar";
      continue;
    }

    if (coincide(texto, grupo.claves)) return grupo.tipo;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Confianza
// ---------------------------------------------------------------------------

/** Traducción de la etiqueta de confianza a número, cuando no hay triaje calibrado. */
const ESCALA_CONFIANZA: Record<Confidence, number> = {
  low: 0.35,
  medium: 0.6,
  high: 0.85,
};

/**
 * Confianza 0..1 con la que se decide. Por orden: el valor explícito, el
 * triaje calibrado de la señal, y como último recurso la etiqueta de
 * confianza corregida por la verificación. null = no se sabe, y no saber
 * empuja a aprobación.
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

  // Una señal descartada no sostiene nada; una confirmada por una persona o un
  // sensor vale más que su etiqueta de origen.
  if (event.confirmed === false) return 0.1;
  if (!event.confidence) return event.confirmed === true ? 0.95 : null;

  const base = ESCALA_CONFIANZA[event.confidence];
  return event.confirmed === true ? Math.max(base, 0.95) : base;
}

// ---------------------------------------------------------------------------
// Decisión de autonomía
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
 * Decide con qué nivel de autonomía se despacha una acción y por qué.
 *
 * El orden de las comprobaciones es la política: pausa general, decisión
 * humana previa, clasificación, regla, reversibilidad y umbral de confianza.
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

  // a) El interruptor general manda sobre todo lo demás.
  if (context.autonomyPaused) {
    return decisionDeAprobacion(
      "Espera aprobación humana porque la autonomía está en pausa: un operador ha detenido el despacho automático y ninguna acción sale sola hasta que la reanude.",
      kind,
      rule,
      confidence,
    );
  }

  // d) Lo que ya firmó una persona no lo degrada el motor.
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

  // b) Sin clasificación no hay automatismo.
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

  // c) Lo irreversible nunca se automatiza, ni con confianza 1.
  if (rule.reversibility === "irreversible") {
    return decisionDeAprobacion(
      `Espera aprobación humana porque ${etiqueta} es irreversible: no hay forma de deshacerlo una vez hecho. ${rule.rationale}`,
      kind,
      rule,
      confidence,
    );
  }

  // Umbral de confianza: lo parcialmente reversible solo sale solo si la
  // información es muy buena. Si no se conoce la confianza, no sale.
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

    // Supera el umbral: se automatiza, pero avisando siempre. Aunque la regla
    // escrita diga "approval", el umbral es justo la puerta que la abre.
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
// Guardián para el store
// ---------------------------------------------------------------------------

/** Busca la señal que explica una acción, para poder mirar su confianza. */
function senalDeLaAccion(action: AccionParaAutonomia, events: CrisisEvent[] | undefined) {
  if (!events || events.length === 0) return null;

  if (action.verifiesEventId) {
    const directa = events.find((event) => event.id === action.verifiesEventId);
    if (directa) return directa;
  }

  const objetivo = normalizar(action.objective ?? "");
  if (!action.zoneId || objetivo.length === 0) return null;

  // La más reciente de la zona cuya categoría aparece en el objetivo: es
  // justamente la que el store usó para redactarlo.
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
 * Decisión completa a partir del estado, con la señal y la pausa ya resueltas.
 * Es lo que el store debe usar para sellar `action.autonomy` y para escribir
 * el motivo en la auditoría.
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
 * Guardián de una sola línea: ¿se puede despachar esta acción sin preguntar?
 *
 * Está escrito para ser imposible de saltarse por accidente. Cualquier hueco
 * (sin acción, sin estado, sin reglas, sin objetivo, estado de acción que no
 * sea "pending", pausa activa o `autonomyPaused` indefinido) devuelve false.
 */
export function canAutoDispatch(
  action: AccionParaAutonomia | null | undefined,
  state: EstadoParaAutonomia | null | undefined,
): boolean {
  if (!action || !state) return false;
  if (!Array.isArray(state.autonomyRules) || state.autonomyRules.length === 0) return false;
  // Se exige un false explícito: un estado sin el interruptor no es un estado
  // con la autonomía encendida.
  if (state.autonomyPaused !== false) return false;
  if (!action.objective) return false;
  // Solo se despacha sola una acción recién propuesta. Lo demás ya tiene dueño.
  if (action.status !== "pending") return false;

  return autonomyDecisionFor(action, state).level !== "approval";
}

// ---------------------------------------------------------------------------
// Política legible
// ---------------------------------------------------------------------------

export interface AutonomyPolicyLine {
  actionKind: ActionKind;
  level: AutonomyLevel;
  reversibility: Reversibility;
  levelLabel: string;
  reversibilityLabel: string;
  /** Frase completa, lista para pintar. */
  text: string;
}

export interface AutonomyPolicySummary {
  headline: string;
  lines: AutonomyPolicyLine[];
}

/**
 * Resumen legible de la política vigente. La supervisión solo cuenta si se
 * entiende: esto es lo que se pinta en pantalla al lado del interruptor.
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
// Coste de oportunidad: quién espera, cuánto y por qué
// ---------------------------------------------------------------------------

/**
 * Cuánto ocupa un recurso una tarea, por la necesidad principal que cubre.
 * Son minutos de planificación, no una simulación: sirven para ordenar la cola
 * y para decirle al operador si una zona espera diez minutos o casi una hora.
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

/** Minutos estimados que una acción tendrá ocupado el recurso que pide. */
export function duracionEstimadaMinutos(action: Pick<Action, "objective" | "channel">): number {
  const principal = necesidadesDeAccion(action.objective ?? "", action.channel)[0];
  return MINUTOS_POR_NECESIDAD[principal] ?? MINUTOS_POR_DEFECTO;
}

/**
 * Lista de espera lista para el estado: quién se queda sin recurso, cuál
 * quería, quién se lo llevó, cuánto tendrá que esperar y por qué.
 *
 * Envuelve `resolveResourceConflicts` del agente de recursos, que es quien
 * reparte y redacta el motivo. Aquí solo se añade lo que el reparto no da: el
 * recurso deseado y la estimación de espera.
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

/** Traduce la espera del reparto a `WaitingDemand[]`, con estimación incluida. */
function construirEspera(
  waiting: ReturnType<typeof resolveResourceConflicts>["waiting"],
  actions: Action[],
  resources: Resource[],
  zones: CrisisZone[],
): WaitingDemand[] {
  const porId = new Map(actions.map((action) => [action.id, action]));
  const nombreRecurso = new Map(resources.map((resource) => [resource.id, resource.name]));
  // Cuántas zonas van ya por delante en la cola de cada recurso.
  const colaPorRecurso = new Map<string, number>();

  return waiting.map((item) => {
    const action = porId.get(item.actionId);
    const peticion = action
      ? { zoneId: action.zoneId, objective: action.objective, channel: action.channel }
      : null;

    // Qué recurso querría esta acción si no hubiera competencia.
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
      // Nadie tiene ese recurso porque no existe uno capaz y libre: la espera
      // no depende de una tarea que termine, sino de que llegue apoyo externo.
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
 * Lista de espera más el resumen en español del reparto, para no tener que
 * repartir dos veces cuando la interfaz quiere las dos cosas.
 */
export function buildWaitingReport(actions: Action[], resources: Resource[], zones: CrisisZone[]) {
  const resolution = resolveResourceConflicts(actions, resources, zones);
  return {
    waiting: construirEspera(resolution.waiting, actions, resources, zones),
    allocations: resolution.allocations,
    summary: resolution.summary,
  };
}
