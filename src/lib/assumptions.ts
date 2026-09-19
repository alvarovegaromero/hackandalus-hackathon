// OWNER: live assumptions agent.
//
// Live assumptions: what the plan depends on and how the system detects
// that it no longer depends on something that is no longer true.
//
// The challenge literally asks when to scrap the plan: "the wind
// changes and the twenty-minute-old plan no longer holds". Replanning on
// every signal does not answer that, because a plan that is always remade
// never knows what it depended on. Here each plan declares its dependencies
// and the world is checked against them:
//
//   plan   ->  deriveAssumptions()  ->  assumptions supporting it
//   signal ->  applyEventToWorld()  ->  new world state
//   world  ->  checkAssumptions()   ->  what still holds and what broke
//   broken ->  explainInvalidation() + consequencesOfBreak()
//
// Four design rules:
//
//  1. Completely deterministic and pure. No language models or randomness:
//     the same situation always produces the same assumptions and text.
//  2. Assumptions derive from real plan decisions, not a template.
//     If no resource crosses a road, nothing is declared about it.
//  3. Few and readable. At most six, because the operator must read them
//     in two seconds, exactly as required by the challenge.
//  4. A broken assumption stays broken. It doesn't re-break or self-resurrect:
//     the only way to return to "ok" is for the next plan to redeclare it.
//
// An assumption that is already false when derived is NOT declared: a plan cannot
// rely on something that is not currently met. And if data disappears (e.g. no bed
// information available), the assumption becomes "unknown", not "ok": pretending
// it holds would lie to the operator.

import type {
  Action,
  ActionStatus,
  Assumption,
  AssumptionStatus,
  CrisisEvent,
  CrisisZone,
  Plan,
  Resource,
  WorldState,
} from "./types";

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

/** Max assumptions per plan. A long list cannot be read in two seconds. */
export const MAX_SUPUESTOS = 6;
/** At most two routes: those of the two highest priority zones. */
const MAX_CARRETERAS = 2;
/** One hospital, from the highest priority zone evacuating wounded. */
const MAX_HOSPITALES = 1;
/** Voice and messaging, if the plan uses them. */
const MAX_CANALES = 2;
/** Free beds below which medical evacuation cannot fit. */
export const UMBRAL_CAMAS = 10;

/** Action statuses that still expect the assumption to hold. */
const ESTADOS_VIVOS = new Set<ActionStatus>([
  "pending",
  "approved",
  "running",
  "blocked",
  "stalled",
]);

/**
 * Roads connecting each pair of zones. A resource departing from its base to
 * another zone depends on its route, and that crossing generates the assumption.
 * The key is the alphabetically sorted pair, making the table symmetric.
 */
const CARRETERAS_ENTRE_ZONAS: Record<string, string> = {
  "zone-central|zone-east": "A-92",
  "zone-central|zone-islands": "A-4",
  "zone-central|zone-north": "A-433",
  "zone-central|zone-south": "A-375",
  "zone-east|zone-islands": "A-7",
  "zone-east|zone-north": "N-432",
  "zone-east|zone-south": "A-7",
  "zone-islands|zone-north": "A-66",
  "zone-islands|zone-south": "A-381",
  "zone-north|zone-south": "A-397",
};

/** Main road of each zone, for road-cut signals that do not cite a specific highway. */
const CARRETERA_PRINCIPAL: Record<string, string> = {
  "zone-north": "A-397",
  "zone-central": "A-4",
  "zone-east": "A-92",
  "zone-south": "A-7",
  "zone-islands": "A-381",
};

/** Designated reference hospital of each zone for medical evacuation. */
const HOSPITAL_POR_ZONA: Record<string, string> = {
  "zone-north": "hospital-serrania",
  "zone-south": "hospital-costa-del-sol",
};

const NOMBRES_DE_HOSPITAL: Record<string, string> = {
  "hospital-serrania": "Hospital de la Serranía",
  "hospital-costa-del-sol": "Hospital Costa del Sol",
};

const NOMBRES_DE_VIENTO: Record<string, string> = {
  N: "norte",
  NE: "nordeste",
  E: "este",
  SE: "sureste",
  S: "sur",
  SO: "suroeste",
  SW: "suroeste",
  O: "oeste",
  W: "oeste",
  NO: "noroeste",
  NW: "noroeste",
};

/** Keywords indicating that an action moves wounded or evacuates population. */
const PALABRAS_SANITARIAS = [
  "evacua",
  "triaje",
  "sanitari",
  "herid",
  "hospital",
  "medic",
  "rescate",
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Removes accents and converts to lowercase to compare free text. */
function normalizar(texto: string) {
  return (texto ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function slug(texto: string) {
  return normalizar(texto)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function mayuscula(texto: string) {
  return texto.length > 0 ? `${texto[0].toUpperCase()}${texto.slice(1)}` : texto;
}

/** Road connecting two zones, or null if no known route between them. */
export function carreteraEntre(zonaA: string, zonaB: string): string | null {
  if (!zonaA || !zonaB || zonaA === zonaB) return null;
  const clave = [zonaA, zonaB].sort().join("|");
  return CARRETERAS_ENTRE_ZONAS[clave] ?? null;
}

function nombreDeViento(codigo: string) {
  return NOMBRES_DE_VIENTO[(codigo ?? "").toUpperCase()] ?? codigo;
}

function nombreDeHospital(id: string) {
  if (NOMBRES_DE_HOSPITAL[id]) return NOMBRES_DE_HOSPITAL[id];
  const limpio = id.replace(/^hospital-/, "").replace(/-/g, " ");
  return `Hospital ${limpio}`;
}

function esSanitaria(action: Action) {
  const texto = normalizar(`${action.objective ?? ""} ${action.reason ?? ""}`);
  return PALABRAS_SANITARIAS.some((palabra) => texto.includes(palabra));
}

// ---------------------------------------------------------------------------
// Reading an assumption
//
// `variable` and `condition` are the readable contract with the UI, and at the
// same time the only input received by `checkAssumptions`, `explainInvalidation`
// and `consequencesOfBreak`. For this reason the condition is written with fixed
// tags ("destino: Sierra Morena (zone-north)"): it reads well on screen and
// can be re-interpreted without external state.
// ---------------------------------------------------------------------------

export type Interpretacion =
  | { kind: "viento"; direccion: string; zoneId: string | null; zoneName: string | null }
  | {
      kind: "carretera";
      carretera: string;
      origenId: string | null;
      origenName: string | null;
      destinoId: string | null;
      destinoName: string | null;
    }
  | { kind: "sms" }
  | { kind: "voz" }
  | {
      kind: "camas";
      hospitalId: string;
      hospitalName: string;
      minimo: number;
      zoneId: string | null;
      zoneName: string | null;
    }
  | { kind: "desconocido" };

/** Reads a tag in the format `key: Display name (identifier)`. */
function etiqueta(condition: string, clave: string) {
  const match = new RegExp(`${clave}:\\s*([^()·]+?)\\s*\\(([^)]+)\\)`).exec(condition ?? "");
  return match ? { nombre: match[1].trim(), id: match[2].trim() } : null;
}

/** Translates an assumption into the concrete decision it sustains. */
export function interpretarSupuesto(assumption: Assumption): Interpretacion {
  const variable = assumption?.variable ?? "";
  const condition = assumption?.condition ?? "";

  if (variable === "wind.direction") {
    const direccion = /=\s*([^\s·]+)/.exec(condition)?.[1] ?? "";
    const zona = etiqueta(condition, "zona");
    return { kind: "viento", direccion, zoneId: zona?.id ?? null, zoneName: zona?.nombre ?? null };
  }

  if (variable.startsWith("road.")) {
    const origen = etiqueta(condition, "origen");
    const destino = etiqueta(condition, "destino");
    return {
      kind: "carretera",
      carretera: variable.slice("road.".length),
      origenId: origen?.id ?? null,
      origenName: origen?.nombre ?? null,
      destinoId: destino?.id ?? null,
      destinoName: destino?.nombre ?? null,
    };
  }

  if (variable === "comms.sms") return { kind: "sms" };
  if (variable === "comms.voice") return { kind: "voz" };

  if (variable.startsWith("hospital.beds.")) {
    const hospitalId = variable.slice("hospital.beds.".length);
    const minimo = Number(/>=\s*(\d+)/.exec(condition)?.[1] ?? UMBRAL_CAMAS);
    const zona = etiqueta(condition, "zona");
    const hospital = etiqueta(condition, "hospital");
    return {
      kind: "camas",
      hospitalId,
      hospitalName: hospital?.nombre ?? nombreDeHospital(hospitalId),
      minimo: Number.isFinite(minimo) ? minimo : UMBRAL_CAMAS,
      zoneId: zona?.id ?? null,
      zoneName: zona?.nombre ?? null,
    };
  }

  return { kind: "desconocido" };
}

// ---------------------------------------------------------------------------
// Evaluation against the world
// ---------------------------------------------------------------------------

/**
 * Checks an assumption against world state. Without data there is no verdict:
 * returns "unknown" instead of validating what cannot be verified.
 */
export function evaluateAssumption(assumption: Assumption, world: WorldState): AssumptionStatus {
  const info = interpretarSupuesto(assumption);

  switch (info.kind) {
    case "viento": {
      const actual = (world?.windDirection ?? "").trim();
      if (!actual || normalizar(actual) === "desconocida") return "unknown";
      if (!info.direccion) return "unknown";
      return normalizar(actual) === normalizar(info.direccion) ? "ok" : "broken";
    }
    case "carretera": {
      if (!Array.isArray(world?.blockedRoads)) return "unknown";
      const cortada = world.blockedRoads.some(
        (via) => normalizar(via) === normalizar(info.carretera),
      );
      return cortada ? "broken" : "ok";
    }
    case "sms": {
      if (typeof world?.smsOperational !== "boolean") return "unknown";
      return world.smsOperational ? "ok" : "broken";
    }
    case "voz": {
      if (typeof world?.voiceOperational !== "boolean") return "unknown";
      return world.voiceOperational ? "ok" : "broken";
    }
    case "camas": {
      const libres = world?.hospitalBeds?.[info.hospitalId];
      if (typeof libres !== "number" || Number.isNaN(libres)) return "unknown";
      return libres >= info.minimo ? "ok" : "broken";
    }
    default:
      return "unknown";
  }
}

// ---------------------------------------------------------------------------
// 1. Derivation: what this plan depends on
// ---------------------------------------------------------------------------

function supuesto(
  planVersion: number,
  variable: string,
  text: string,
  condition: string,
): Assumption {
  return {
    id: `sup-v${planVersion}-${slug(variable)}`,
    text,
    variable,
    condition,
    status: "ok",
    brokenByEventId: null,
    brokenAt: null,
    planVersion,
  };
}

/**
 * Declares what the current plan depends on by reading its actual decisions:
 * which zone was prioritized first, which resources moved and their routes,
 * which channel alerts use, and which hospital receives evacuations.
 *
 * Assumptions that are already false against the current world are not declared:
 * a new plan cannot rely on a road that is already blocked.
 */
export function deriveAssumptions(
  plan: Plan,
  zones: CrisisZone[],
  resources: Resource[],
  world: WorldState,
  actions: Action[],
): Assumption[] {
  const version = plan?.version ?? 1;
  const prioridades = plan?.priorities ?? [];
  const zonaPorId = new Map((zones ?? []).map((zone) => [zone.id, zone]));
  const recursoPorId = new Map((resources ?? []).map((resource) => [resource.id, resource]));
  const orden = new Map(prioridades.map((prioridad, indice) => [prioridad.zoneId, indice]));
  const posicion = (zoneId: string) => orden.get(zoneId) ?? prioridades.length;

  const vivas = (actions ?? [])
    .filter((action) => ESTADOS_VIVOS.has(action.status))
    .sort((a, b) => posicion(a.zoneId) - posicion(b.zoneId) || a.id.localeCompare(b.id));

  const viento: Assumption[] = [];
  const carreteras: Assumption[] = [];
  const camas: Assumption[] = [];
  const canales: Assumption[] = [];

  // Wind: sustains priority ordering. Only declared if the top
  // zone is actually in play, not just as filler.
  const zonaTop = zonaPorId.get(prioridades[0]?.zoneId ?? "");
  const direccion = (world?.windDirection ?? "").trim();
  const zonaTopEnJuego =
    !!zonaTop &&
    (zonaTop.status === "active" ||
      zonaTop.status === "critical" ||
      vivas.some((action) => action.zoneId === zonaTop.id));
  if (zonaTop && direccion && zonaTopEnJuego) {
    viento.push(
      supuesto(
        version,
        "wind.direction",
        `El viento sigue del ${nombreDeViento(direccion)}, que es lo que mantiene a ${zonaTop.name} como prioridad uno.`,
        `dirección = ${direccion.toUpperCase()} · zona: ${zonaTop.name} (${zonaTop.id})`,
      ),
    );
  }

  // Roads: each resource departing from its base to another zone depends on
  // the road connecting them. Without crossing, no assumption.
  const vistas = new Set<string>();
  for (const action of vivas) {
    if (!action.resourceId) continue;
    const recurso = recursoPorId.get(action.resourceId);
    if (!recurso?.homeZoneId || recurso.homeZoneId === action.zoneId) continue;

    const carretera = carreteraEntre(recurso.homeZoneId, action.zoneId);
    if (!carretera || vistas.has(carretera)) continue;

    const destino = zonaPorId.get(action.zoneId);
    const origen = zonaPorId.get(recurso.homeZoneId);
    if (!destino || !origen) continue;

    vistas.add(carretera);
    carreteras.push(
      supuesto(
        version,
        `road.${carretera}`,
        `La ${carretera} sigue abierta para llevar ${recurso.name} a ${destino.name}.`,
        `abierta · destino: ${destino.name} (${destino.id}) · origen: ${origen.name} (${origen.id})`,
      ),
    );
  }

  // Beds: medical evacuation targets a specific hospital
  // and that hospital has a capacity limit.
  const hospitalesVistos = new Set<string>();
  for (const action of vivas) {
    if (!esSanitaria(action)) continue;
    const hospitalId = HOSPITAL_POR_ZONA[action.zoneId];
    const zona = zonaPorId.get(action.zoneId);
    if (!hospitalId || !zona || hospitalesVistos.has(hospitalId)) continue;

    hospitalesVistos.add(hospitalId);
    const hospital = nombreDeHospital(hospitalId);
    camas.push(
      supuesto(
        version,
        `hospital.beds.${hospitalId}`,
        `${hospital} mantiene al menos ${UMBRAL_CAMAS} camas libres para los evacuados de ${zona.name}.`,
        `libres >= ${UMBRAL_CAMAS} · hospital: ${hospital} (${hospitalId}) · zona: ${zona.name} (${zona.id})`,
      ),
    );
  }

  // Channels: if the plan sends alerts via a channel, it depends on that channel.
  if (vivas.some((action) => action.channel === "sms" || action.channel === "whatsapp")) {
    canales.push(
      supuesto(
        version,
        "comms.sms",
        "La mensajería sigue operativa para los avisos que salen por SMS.",
        "operativo = sí",
      ),
    );
  }
  if (vivas.some((action) => action.channel === "call")) {
    canales.push(
      supuesto(
        version,
        "comms.voice",
        "El canal de voz sigue operativo para las llamadas en curso.",
        "operativo = sí",
      ),
    );
  }

  // A plan cannot declare an assumption that is already false. Those that
  // cannot be verified are declared, marked as unknown.
  const sostenible = (candidatos: Assumption[], tope: number) =>
    candidatos
      .map((candidato) => ({ ...candidato, status: evaluateAssumption(candidato, world) }))
      .filter((candidato) => candidato.status !== "broken")
      .slice(0, tope);

  return [
    ...sostenible(viento, 1),
    ...sostenible(carreteras, MAX_CARRETERAS),
    ...sostenible(camas, MAX_HOSPITALES),
    ...sostenible(canales, MAX_CANALES),
  ].slice(0, MAX_SUPUESTOS);
}

// ---------------------------------------------------------------------------
// 2. Checking: what still holds
// ---------------------------------------------------------------------------

export interface AssumptionCheck {
  /** Complete list, with updated status. Same order as input. */
  assumptions: Assumption[];
  /** Those broken just now. These invalidate the plan. */
  broken: Assumption[];
  /** Those already broken before: not re-broken or re-announced. */
  alreadyBroken: Assumption[];
  /** Those that can no longer be verified. */
  unknown: Assumption[];
  /** true if any status changed in this check. */
  changed: boolean;
}

/**
 * Checks assumptions against the world. Deterministic and side-effect free:
 * does not mutate input or consult clock.
 *
 * A broken assumption stays broken and preserves the event that broke it, so
 * subsequent signals do not re-announce or resurrect it. Only the next
 * plan, upon redeclaring its assumptions, starts fresh.
 */
export function checkAssumptions(
  assumptions: Assumption[],
  world: WorldState,
  event?: CrisisEvent | null,
): AssumptionCheck {
  const actualizados: Assumption[] = [];
  const broken: Assumption[] = [];
  const alreadyBroken: Assumption[] = [];
  const unknown: Assumption[] = [];
  let changed = false;

  for (const assumption of assumptions ?? []) {
    if (assumption.status === "broken") {
      const copia = { ...assumption };
      actualizados.push(copia);
      alreadyBroken.push(copia);
      continue;
    }

    const status = evaluateAssumption(assumption, world);
    if (status === "broken") {
      const roto: Assumption = {
        ...assumption,
        status,
        brokenByEventId: event?.id ?? null,
        brokenAt: event?.createdAt ?? world?.updatedAt ?? null,
      };
      actualizados.push(roto);
      broken.push(roto);
      changed = true;
      continue;
    }

    const copia: Assumption = { ...assumption, status };
    actualizados.push(copia);
    if (status === "unknown") unknown.push(copia);
    if (status !== assumption.status) changed = true;
  }

  return { assumptions: actualizados, broken, alreadyBroken, unknown, changed };
}

// ---------------------------------------------------------------------------
// 3. From event to world
// ---------------------------------------------------------------------------

const DIRECCIONES: [string, string][] = [
  ["nordeste", "NE"],
  ["noreste", "NE"],
  ["noroeste", "NO"],
  ["sudeste", "SE"],
  ["sureste", "SE"],
  ["suroeste", "SO"],
  ["sudoeste", "SO"],
  ["norte", "N"],
  ["oeste", "O"],
  ["este", "E"],
  ["sur", "S"],
];

/** Reads wind direction from signal text, or null if not mentioned. */
function direccionDeSenal(crudo: string, texto: string): string | null {
  // First the uppercase code ("wind turns SW"), which is unambiguous;
  // then long names, from longest to shortest so "sureste" is not read as "este".
  const codigo = /\b(?:viento|frente|racha)[^.]{0,40}?\b(NE|NO|NW|SE|SO|SW|N|S|E|O|W)\b/.exec(
    crudo,
  );
  if (codigo)
    return codigo[1] === "NW"
      ? "NO"
      : codigo[1] === "SW"
        ? "SO"
        : codigo[1] === "W"
          ? "O"
          : codigo[1];

  for (const [nombre, valor] of DIRECCIONES) {
    if (texto.includes(nombre)) return valor;
  }
  return null;
}

/** Road mentioned in signal, or the main road of its zone. */
function carreteraDeSenal(event: CrisisEvent, crudo: string): string | null {
  const citada = /\b((?:AP|CA|MA|SE|GR|AL|CO|A|N|H|J)-\d{1,4})\b/.exec(crudo);
  if (citada) return citada[1];
  return CARRETERA_PRINCIPAL[event.zoneId] ?? null;
}

/**
 * Translates a signal into a world state change. Returns a new world
 * and never mutates the received one; if the signal doesn't affect the world,
 * returns the same object as an inexpensive way of saying "nothing happened here".
 *
 * The world timestamp is that of the signal, not the clock: thus the
 * result is reproducible in tests and demo replays.
 */
export function applyEventToWorld(world: WorldState, event: CrisisEvent): WorldState {
  if (!world || !event) return world;

  const categoria = normalizar(event.category ?? "");
  const crudo = `${event.title ?? ""} ${event.description ?? ""}`;
  const texto = normalizar(crudo);
  const cuando = event.createdAt ?? world.updatedAt;

  // --- Roads --------------------------------------------------------------
  const hablaDeVia = /carretera|ruta|via|acceso|route|road/.test(`${categoria} ${texto}`);
  const reabre = /reabiert|reabre|restablecid|despejad|reopen/.test(`${categoria} ${texto}`);
  const corta = /bloquead|cortad|corte|impracticable|blocked|derrumb/.test(`${categoria} ${texto}`);

  if (hablaDeVia && reabre) {
    const carretera = carreteraDeSenal(event, crudo);
    if (!carretera) return world;
    const quedan = (world.blockedRoads ?? []).filter(
      (via) => normalizar(via) !== normalizar(carretera),
    );
    if (quedan.length === (world.blockedRoads ?? []).length) return world;
    return { ...world, blockedRoads: quedan, updatedAt: cuando };
  }

  if (hablaDeVia && corta) {
    const carretera = carreteraDeSenal(event, crudo);
    if (!carretera) return world;
    const yaCortada = (world.blockedRoads ?? []).some(
      (via) => normalizar(via) === normalizar(carretera),
    );
    if (yaCortada) return world;
    return {
      ...world,
      blockedRoads: [...(world.blockedRoads ?? []), carretera],
      updatedAt: cuando,
    };
  }

  // --- Wind ---------------------------------------------------------------
  if (/viento|wind|racha/.test(`${categoria} ${texto}`)) {
    const direccion = direccionDeSenal(crudo, texto);
    const velocidad = /(\d{1,3})\s*km\/h/.exec(texto)?.[1];
    if (!direccion && !velocidad) return world;

    const siguiente = {
      ...world,
      windDirection: direccion ?? world.windDirection,
      windSpeedKmh: velocidad ? Number(velocidad) : world.windSpeedKmh,
      updatedAt: cuando,
    };
    const igual =
      siguiente.windDirection === world.windDirection &&
      siguiente.windSpeedKmh === world.windSpeedKmh;
    return igual ? world : siguiente;
  }

  // --- Communication channels ---------------------------------------------
  const hablaDeCanal = /integration|sms|mensajeri|telefoni|voz|llamad|cobertura|comms|telecom/.test(
    `${categoria} ${texto}`,
  );
  if (hablaDeCanal) {
    const restablece = /restablecid|recuperad|vuelve a funcionar|de nuevo operativ|resuelt/.test(
      texto,
    );
    const cae =
      /caid|cae|fallo|falla|fuera de servicio|no funciona|inoperativ|sin servicio|failure|down/.test(
        `${categoria} ${texto}`,
      );
    if (!restablece && !cae) return world;

    const operativo = restablece;
    const esVoz = /voz|llamad|telefoni/.test(texto);
    // If the signal does not specify the channel, assume messaging:
    // it is the integration driving mass alerts in the demo.
    const campo = esVoz ? "voiceOperational" : "smsOperational";
    if (world[campo] === operativo) return world;
    return { ...world, [campo]: operativo, updatedAt: cuando };
  }

  // --- Hospital beds ------------------------------------------------------
  if (/hospital|camas|beds|uci/.test(`${categoria} ${texto}`)) {
    const citado = /\b(hospital-[a-z0-9-]+)\b/.exec(normalizar(crudo))?.[1];
    const hospitalId = citado ?? HOSPITAL_POR_ZONA[event.zoneId];
    if (!hospitalId) return world;

    const beds = { ...(world.hospitalBeds ?? {}) };

    // Data disappeared: assumption must become "unknown", not assumed valid.
    if (/sin datos|sin informacion|no hay datos|sin contacto|incomunicad/.test(texto)) {
      if (!(hospitalId in beds)) return world;
      delete beds[hospitalId];
      return { ...world, hospitalBeds: beds, updatedAt: cuando };
    }

    const libres = /(\d{1,4})\s*camas/.exec(texto)?.[1];
    if (libres === undefined) return world;
    if (beds[hospitalId] === Number(libres)) return world;
    beds[hospitalId] = Number(libres);
    return { ...world, hospitalBeds: beds, updatedAt: cuando };
  }

  return world;
}

// ---------------------------------------------------------------------------
// 4. Consequences of a break
// ---------------------------------------------------------------------------

export interface AssumptionConsequence {
  actionId: string;
  objective: string;
  zoneId: string;
  /** "invalidada": cannot execute this way anymore. "en-riesgo": order may change. */
  effect: "invalidada" | "en-riesgo";
  reason: string;
}

/**
 * Which plan actions no longer make sense when an assumption breaks. This is the
 * critical piece the operator needs to decide: saying the plan is invalid
 * is not enough; we must state what is cancelled and why.
 */
export function consequencesOfBreak(
  assumption: Assumption,
  plan: Plan,
  actions: Action[],
): AssumptionConsequence[] {
  const info = interpretarSupuesto(assumption);
  const propuestas = new Set(plan?.proposedActionIds ?? []);
  const vivas = (actions ?? []).filter((action) => ESTADOS_VIVOS.has(action.status));
  // If the plan lists proposed actions, respect that list; otherwise check
  // all live actions so no consequences are omitted.
  const candidatas =
    propuestas.size > 0 ? vivas.filter((action) => propuestas.has(action.id)) : vivas;

  const consecuencia = (
    action: Action,
    effect: AssumptionConsequence["effect"],
    reason: string,
  ): AssumptionConsequence => ({
    actionId: action.id,
    objective: action.objective,
    zoneId: action.zoneId,
    effect,
    reason,
  });

  switch (info.kind) {
    case "carretera": {
      const destino = info.destinoName ?? info.destinoId ?? "la zona de destino";
      const carretera = info.carretera;
      return candidatas
        .filter((action) => !!action.resourceId && action.zoneId === info.destinoId)
        .map((action) =>
          consecuencia(
            action,
            "invalidada",
            `El medio asignado llegaba a ${destino} por la ${carretera}, que está cortada: hay que buscar otra ruta u otro medio.`,
          ),
        );
    }
    case "sms":
      return candidatas
        .filter((action) => action.channel === "sms" || action.channel === "whatsapp")
        .map((action) =>
          consecuencia(
            action,
            "invalidada",
            "El aviso salía por mensajería y el canal está caído: hay que cursarlo por voz o por otro canal.",
          ),
        );
    case "voz":
      return candidatas
        .filter((action) => action.channel === "call")
        .map((action) =>
          consecuencia(
            action,
            "invalidada",
            "La llamada no puede cursarse con el canal de voz caído: hay que pasar el aviso a mensajería.",
          ),
        );
    case "camas":
      return candidatas
        .filter((action) => action.zoneId === info.zoneId && esSanitaria(action))
        .map((action) =>
          consecuencia(
            action,
            "invalidada",
            `La evacuación sanitaria apuntaba a ${info.hospitalName} y ya no hay camas suficientes: hay que redirigirla.`,
          ),
        );
    case "viento":
      return candidatas
        .filter((action) => action.zoneId === info.zoneId)
        .map((action) =>
          consecuencia(
            action,
            "en-riesgo",
            `Esta acción se priorizó con el viento del ${nombreDeViento(info.direccion)}; al girar, el orden de prioridades puede cambiar.`,
          ),
        );
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// 5. Invalidation explanation
// ---------------------------------------------------------------------------

interface Frases {
  dependencia: string;
  rotura: string;
  consecuencia: string;
}

function frasesDeSupuesto(assumption: Assumption): Frases {
  const info = interpretarSupuesto(assumption);

  switch (info.kind) {
    case "carretera": {
      const destino = info.destinoName ?? "la zona de destino";
      return {
        dependencia: `contaba con que la ${info.carretera} siguiera abierta para llevar medios a ${destino}`,
        rotura: "y acaba de cortarse",
        consecuencia: `los equipos que iban hacia ${destino} se quedan sin ruta`,
      };
    }
    case "viento": {
      const zona = info.zoneName ?? "la zona prioritaria";
      return {
        dependencia: `daba por hecho que el viento seguiría del ${nombreDeViento(info.direccion)} sobre ${zona}`,
        rotura: "y acaba de girar",
        consecuencia:
          "el orden de prioridades ya no se sostiene y hay que volver a mirar qué zona va primero",
      };
    }
    case "sms":
      return {
        dependencia: "daba por hecho que la mensajería seguía operativa",
        rotura: "y se ha caído",
        consecuencia:
          "los avisos que salían por SMS se quedan sin enviar y hay que pasarlos a otro canal",
      };
    case "voz":
      return {
        dependencia: "daba por hecho que las llamadas seguían saliendo",
        rotura: "y el canal de voz se ha caído",
        consecuencia: "los avisos telefónicos se quedan sin cursar y hay que pasarlos a mensajería",
      };
    case "camas": {
      const zona = info.zoneName ? ` de ${info.zoneName}` : "";
      return {
        dependencia: `contaba con al menos ${info.minimo} camas libres en ${info.hospitalName}`,
        rotura: "y ya no las hay",
        consecuencia: `la evacuación sanitaria${zona} hacia ese hospital deja de caber y hay que buscar destino`,
      };
    }
    default: {
      const texto = (assumption.text ?? "el supuesto declarado").replace(/\.$/, "");
      return {
        dependencia: `contaba con que ${texto.charAt(0).toLowerCase()}${texto.slice(1)}`,
        rotura: "y ha dejado de cumplirse",
        consecuencia: "las acciones que dependían de ello dejan de sostenerse",
      };
    }
  }
}

/**
 * The text shown when a plan fails. Written as one operations chief
 * would explain to another: what was assumed, what happened, and what is
 * no longer valid. No identifiers or log jargon.
 */
export function explainInvalidation(brokenAssumptions: Assumption[], plan: Plan): string {
  const rotos = (brokenAssumptions ?? []).filter((assumption) => !!assumption);
  const version = plan?.version ?? 1;

  if (rotos.length === 0) {
    return `El plan v${version} sigue en pie: ninguno de sus supuestos se ha roto.`;
  }

  const [principal, ...resto] = rotos;
  const frases = frasesDeSupuesto(principal);
  const cabecera = `El plan v${version} ya no vale: ${frases.dependencia}, ${frases.rotura}.`;
  const efecto = `${mayuscula(frases.consecuencia)}, así que hay que rehacer el plan.`;

  if (resto.length === 0) return `${cabecera} ${efecto}`;

  const otros = resto
    .map((assumption) =>
      frasesDeSupuesto(assumption).dependencia.replace(
        /^(contaba con que |daba por hecho que )/,
        "",
      ),
    )
    .join("; ");
  return `${cabecera} ${efecto} También ha caído: ${otros}.`;
}

// ---------------------------------------------------------------------------
// Orchestration for store
//
// Single entry point in case the store prefers not to chain all four calls
// manually. Pure: takes plan, world, and actions and returns marked plan.
// ---------------------------------------------------------------------------

export interface PlanAssumptionOutcome {
  /** Plan with updated assumptions, `valid` and `invalidatedReason`. */
  plan: Plan;
  /** Those broken just now. Empty if plan still holds. */
  broken: Assumption[];
  /** Actions affected by breaks, deduplicated. */
  consequences: AssumptionConsequence[];
  /** true if this check is the one that invalidated the plan. */
  invalidated: boolean;
}

export function evaluatePlanAgainstWorld(
  plan: Plan,
  world: WorldState,
  actions: Action[],
  event?: CrisisEvent | null,
): PlanAssumptionOutcome {
  const check = checkAssumptions(plan?.assumptions ?? [], world, event);
  const rotos = [...check.broken, ...check.alreadyBroken];

  const consequences: AssumptionConsequence[] = [];
  const vistas = new Set<string>();
  for (const assumption of rotos) {
    for (const consecuencia of consequencesOfBreak(assumption, plan, actions)) {
      if (vistas.has(consecuencia.actionId)) continue;
      vistas.add(consecuencia.actionId);
      consequences.push(consecuencia);
    }
  }

  return {
    plan: {
      ...plan,
      assumptions: check.assumptions,
      valid: rotos.length === 0,
      invalidatedReason: rotos.length > 0 ? explainInvalidation(rotos, plan) : null,
    },
    broken: check.broken,
    consequences,
    invalidated: check.broken.length > 0,
  };
}
