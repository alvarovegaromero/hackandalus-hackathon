// OWNER: resource allocation agent.
// Allocation engine. store.ts calls these functions and does not make
// resource decisions on its own.
//
// The challenge question is literal: "you have three ambulances and five sites
// requesting them". This module answers that question with an explicit,
// scored, and explainable criterion, because the decision is shown to the
// operator and must hold up before a jury.
//
// Scoring criteria (0..100), with weights declared in PESOS:
//   45  technical capacity -> what the action needs vs Resource.capabilities
//   25  proximity          -> distance between resource base and incident zone
//   15  sufficiency        -> Resource.capacity vs population at risk in the zone
//   10  availability       -> free now, or in use and would need to be taken from another zone
//    5  channel fit        -> if the action uses voice/messaging, having communications helps
//
// Hard rule: a resource without any useful capability for the need is NOT a
// candidate, regardless of proximity. An "unavailable" resource is never a candidate.

import type { Action, ActionChannel, CrisisZone, Resource, ZoneStatus } from "./types";

export interface AssignmentDecision {
  resourceId: string;
  reason: string;
  /** Score 0..100 of the choice, for sorting or displaying confidence. */
  score?: number;
}

/** Assignment criteria weights. Sum to 100. */
export const PESOS = {
  capacidadTecnica: 45,
  proximidad: 25,
  suficiencia: 15,
  disponibilidad: 10,
  canal: 5,
} as const;

export interface CandidateFactors {
  capacidadTecnica: number;
  proximidad: number;
  suficiencia: number;
  disponibilidad: number;
  canal: number;
}

export interface ResourceCandidate {
  resource: Resource;
  /** false if it does not cover any of the action's needs. */
  compatible: boolean;
  /** Score 0..100. Incompatible and unavailable resources are 0. */
  score: number;
  factors: CandidateFactors;
  /** Distance in map units, or null if the resource has no known base. */
  distance: number | null;
  /** Resource capabilities matching the need. */
  matched: string[];
  /** Rejection reason, when applicable. */
  rejection: string | null;
}

// ---------------------------------------------------------------------------
// Needs taxonomy
// ---------------------------------------------------------------------------

/**
 * Maps the action text (signal category or handwritten objective)
 * to the capabilities in `Resource.capabilities` that are needed. The
 * first capability in each group is primary: covering it weighs much more than
 * covering only the secondary one.
 */
const TABLA_NECESIDADES: { claves: string[]; capacidades: string[] }[] = [
  {
    claves: ["incendio", "fuego", "extincion", "llama", "humo", "frente"],
    capacidades: ["extincion", "campo"],
  },
  {
    claves: ["monte", "forestal", "evaluacion de monte", "vigilancia", "reconocimiento"],
    capacidades: ["evaluacion de monte", "campo"],
  },
  {
    claves: ["triaje", "sanitari", "medic", "herid", "salud", "hospital", "ambulancia"],
    capacidades: ["triaje", "sanitario"],
  },
  { claves: ["evacua", "desaloj", "rescate"], capacidades: ["evacuacion", "transporte"] },
  { claves: ["refugio", "alberg", "acogida", "realojo"], capacidades: ["refugio", "transporte"] },
  {
    claves: [
      "transporte",
      "logistic",
      "ruta",
      "route",
      "carretera",
      "traslado",
      "enlace logistico",
    ],
    capacidades: ["transporte", "evacuacion"],
  },
  {
    claves: ["alerta", "aviso", "poblacion", "publica", "publico", "informacion", "comunicacion"],
    capacidades: ["alerta publica", "comunicaciones"],
  },
  {
    // Note: "coordina" does NOT go here. store.ts writes all objectives as
    // "Coordinar respuesta de <categoria> en <zona>", so that word
    // always appears and would make 112 Enlace a universal wildcard, capable
    // even of extinguishing a fire. The real need is the category.
    claves: ["mando", "enlace", "escasez", "resource-shortage", "integration", "112"],
    capacidades: ["coordinacion", "comunicaciones"],
  },
];

/** Default need when action text does not match the table. */
const NECESIDAD_POR_DEFECTO = ["coordinacion", "comunicaciones"];

/** Capabilities whose sizing depends on how many people are at risk. */
const CAPACIDADES_DIMENSIONADAS = new Set([
  "evacuacion",
  "transporte",
  "refugio",
  "triaje",
  "sanitario",
  "extincion",
]);

const CANALES_DE_CONTACTO: ActionChannel[] = ["call", "sms", "email", "whatsapp", "slack"];
const CAPACIDADES_DE_CONTACTO = new Set(["comunicaciones", "coordinacion", "alerta publica"]);

const PESO_ESTADO_ZONA: Record<ZoneStatus, number> = {
  stable: 0,
  watch: 15,
  active: 30,
  critical: 45,
};

/** Action statuses that still depend on the assigned resource. */
const ESTADOS_VIVOS = new Set(["pending", "approved", "running", "blocked", "stalled"]);

/** Removes accents and converts to lowercase to compare free text. */
function normalizar(texto: string) {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Returns the required capabilities, primary first. */
export function necesidadesDeAccion(objective: string, channel?: ActionChannel): string[] {
  const texto = normalizar(objective ?? "");
  const encontradas: string[] = [];

  for (const grupo of TABLA_NECESIDADES) {
    if (grupo.claves.some((clave) => texto.includes(clave))) {
      for (const capacidad of grupo.capacidades) {
        if (!encontradas.includes(capacidad)) encontradas.push(capacidad);
      }
    }
  }

  if (encontradas.length > 0) return encontradas;

  // Without hints in text: if the action goes through a contact channel,
  // what is needed is someone to coordinate and notify, not a field team.
  void channel;
  return [...NECESIDAD_POR_DEFECTO];
}

// ---------------------------------------------------------------------------
// Geography and urgency
// ---------------------------------------------------------------------------

function buscarZona(zones: CrisisZone[], zoneId: string | null | undefined) {
  if (!zoneId) return null;
  return zones.find((zone) => zone.id === zoneId) ?? null;
}

/** Euclidean distance between two zones on the map, in board units. */
export function distanciaEntreZonas(a: CrisisZone, b: CrisisZone) {
  const dx = a.coordinates.x - b.coordinates.x;
  const dy = a.coordinates.y - b.coordinates.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Zone urgency without looking at live signals: used to decide who
 * loses a resource and who is kept waiting. The priority engine
 * has its own scoring with events; here zone status is sufficient.
 */
export function urgenciaDeZona(zone: CrisisZone) {
  return (
    zone.riskScore +
    PESO_ESTADO_ZONA[zone.status] +
    Math.min(25, zone.populationAtRisk / 150) +
    zone.needs.length * 4
  );
}

// ---------------------------------------------------------------------------
// Candidate scoring
// ---------------------------------------------------------------------------

function porcentaje(valor: number) {
  return `${Math.round(valor * 100)} %`;
}

function redondear(valor: number) {
  return Math.round(valor * 10) / 10;
}

/**
 * Scores all resources against an action and returns them sorted from
 * best to worst. Incompatible and unavailable resources are also returned,
 * with `rejection` explaining why they are excluded: the UI can show
 * "was closer but cannot perform this task".
 */
export function rankResourcesForAction(
  action: Pick<Action, "zoneId" | "objective" | "channel">,
  resources: Resource[],
  zones: CrisisZone[],
): ResourceCandidate[] {
  const zonaAccion = buscarZona(zones, action.zoneId);
  const necesidades = necesidadesDeAccion(action.objective, action.channel);
  const principal = necesidades[0];
  const esCanalDeContacto = CANALES_DE_CONTACTO.includes(action.channel);

  // How much capacity is needed: one unit per 100 people at risk.
  const necesitaDimension = necesidades.some((necesidad) =>
    CAPACIDADES_DIMENSIONADAS.has(necesidad),
  );
  const capacidadRequerida = zonaAccion
    ? Math.max(1, Math.ceil(zonaAccion.populationAtRisk / 100))
    : 1;

  const candidatos = resources.map<ResourceCandidate>((resource) => {
    // Capabilities are compared without accents: seed data is being
    // rewritten with accents and "extincion" and "extinción" are the same thing.
    const capacidades = new Set(resource.capabilities.map(normalizar));
    const matched = necesidades.filter((necesidad) => capacidades.has(normalizar(necesidad)));

    // Proximity: from where it is deployed, otherwise from its base.
    const zonaRecurso =
      buscarZona(zones, resource.zoneId) ?? buscarZona(zones, resource.homeZoneId);
    let distance: number | null = null;
    let proximidad: number;
    if (!zonaAccion || !zonaRecurso) {
      // Regional resource without fixed base (or unknown zone): neither rewarded nor penalized.
      proximidad = 0.6;
    } else {
      distance = distanciaEntreZonas(zonaAccion, zonaRecurso);
      proximidad = Math.max(0, 1 - distance / 50);
    }

    // Technical capability: covering the primary need takes precedence.
    const cubrePrincipal = capacidades.has(normalizar(principal));
    const capacidadTecnica =
      matched.length === 0
        ? 0
        : (cubrePrincipal ? 0.7 : 0) + 0.3 * (matched.length / necesidades.length);

    // Sufficiency: only measured when need scales with population.
    const suficiencia = necesitaDimension ? Math.min(1, resource.capacity / capacidadRequerida) : 1;

    const disponibilidad = resource.status === "available" ? 1 : 0;

    const canal = esCanalDeContacto
      ? [...capacidades].some((capacidad) => CAPACIDADES_DE_CONTACTO.has(capacidad))
        ? 1
        : 0.4
      : 1;

    const factors: CandidateFactors = {
      capacidadTecnica,
      proximidad,
      suficiencia,
      disponibilidad,
      canal,
    };
    const compatible = matched.length > 0;

    let rejection: string | null = null;
    if (resource.status === "unavailable") {
      rejection = `${resource.name} está fuera de servicio.`;
    } else if (!compatible) {
      rejection = `${resource.name} no cubre ${necesidades.join(" ni ")} (sabe hacer: ${resource.capabilities.join(", ")}).`;
    }

    const score =
      compatible && resource.status !== "unavailable"
        ? PESOS.capacidadTecnica * capacidadTecnica +
          PESOS.proximidad * proximidad +
          PESOS.suficiencia * suficiencia +
          PESOS.disponibilidad * disponibilidad +
          PESOS.canal * canal
        : 0;

    return {
      resource,
      compatible,
      score: Math.round(score * 10) / 10,
      factors,
      distance,
      matched,
      rejection,
    };
  });

  return candidatos.sort((a, b) => b.score - a.score || a.resource.id.localeCompare(b.resource.id));
}

/** Spanish text explaining why no resource is possible for an action. */
export function explainUnassignable(
  action: Pick<Action, "zoneId" | "objective" | "channel">,
  resources: Resource[],
  zones: CrisisZone[],
): string {
  const zona = buscarZona(zones, action.zoneId);
  const necesidades = necesidadesDeAccion(action.objective, action.channel);
  const donde = zona ? zona.name : action.zoneId;

  if (resources.length === 0) {
    return `No queda ningún recurso en el dispositivo para ${donde} (necesidad: ${necesidades.join(", ")}).`;
  }

  const candidatos = rankResourcesForAction(action, resources, zones);
  const compatibles = candidatos.filter((candidato) => candidato.compatible);
  const compatiblesLibres = compatibles.filter(
    (candidato) => candidato.resource.status === "available",
  );

  if (compatibles.length === 0) {
    return `Ningún recurso cubre ${necesidades.join(" ni ")} para ${donde}. Disponible solo: ${candidatos
      .map(
        (candidato) => `${candidato.resource.name} (${candidato.resource.capabilities.join(", ")})`,
      )
      .join("; ")}. Hace falta pedir apoyo externo.`;
  }

  if (compatiblesLibres.length === 0) {
    const ocupados = compatibles
      .filter((candidato) => candidato.resource.status === "assigned")
      .map((candidato) => candidato.resource.name);
    const caidos = compatibles
      .filter((candidato) => candidato.resource.status === "unavailable")
      .map((candidato) => candidato.resource.name);
    const partes: string[] = [];
    if (ocupados.length > 0)
      partes.push(`ocupados en zonas más prioritarias: ${ocupados.join(", ")}`);
    if (caidos.length > 0) partes.push(`fuera de servicio: ${caidos.join(", ")}`);
    return `Hay recursos capaces de cubrir ${necesidades[0]} en ${donde}, pero ninguno libre (${partes.join("; ")}). ${donde} se queda esperando.`;
  }

  return `Sin recurso asignable para ${donde}.`;
}

/**
 * Selects the best available resource for an action, or null if none
 * is compatible. Accounts for capabilities vs need, distance,
 * capacity vs population at risk, and status.
 *
 * A resource is only taken from another action (status "assigned")
 * when no free and compatible resource remains, and the zone of the new
 * action is more urgent than the zone where the resource is currently working.
 */
export function selectResourceForAction(
  action: Pick<Action, "zoneId" | "objective" | "channel">,
  resources: Resource[],
  zones: CrisisZone[],
): AssignmentDecision | null {
  const candidatos = rankResourcesForAction(action, resources, zones);
  const zonaAccion = buscarZona(zones, action.zoneId);
  const necesidades = necesidadesDeAccion(action.objective, action.channel);
  const utiles = candidatos.filter(
    (candidato) => candidato.compatible && candidato.resource.status !== "unavailable",
  );
  if (utiles.length === 0) return null;

  const libres = utiles.filter((candidato) => candidato.resource.status === "available");

  if (libres.length > 0) {
    const elegido = libres[0];
    const alternativa = libres[1] ?? null;
    return {
      resourceId: elegido.resource.id,
      score: elegido.score,
      reason: construirMotivo(elegido, alternativa, candidatos, zonaAccion, necesidades, false),
    };
  }

  // Nothing free remains: only reassign if the new zone has higher weight.
  const urgenciaNueva = zonaAccion ? urgenciaDeZona(zonaAccion) : 0;
  const expropiables = utiles.filter((candidato) => {
    const zonaActual = buscarZona(zones, candidato.resource.zoneId);
    const urgenciaActual = zonaActual ? urgenciaDeZona(zonaActual) : 0;
    return urgenciaNueva > urgenciaActual;
  });
  if (expropiables.length === 0) return null;

  const elegido = expropiables[0];
  return {
    resourceId: elegido.resource.id,
    score: elegido.score,
    reason: construirMotivo(
      elegido,
      expropiables[1] ?? null,
      candidatos,
      zonaAccion,
      necesidades,
      true,
    ),
  };
}

/** Drafts the explanation in Spanish shown in the interface. */
function construirMotivo(
  elegido: ResourceCandidate,
  alternativa: ResourceCandidate | null,
  todos: ResourceCandidate[],
  zonaAccion: CrisisZone | null,
  necesidades: string[],
  expropiado: boolean,
) {
  const recurso = elegido.resource;
  const donde = zonaAccion ? zonaAccion.name : "la zona afectada";
  const partes: string[] = [];

  partes.push(`${recurso.name} cubre ${elegido.matched.join(" y ")} de lo que pide ${donde}`);

  if (zonaAccion && recurso.zoneId === zonaAccion.id) {
    partes.push("y ya está desplegado en la propia zona");
  } else if (elegido.distance !== null) {
    partes.push(
      `y es el compatible más cercano (distancia ${redondear(elegido.distance)}, proximidad ${porcentaje(
        elegido.factors.proximidad,
      )})`,
    );
  } else {
    partes.push("y es un recurso regional sin base fija");
  }

  if (zonaAccion) {
    partes.push(
      `con capacidad ${recurso.capacity} para ${zonaAccion.populationAtRisk} personas en riesgo (suficiencia ${porcentaje(
        elegido.factors.suficiencia,
      )})`,
    );
  }

  let texto = `${partes.join(" ")}. Puntuación ${elegido.score}/100.`;

  // Most useful for the operator: why it wasn't the closest one.
  const masCercanoIncompatible = todos
    .filter(
      (candidato) =>
        !candidato.compatible &&
        candidato.resource.status !== "unavailable" &&
        candidato.distance !== null &&
        (elegido.distance === null || candidato.distance < elegido.distance),
    )
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))[0];

  if (masCercanoIncompatible) {
    texto += ` ${masCercanoIncompatible.resource.name} está más cerca pero no cubre ${necesidades[0]}.`;
  } else if (alternativa) {
    texto += ` Por delante de ${alternativa.resource.name} (${alternativa.score}/100).`;
  }

  if (expropiado) {
    texto += ` Se le retira a su tarea actual porque no queda ningún recurso libre capaz y ${donde} es ahora más urgente.`;
  }

  return texto;
}

// ---------------------------------------------------------------------------
// State mutations
// ---------------------------------------------------------------------------

/** Marks the resource as assigned to the action. Mutates the received array. */
export function assignResource(
  resources: Resource[],
  resourceId: string,
  actionId: string,
  at: string,
) {
  const resource = resources.find((candidate) => candidate.id === resourceId);
  if (!resource || resource.status === "unavailable") return null;
  resource.status = "assigned";
  resource.assignedActionId = actionId;
  resource.assignedAt = at;
  return resource;
}

/** Releases the resource linked to an action that is ending. Mutates the received array. */
export function releaseResource(resources: Resource[], actionId: string) {
  const resource = resources.find((candidate) => candidate.assignedActionId === actionId);
  if (!resource) return null;
  if (resource.status === "assigned") resource.status = "available";
  resource.assignedActionId = null;
  resource.assignedAt = null;
  return resource;
}

// ---------------------------------------------------------------------------
// Adaptation: a resource goes down
// ---------------------------------------------------------------------------

export interface Reassignment {
  actionId: string;
  fromResourceId: string;
  toResourceId: string | null;
  reason: string;
}

/**
 * When a resource goes down, finds replacements for actions that depended on it.
 * Returns the applied reassignments so the plan can explain them.
 *
 * The most urgent zone is served first: if there is only one replacement and two
 * orphaned actions, the less urgent one goes without it, explaining why
 * instead of pretending there are enough resources for everyone.
 */
export function reassignAffectedActions(
  actions: Action[],
  resources: Resource[],
  zones: CrisisZone[],
  downResourceId: string,
): Reassignment[] {
  const caido = resources.find((resource) => resource.id === downResourceId) ?? null;
  const nombreCaido = caido?.name ?? downResourceId;

  const afectadas = actions.filter(
    (action) => action.resourceId === downResourceId && ESTADOS_VIVOS.has(action.status),
  );
  if (afectadas.length === 0) return [];

  const ordenadas = [...afectadas].sort((a, b) => {
    const urgenciaA = buscarZona(zones, a.zoneId);
    const urgenciaB = buscarZona(zones, b.zoneId);
    const scoreA = urgenciaA ? urgenciaDeZona(urgenciaA) : 0;
    const scoreB = urgenciaB ? urgenciaDeZona(urgenciaB) : 0;
    return scoreB - scoreA || a.createdAt.localeCompare(b.createdAt);
  });

  const reservados = new Set<string>([downResourceId]);
  const movimientos: Reassignment[] = [];

  for (const action of ordenadas) {
    // The downed resource and those already committed in this batch are excluded.
    const disponibles = resources.filter((resource) => !reservados.has(resource.id));
    const decision = selectResourceForAction(
      { zoneId: action.zoneId, objective: action.objective, channel: action.channel },
      disponibles,
      zones,
    );

    if (!decision) {
      movimientos.push({
        actionId: action.id,
        fromResourceId: downResourceId,
        toResourceId: null,
        reason: `Sin sustituto para ${nombreCaido}: ${explainUnassignable(
          { zoneId: action.zoneId, objective: action.objective, channel: action.channel },
          disponibles,
          zones,
        )} La acción sigue bloqueada hasta que se libere o llegue un recurso capaz.`,
      });
      continue;
    }

    reservados.add(decision.resourceId);
    movimientos.push({
      actionId: action.id,
      fromResourceId: downResourceId,
      toResourceId: decision.resourceId,
      reason: `Sustitución tras la caída de ${nombreCaido}: ${decision.reason}`,
    });
  }

  return movimientos;
}

// ---------------------------------------------------------------------------
// Conflict: multiple zones request the same resource
// ---------------------------------------------------------------------------

export interface ResourceAllocation {
  actionId: string;
  zoneId: string;
  resourceId: string;
  reason: string;
  /** Urgency of the zone that won the resource. */
  urgency: number;
}

export interface ResourceWaiting {
  actionId: string;
  zoneId: string;
  reason: string;
  /** Action that took the requested resource, or null if none capable. */
  blockedByActionId: string | null;
  urgency: number;
}

export interface ConflictResolution {
  allocations: ResourceAllocation[];
  waiting: ResourceWaiting[];
  /** Summary in Spanish for the interface. */
  summary: string;
}

/**
 * Distributes free resources among open actions when demand exceeds supply.
 * Serves the most urgent zone first and explains, for each zone left waiting,
 * who took the resource and why.
 *
 * Not called yet: designed for store.ts during replanning
 * and for the UI to display the waiting queue.
 */
export function resolveResourceConflicts(
  actions: Action[],
  resources: Resource[],
  zones: CrisisZone[],
): ConflictResolution {
  const abiertas = actions.filter((action) => ESTADOS_VIVOS.has(action.status));

  const ordenadas = [...abiertas].sort((a, b) => {
    const zonaA = buscarZona(zones, a.zoneId);
    const zonaB = buscarZona(zones, b.zoneId);
    const scoreA = zonaA ? urgenciaDeZona(zonaA) : 0;
    const scoreB = zonaB ? urgenciaDeZona(zonaB) : 0;
    return scoreB - scoreA || a.createdAt.localeCompare(b.createdAt);
  });

  const idsAbiertas = new Set(abiertas.map((action) => action.id));
  // Distribute what is free plus what already sustains one of these actions:
  // a resource committed to an unrelated action is excluded from distribution.
  const repartibles = resources.filter(
    (resource) =>
      resource.status === "available" ||
      (resource.status === "assigned" &&
        resource.assignedActionId !== null &&
        idsAbiertas.has(resource.assignedActionId)),
  );

  const allocations: ResourceAllocation[] = [];
  const waiting: ResourceWaiting[] = [];
  const tomados = new Map<string, string>(); // resourceId -> actionId that claimed it
  const disputas = new Map<string, number>(); // resourceId -> how many actions wanted it

  for (const action of ordenadas) {
    const zona = buscarZona(zones, action.zoneId);
    const urgency = zona ? Math.round(urgenciaDeZona(zona)) : 0;
    const peticion = {
      zoneId: action.zoneId,
      objective: action.objective,
      channel: action.channel,
    };

    // Note which resource this action would want if there were no competition,
    // to identify the most contested resource even if requester ends up waiting.
    const preferido = rankResourcesForAction(peticion, repartibles, zones).find(
      (candidato) => candidato.compatible && candidato.resource.status !== "unavailable",
    );
    if (preferido) {
      disputas.set(preferido.resource.id, (disputas.get(preferido.resource.id) ?? 0) + 1);
    }

    const libres = repartibles.filter((resource) => {
      if (tomados.has(resource.id)) return false;
      // A resource already assigned to this same action remains its own.
      if (resource.status === "assigned" && resource.assignedActionId !== action.id) return false;
      return true;
    });

    // Force status to available for scoring: in this distribution everything
    // remaining in `libres` is actually available for this action.
    const libresComoDisponibles = libres.map((resource) =>
      resource.status === "available" ? resource : { ...resource, status: "available" as const },
    );

    const decision = selectResourceForAction(peticion, libresComoDisponibles, zones);

    if (decision) {
      tomados.set(decision.resourceId, action.id);
      allocations.push({
        actionId: action.id,
        zoneId: action.zoneId,
        resourceId: decision.resourceId,
        reason: decision.reason,
        urgency,
      });
      continue;
    }

    // Left waiting: look up who holds the resource this action requested.
    const deseados = rankResourcesForAction(peticion, repartibles, zones).filter(
      (candidato) => candidato.compatible && candidato.resource.status !== "unavailable",
    );
    const disputado = deseados.find((candidato) => tomados.has(candidato.resource.id));
    const ganadoraId = disputado ? (tomados.get(disputado.resource.id) ?? null) : null;
    const ganadora = ganadoraId
      ? (allocations.find((item) => item.actionId === ganadoraId) ?? null)
      : null;
    const zonaGanadora = ganadora ? buscarZona(zones, ganadora.zoneId) : null;

    const reason = disputado
      ? `${zona?.name ?? action.zoneId} espera: ${disputado.resource.name} se ha asignado a ${
          zonaGanadora?.name ?? "otra zona"
        }, con urgencia ${ganadora?.urgency ?? 0} frente a ${urgency}. Es el único recurso capaz de cubrir ${
          necesidadesDeAccion(action.objective, action.channel)[0]
        } que quedaba libre.`
      : `${zona?.name ?? action.zoneId} espera: ${explainUnassignable(peticion, repartibles, zones)}`;

    waiting.push({
      actionId: action.id,
      zoneId: action.zoneId,
      reason,
      blockedByActionId: ganadoraId,
      urgency,
    });
  }

  const masDisputado = [...disputas.entries()].sort((a, b) => b[1] - a[1])[0];
  const nombreDisputado = masDisputado
    ? (resources.find((resource) => resource.id === masDisputado[0])?.name ?? masDisputado[0])
    : null;

  const summary =
    waiting.length === 0
      ? `${allocations.length} acciones abiertas y recursos para todas; nadie queda en espera.`
      : `${ordenadas.length} acciones abiertas, ${allocations.length} con recurso y ${waiting.length} en espera.` +
        (nombreDisputado && masDisputado && masDisputado[1] > 1
          ? ` El recurso más disputado es ${nombreDisputado} (${masDisputado[1]} zonas lo piden).`
          : "");

  return { allocations, waiting, summary };
}
