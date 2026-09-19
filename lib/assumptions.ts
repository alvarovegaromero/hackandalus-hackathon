// PROPIETARIO: agente de supuestos vivos.
//
// Supuestos vivos: de qué depende el plan y cómo se entera el sistema de que
// ha dejado de depender de algo que ya no es cierto.
//
// El reto pregunta literalmente cuándo hay que tirar el plan: "el viento
// cambia y el plan de hace veinte minutos ya no se sostiene". Replanificar con
// cada señal no responde a eso, porque un plan que se rehace siempre no sabe
// nunca de qué dependía. Aquí cada plan declara sus dependencias y el mundo se
// contrasta contra ellas:
//
//   plan  ->  deriveAssumptions()  ->  supuestos que lo sostienen
//   señal ->  applyEventToWorld()  ->  nuevo estado del mundo
//   mundo ->  checkAssumptions()   ->  qué sigue en pie y qué se ha roto
//   roto  ->  explainInvalidation() + consequencesOfBreak()
//
// Cuatro reglas de diseño:
//
//  1. Todo determinista y puro. Ni modelos de lenguaje ni aleatoriedad: la
//     misma situación produce siempre los mismos supuestos y el mismo texto.
//  2. Los supuestos salen de decisiones reales del plan, no de una plantilla.
//     Si ningún medio cruza una carretera, no se declara nada sobre ella.
//  3. Pocos y legibles. Como mucho seis, porque el operador tiene que leerlos
//     en dos segundos, que es justo lo que pide el enunciado.
//  4. Un supuesto roto se queda roto. No se vuelve a romper ni resucita solo:
//     el único modo de volver a "ok" es que el plan siguiente lo redeclare.
//
// Un supuesto que ya es falso cuando se deriva NO se declara: un plan no puede
// apoyarse en algo que ya no se cumple. Y si el dato desaparece (deja de haber
// información de camas), el supuesto pasa a "unknown", no a "ok": fingir que
// se sostiene sería mentir al operador.

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
// Parámetros
// ---------------------------------------------------------------------------

/** Tope de supuestos por plan. Una lista larga no se lee en dos segundos. */
export const MAX_SUPUESTOS = 6;
/** Como mucho dos rutas: las de las dos zonas más prioritarias. */
const MAX_CARRETERAS = 2;
/** Un hospital, el de la zona más prioritaria que evacúa heridos. */
const MAX_HOSPITALES = 1;
/** Voz y mensajería, si el plan las usa. */
const MAX_CANALES = 2;
/** Camas libres por debajo de las cuales la evacuación sanitaria no cabe. */
export const UMBRAL_CAMAS = 10;

/** Estados de acción que siguen esperando que el supuesto se cumpla. */
const ESTADOS_VIVOS = new Set<ActionStatus>([
  "pending",
  "approved",
  "running",
  "blocked",
  "stalled",
]);

/**
 * Carreteras que unen cada par de zonas. Un medio que sale de su base hacia
 * otra zona depende de la suya, y es ese cruce el que genera el supuesto.
 * La clave es el par ordenado alfabéticamente, así que la tabla es simétrica.
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

/** Vía principal de cada zona, para las señales de corte que no citan carretera. */
const CARRETERA_PRINCIPAL: Record<string, string> = {
  "zone-north": "A-397",
  "zone-central": "A-4",
  "zone-east": "A-92",
  "zone-south": "A-7",
  "zone-islands": "A-381",
};

/** Hospital de referencia de cada zona para la evacuación sanitaria. */
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

/** Palabras que delatan que una acción mueve heridos o evacúa población. */
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
// Utilidades
// ---------------------------------------------------------------------------

/** Quita acentos y baja a minúsculas para poder comparar texto libre. */
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

/** Carretera que une dos zonas, o null si no hay ruta conocida entre ellas. */
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
// Lectura de un supuesto
//
// `variable` y `condition` son el contrato legible con la UI, y a la vez lo
// único que reciben `checkAssumptions`, `explainInvalidation` y
// `consequencesOfBreak`. Por eso la condición se escribe con etiquetas fijas
// ("destino: Sierra Morena (zone-north)"): se lee bien en pantalla y se puede
// volver a interpretar sin guardar estado por fuera.
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

/** Lee una etiqueta con forma `clave: Nombre visible (identificador)`. */
function etiqueta(condition: string, clave: string) {
  const match = new RegExp(`${clave}:\\s*([^()·]+?)\\s*\\(([^)]+)\\)`).exec(condition ?? "");
  return match ? { nombre: match[1].trim(), id: match[2].trim() } : null;
}

/** Traduce un supuesto a la decisión concreta que sostiene. */
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
// Evaluación contra el mundo
// ---------------------------------------------------------------------------

/**
 * Contrasta un supuesto con el estado del mundo. Sin dato no hay veredicto:
 * devuelve "unknown" en vez de dar por bueno lo que no se puede comprobar.
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
// 1. Derivación: de qué depende este plan
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
 * Declara de qué depende el plan actual, leyendo sus decisiones reales:
 * qué zona puso primero, qué medios movió y por dónde tienen que pasar, por
 * qué canal salen los avisos y hacia qué hospital se evacúa.
 *
 * Los supuestos que ya son falsos contra el mundo de ahora no se declaran: un
 * plan nuevo no puede apoyarse en una carretera que ya está cortada.
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

  // Viento: sostiene el orden de prioridades. Solo se declara si la zona que
  // va primera está realmente en juego, no por rellenar.
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

  // Carreteras: cada medio que sale de su base hacia otra zona depende de la
  // vía que las une. Sin cruce no hay supuesto.
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

  // Camas: una evacuación sanitaria apunta a un hospital concreto y ese
  // hospital tiene un límite.
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

  // Canales: si el plan manda avisos por un canal, depende de ese canal.
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

  // Un plan no puede declarar como supuesto algo que ya es falso. Los que no
  // se pueden comprobar sí se declaran, marcados como desconocidos.
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
// 2. Comprobación: qué sigue en pie
// ---------------------------------------------------------------------------

export interface AssumptionCheck {
  /** La lista completa, con el estado actualizado. Mismo orden que la entrada. */
  assumptions: Assumption[];
  /** Los que se han roto justo ahora. Son los que invalidan el plan. */
  broken: Assumption[];
  /** Los que ya estaban rotos antes: no se vuelven a romper ni se reanuncian. */
  alreadyBroken: Assumption[];
  /** Los que han dejado de poder comprobarse. */
  unknown: Assumption[];
  /** true si algún estado ha cambiado en esta comprobación. */
  changed: boolean;
}

/**
 * Contrasta los supuestos con el mundo. Determinista y sin efectos
 * secundarios: no muta la entrada ni consulta el reloj.
 *
 * Un supuesto roto se queda roto y conserva el evento que lo rompió, así que
 * una señal posterior no lo vuelve a anunciar ni lo resucita. Solo el plan
 * siguiente, al redeclarar sus supuestos, parte de cero.
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
// 3. Del evento al mundo
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

/** Lee la dirección del viento del texto de la señal, o null si no la cita. */
function direccionDeSenal(crudo: string, texto: string): string | null {
  // Primero el código en mayúsculas ("el viento gira al SO"), que es
  // inequívoco; después los nombres largos, del más largo al más corto para
  // que "sureste" no se lea como "este".
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

/** Carretera que cita la señal, o la vía principal de su zona. */
function carreteraDeSenal(event: CrisisEvent, crudo: string): string | null {
  const citada = /\b((?:AP|CA|MA|SE|GR|AL|CO|A|N|H|J)-\d{1,4})\b/.exec(crudo);
  if (citada) return citada[1];
  return CARRETERA_PRINCIPAL[event.zoneId] ?? null;
}

/**
 * Traduce una señal a un cambio del estado del mundo. Devuelve un mundo nuevo
 * y nunca muta el recibido; si la señal no afecta al mundo, devuelve el mismo
 * objeto, que es la forma barata de decir "aquí no ha pasado nada".
 *
 * La marca de tiempo del mundo es la de la señal, no la del reloj: así el
 * resultado es reproducible en pruebas y en una repetición de la demo.
 */
export function applyEventToWorld(world: WorldState, event: CrisisEvent): WorldState {
  if (!world || !event) return world;

  const categoria = normalizar(event.category ?? "");
  const crudo = `${event.title ?? ""} ${event.description ?? ""}`;
  const texto = normalizar(crudo);
  const cuando = event.createdAt ?? world.updatedAt;

  // --- Carreteras ---------------------------------------------------------
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

  // --- Viento -------------------------------------------------------------
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

  // --- Canales de comunicación -------------------------------------------
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
    // Si la señal no dice el canal, se entiende que habla de la mensajería:
    // es la integración que mueve los avisos masivos de la demo.
    const campo = esVoz ? "voiceOperational" : "smsOperational";
    if (world[campo] === operativo) return world;
    return { ...world, [campo]: operativo, updatedAt: cuando };
  }

  // --- Camas de hospital --------------------------------------------------
  if (/hospital|camas|beds|uci/.test(`${categoria} ${texto}`)) {
    const citado = /\b(hospital-[a-z0-9-]+)\b/.exec(normalizar(crudo))?.[1];
    const hospitalId = citado ?? HOSPITAL_POR_ZONA[event.zoneId];
    if (!hospitalId) return world;

    const beds = { ...(world.hospitalBeds ?? {}) };

    // El dato desaparece: el supuesto tiene que quedar en "desconocido", no
    // darse por bueno.
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
// 4. Consecuencias de una rotura
// ---------------------------------------------------------------------------

export interface AssumptionConsequence {
  actionId: string;
  objective: string;
  zoneId: string;
  /** "invalidada": ya no se puede ejecutar así. "en-riesgo": puede cambiar de orden. */
  effect: "invalidada" | "en-riesgo";
  reason: string;
}

/**
 * Qué acciones del plan dejan de tener sentido cuando cae un supuesto. Es la
 * mitad que el operador necesita para decidir: no basta con decir que el plan
 * ya no vale, hay que decir qué se cancela y por qué.
 */
export function consequencesOfBreak(
  assumption: Assumption,
  plan: Plan,
  actions: Action[],
): AssumptionConsequence[] {
  const info = interpretarSupuesto(assumption);
  const propuestas = new Set(plan?.proposedActionIds ?? []);
  const vivas = (actions ?? []).filter((action) => ESTADOS_VIVOS.has(action.status));
  // Si el plan enumera sus acciones, se respeta esa lista; si no, se miran
  // todas las vivas para no dejar consecuencias sin contar.
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
// 5. Explicación de la caída
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
 * El texto que se enseña cuando un plan cae. Se escribe como se lo contaría un
 * jefe de operaciones a otro: qué se daba por hecho, qué ha pasado y qué deja
 * de valer. Nada de identificadores ni de jerga de registro.
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
// Orquestación para el store
//
// Un solo punto de entrada por si el store prefiere no encadenar las cuatro
// llamadas a mano. No toca estado: recibe plan, mundo y acciones y devuelve el
// plan marcado.
// ---------------------------------------------------------------------------

export interface PlanAssumptionOutcome {
  /** El plan con los supuestos actualizados, `valid` e `invalidatedReason`. */
  plan: Plan;
  /** Los que se han roto justo ahora. Vacío si el plan sigue en pie. */
  broken: Assumption[];
  /** Acciones afectadas por las roturas, sin repetir. */
  consequences: AssumptionConsequence[];
  /** true si esta comprobación es la que ha tumbado el plan. */
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
