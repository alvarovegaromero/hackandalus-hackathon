// PROPIETARIO: agente de asignacion de recursos.
// Motor de asignacion. store.ts llama a estas funciones y no toma decisiones
// de recursos por su cuenta.
//
// La pregunta del reto es literal: "tienes tres ambulancias y cinco sitios
// pidiendolas". Este modulo responde a esa pregunta con un criterio explicito,
// puntuado y explicable, porque la decision se muestra al operador y tiene que
// sostenerse delante de un jurado.
//
// Criterio de puntuacion (0..100), con los pesos declarados en PESOS:
//   45  capacidad tecnica  -> lo que la accion necesita frente a Resource.capabilities
//   25  proximidad         -> distancia entre la base del recurso y la zona del incidente
//   15  suficiencia        -> Resource.capacity frente a la poblacion en riesgo de la zona
//   10  disponibilidad     -> libre ahora, o en uso y habria que quitarselo a otra zona
//    5  encaje de canal    -> si la accion sale por voz/mensajeria, ayuda tener comunicaciones
//
// Regla dura: un recurso sin ninguna capacidad util para la necesidad NO es
// candidato, por cerca que este. Un recurso "unavailable" nunca es candidato.

import type { Action, ActionChannel, CrisisZone, Resource, ZoneStatus } from "./types";

export interface AssignmentDecision {
  resourceId: string;
  reason: string;
  /** Puntuacion 0..100 de la eleccion, para poder ordenar o mostrar confianza. */
  score?: number;
}

/** Pesos del criterio de asignacion. Suman 100. */
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
  /** false si no cubre ninguna de las necesidades de la accion. */
  compatible: boolean;
  /** Puntuacion 0..100. Los incompatibles y los no disponibles valen 0. */
  score: number;
  factors: CandidateFactors;
  /** Distancia en unidades del mapa, o null si el recurso no tiene base conocida. */
  distance: number | null;
  /** Capacidades del recurso que encajan con la necesidad. */
  matched: string[];
  /** Motivo de descarte, cuando corresponde. */
  rejection: string | null;
}

// ---------------------------------------------------------------------------
// Taxonomia de necesidades
// ---------------------------------------------------------------------------

/**
 * Traduce el texto de la accion (categoria de la senal u objetivo escrito a
 * mano) a las capacidades de `Resource.capabilities` que hacen falta. La
 * primera capacidad de cada grupo es la principal: cubrirla pesa mucho mas que
 * cubrir solo la secundaria.
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
    // Ojo: aqui NO va "coordina". store.ts redacta todos los objetivos como
    // "Coordinar respuesta de <categoria> en <zona>", asi que esa palabra
    // aparece siempre y convertiria al Enlace 112 en comodin universal, capaz
    // hasta de apagar un incendio. La necesidad real es la categoria.
    claves: ["mando", "enlace", "escasez", "resource-shortage", "integration", "112"],
    capacidades: ["coordinacion", "comunicaciones"],
  },
];

/** Necesidad por defecto cuando el texto de la accion no encaja en la tabla. */
const NECESIDAD_POR_DEFECTO = ["coordinacion", "comunicaciones"];

/** Capacidades cuyo dimensionamiento depende de cuanta gente hay en riesgo. */
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

/** Estados de accion que siguen dependiendo del recurso asignado. */
const ESTADOS_VIVOS = new Set(["pending", "approved", "running", "blocked", "stalled"]);

/** Quita acentos y baja a minusculas para poder comparar texto libre. */
function normalizar(texto: string) {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Devuelve las capacidades necesarias, la principal primero. */
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

  // Sin pista en el texto: si la accion sale por un canal de contacto, lo que
  // hace falta es alguien que coordine y avise, no un equipo de campo.
  void channel;
  return [...NECESIDAD_POR_DEFECTO];
}

// ---------------------------------------------------------------------------
// Geografia y urgencia
// ---------------------------------------------------------------------------

function buscarZona(zones: CrisisZone[], zoneId: string | null | undefined) {
  if (!zoneId) return null;
  return zones.find((zone) => zone.id === zoneId) ?? null;
}

/** Distancia euclidea entre dos zonas del mapa, en unidades del tablero. */
export function distanciaEntreZonas(a: CrisisZone, b: CrisisZone) {
  const dx = a.coordinates.x - b.coordinates.x;
  const dy = a.coordinates.y - b.coordinates.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Urgencia de una zona sin mirar las senales vivas: sirve para decidir a quien
 * se le quita un recurso y a quien se deja esperando. El motor de prioridad
 * tiene su propia puntuacion con eventos; aqui basta con el estado de la zona.
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
// Puntuacion de candidatos
// ---------------------------------------------------------------------------

function porcentaje(valor: number) {
  return `${Math.round(valor * 100)} %`;
}

function redondear(valor: number) {
  return Math.round(valor * 10) / 10;
}

/**
 * Puntua todos los recursos frente a una accion y los devuelve ordenados de
 * mejor a peor. Los incompatibles y los no disponibles se devuelven tambien,
 * con `rejection` explicando por que quedan fuera: la interfaz puede mostrar
 * "estaba mas cerca pero no sabe hacer esto".
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

  // Cuanta capacidad hace falta: una unidad por cada 100 personas en riesgo.
  const necesitaDimension = necesidades.some((necesidad) =>
    CAPACIDADES_DIMENSIONADAS.has(necesidad),
  );
  const capacidadRequerida = zonaAccion
    ? Math.max(1, Math.ceil(zonaAccion.populationAtRisk / 100))
    : 1;

  const candidatos = resources.map<ResourceCandidate>((resource) => {
    // Las capacidades se comparan sin acentos: los datos semilla se estan
    // reescribiendo con tildes y "extincion" y "extinción" son la misma cosa.
    const capacidades = new Set(resource.capabilities.map(normalizar));
    const matched = necesidades.filter((necesidad) => capacidades.has(normalizar(necesidad)));

    // Proximidad: desde donde esta desplegado, y si no, desde su base.
    const zonaRecurso =
      buscarZona(zones, resource.zoneId) ?? buscarZona(zones, resource.homeZoneId);
    let distance: number | null = null;
    let proximidad: number;
    if (!zonaAccion || !zonaRecurso) {
      // Recurso regional sin base fija (o zona desconocida): ni premio ni castigo.
      proximidad = 0.6;
    } else {
      distance = distanciaEntreZonas(zonaAccion, zonaRecurso);
      proximidad = Math.max(0, 1 - distance / 50);
    }

    // Capacidad tecnica: cubrir la necesidad principal manda.
    const cubrePrincipal = capacidades.has(normalizar(principal));
    const capacidadTecnica =
      matched.length === 0
        ? 0
        : (cubrePrincipal ? 0.7 : 0) + 0.3 * (matched.length / necesidades.length);

    // Suficiencia: solo se mide cuando la necesidad escala con la poblacion.
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

/** Texto en espanol que explica por que no hay recurso posible para una accion. */
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
 * Elige el mejor recurso disponible para una accion, o null si no hay ninguno
 * compatible. Tiene en cuenta capacidades frente a la necesidad, distancia,
 * capacidad frente a la poblacion en riesgo y estado.
 *
 * Solo se le quita el recurso a otra accion (recurso en estado "assigned")
 * cuando no queda ninguno libre y compatible, y ademas la zona de la nueva
 * accion es mas urgente que la zona donde el recurso esta trabajando ahora.
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

  // No queda nada libre: solo cabe reasignar si la nueva zona pesa mas.
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

/** Redacta el motivo en espanol que se muestra en la interfaz. */
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

  // Lo mas util para el operador: por que no fue el que tenia mas cerca.
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
// Mutaciones de estado
// ---------------------------------------------------------------------------

/** Marca el recurso como asignado a la accion. Muta el array recibido. */
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

/** Libera el recurso ligado a una accion que termina. Muta el array recibido. */
export function releaseResource(resources: Resource[], actionId: string) {
  const resource = resources.find((candidate) => candidate.assignedActionId === actionId);
  if (!resource) return null;
  if (resource.status === "assigned") resource.status = "available";
  resource.assignedActionId = null;
  resource.assignedAt = null;
  return resource;
}

// ---------------------------------------------------------------------------
// Adaptacion: un recurso se cae
// ---------------------------------------------------------------------------

export interface Reassignment {
  actionId: string;
  fromResourceId: string;
  toResourceId: string | null;
  reason: string;
}

/**
 * Cuando un recurso cae, busca sustituto para las acciones que dependian de el.
 * Devuelve las reasignaciones aplicadas para que el plan pueda explicarlas.
 *
 * Se atiende primero a la zona mas urgente: si solo hay un sustituto y dos
 * acciones huerfanas, la menos urgente se queda sin el, y se dice por que en
 * vez de fingir que hay recurso para todos.
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
    // El recurso caido y los ya comprometidos en esta misma tanda quedan fuera.
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
// Conflicto: varias zonas piden el mismo recurso
// ---------------------------------------------------------------------------

export interface ResourceAllocation {
  actionId: string;
  zoneId: string;
  resourceId: string;
  reason: string;
  /** Urgencia de la zona que ha ganado el recurso. */
  urgency: number;
}

export interface ResourceWaiting {
  actionId: string;
  zoneId: string;
  reason: string;
  /** Accion que se quedo el recurso que esta pedia, o null si no habia ninguno capaz. */
  blockedByActionId: string | null;
  urgency: number;
}

export interface ConflictResolution {
  allocations: ResourceAllocation[];
  waiting: ResourceWaiting[];
  /** Resumen en espanol para la interfaz. */
  summary: string;
}

/**
 * Reparte los recursos libres entre las acciones abiertas cuando hay mas
 * demanda que oferta. Atiende primero a la zona mas urgente y explica, para
 * cada zona que se queda esperando, quien se llevo el recurso y por que.
 *
 * Nadie la llama todavia: esta pensada para que store.ts la use al replanificar
 * y para que la interfaz muestre la cola de espera.
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
  // Se reparte lo que esta libre mas lo que ya sostiene una de estas acciones:
  // un recurso comprometido con una accion ajena no entra en el reparto.
  const repartibles = resources.filter(
    (resource) =>
      resource.status === "available" ||
      (resource.status === "assigned" &&
        resource.assignedActionId !== null &&
        idsAbiertas.has(resource.assignedActionId)),
  );

  const allocations: ResourceAllocation[] = [];
  const waiting: ResourceWaiting[] = [];
  const tomados = new Map<string, string>(); // resourceId -> actionId que se lo quedo
  const disputas = new Map<string, number>(); // resourceId -> cuantas acciones lo querian

  for (const action of ordenadas) {
    const zona = buscarZona(zones, action.zoneId);
    const urgency = zona ? Math.round(urgenciaDeZona(zona)) : 0;
    const peticion = {
      zoneId: action.zoneId,
      objective: action.objective,
      channel: action.channel,
    };

    // Se anota que recurso querria esta accion si no hubiera competencia, para
    // saber cual es el mas peleado aunque quien lo pida acabe esperando.
    const preferido = rankResourcesForAction(peticion, repartibles, zones).find(
      (candidato) => candidato.compatible && candidato.resource.status !== "unavailable",
    );
    if (preferido) {
      disputas.set(preferido.resource.id, (disputas.get(preferido.resource.id) ?? 0) + 1);
    }

    const libres = repartibles.filter((resource) => {
      if (tomados.has(resource.id)) return false;
      // Un recurso ya pegado a esta misma accion sigue siendo suyo.
      if (resource.status === "assigned" && resource.assignedActionId !== action.id) return false;
      return true;
    });

    // Se fuerza el estado a libre para puntuar: en este reparto todo lo que
    // queda en `libres` esta realmente disponible para esta accion.
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

    // Se queda esperando: se busca quien tiene el recurso que esta accion queria.
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
