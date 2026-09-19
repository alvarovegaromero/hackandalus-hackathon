// PROPIETARIO: agente del escenario que avanza solo.
// Motor del guion: hace que la situacion cambie sin que nadie pulse botones.
//
// Decisiones de diseno (documentadas porque condicionan la demo):
//
// 1. RELOJ DE GUION, NO CONTADOR DE TICKS. El avance se calcula a partir del
//    tiempo real transcurrido, no de cuantas veces se ha sondeado. Sondear mas
//    a menudo no acelera la crisis y sondear poco no la congela: al volver a
//    mirar, el reloj ya esta donde toca.
// 2. COMO MUCHO UN BEAT POR TICK. Si nadie sondea durante un minuto, la version
//    anterior disparaba de golpe todos los beats atrasados: seis cambios de
//    mundo en el mismo instante, un diff de plan ilegible y un registro de
//    auditoria que parece un error. Ahora se drena de uno en uno.
// 3. LOS BEATS VIEJOS SE OMITEN, NO SE REPRODUCEN. Un beat describe el estado
//    del mundo en un momento; si han pasado mas de STALE_AFTER_SECONDS de guion
//    y ademas hay un beat posterior ya vencido, ese beat antiguo esta superado:
//    se marca como omitido en runtime.skippedBeatIds (queda trazado, no se
//    borra) en lugar de reproducir historia pasada. El beat mas reciente
//    vencido nunca se omite: el sistema salta al presente de la crisis.
// 4. PAUSA REAL. Parar conserva los segundos de guion consumidos; arrancar de
//    nuevo reanuda donde estaba en vez de volver a cero. Para empezar de cero
//    hay que pedirlo explicitamente (restart) o cambiar de guion.
// 5. VELOCIDAD. Un multiplicador permite ensayar a 4x y presentar a 1x sin
//    tocar el guion. Al cambiarlo se rebasa el reloj para no perder ni regalar
//    tiempo ya consumido.
//
// 6. RELOJ VISIBLE COHERENTE. La interfaz pinta el cronometro como
//    (ahora - scenario.startedAt), asi que startedAt se mantiene como un inicio
//    *virtual*: el instante en que habria arrancado un guion sin pausas para
//    estar donde esta. El arranque real queda en runtime.startedAtReal.
//
// El tipo ScenarioState vive en lib/types.ts y no se puede tocar, asi que el
// estado extra viaja en una unica clave `runtime` adosada al objeto. Sobrevive
// al clonado JSON del store, a la persistencia y llega a la UI.

import { seedScenarioBeats } from "./seed";
import type { ScenarioBeat, ScenarioState } from "./types";

// ---------------------------------------------------------------------------
// Parametros del motor
// ---------------------------------------------------------------------------

/** Nunca se disparan dos beats en el mismo tick: la historia se cuenta en orden. */
const MAX_BEATS_PER_TICK = 1;

/**
 * Segundos de guion que puede acumular un beat vencido antes de considerarse
 * superado por otro posterior. Con beats separados 35 s, un sondeo normal
 * (cada 2-5 s) jamas omite nada.
 */
const STALE_AFTER_SECONDS = 60;

/** Limites del multiplicador de velocidad. */
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 10;

/** Cadencia por defecto del latido de servidor. */
export const DEFAULT_HEARTBEAT_MS = 5000;

// ---------------------------------------------------------------------------
// Guiones disponibles
// ---------------------------------------------------------------------------

export interface ScenarioScript {
  id: string;
  name: string;
  description: string;
  beats: ScenarioBeat[];
}

/**
 * Guion por defecto: incendio en Sierra Morena. Los beats viven en lib/seed.ts
 * (fichero de otro modulo) y se respetan tal cual.
 */
const wildfireScript: ScenarioScript = {
  id: "wildfire-andalucia",
  name: "Incendio forestal en Sierra Morena",
  description:
    "El frente avanza, el viento gira, una carretera se corta y un recurso cae mientras el sistema ejecuta acciones.",
  beats: seedScenarioBeats,
};

/** Guion alternativo: apagon en cascada sobre el valle del Guadalquivir. */
const blackoutScript: ScenarioScript = {
  id: "blackout-guadalquivir",
  name: "Apagón en cascada en el valle del Guadalquivir",
  description:
    "Cae un nudo eléctrico, los hospitales tiran de grupos electrógenos, las comunicaciones se degradan y hay que decidir qué se restablece primero.",
  beats: [
    {
      id: "blackout-1",
      atSeconds: 20,
      label: "Cae el nudo eléctrico de Sevilla: 180.000 hogares sin suministro",
      event: {
        source: "scenario",
        title: "Caída del nudo eléctrico de Sevilla",
        description:
          "Red Eléctrica confirma la pérdida de la subestación que alimenta el área metropolitana. Sin estimación de reposición.",
        zoneId: "zone-central",
        category: "apagon",
        severity: "high",
        confidence: "high",
        confirmed: true,
      },
    },
    {
      id: "blackout-2",
      atSeconds: 50,
      label: "El hospital pasa a grupos electrógenos: seis horas de autonomía",
      event: {
        source: "scenario",
        title: "Hospital en grupos electrógenos con autonomía limitada",
        description:
          "El hospital de referencia funciona con generadores y da seis horas de margen. Quirófanos y UCI pasan a ser prioridad absoluta.",
        zoneId: "zone-central",
        category: "suministro critico",
        severity: "critical",
        confidence: "high",
        confirmed: true,
      },
    },
    {
      id: "blackout-3",
      atSeconds: 85,
      label: "Semáforos apagados: accesos cortados y tráfico colapsado",
      demoKind: "route-blocked",
    },
    {
      id: "blackout-4",
      atSeconds: 120,
      label: "Los repetidores de telefonía agotan batería: comarcas incomunicadas",
      event: {
        source: "scenario",
        title: "Repetidores sin batería en la Alpujarra",
        description:
          "Varias comarcas quedan sin cobertura móvil. Las llamadas dejan de ser un canal fiable y hay que buscar alternativas.",
        zoneId: "zone-east",
        category: "comunicaciones",
        severity: "high",
        confidence: "medium",
        confirmed: null,
      },
    },
    {
      id: "blackout-5",
      atSeconds: 155,
      label: "Un equipo desplegado se queda sin combustible y cae del dispositivo",
      demoKind: "resource-down",
    },
    {
      id: "blackout-6",
      atSeconds: 190,
      label: "Residencias de mayores sin climatización ni ascensores",
      event: {
        source: "scenario",
        title: "Residencias de mayores sin climatización",
        description:
          "Centros con personas dependientes en plantas altas, sin ascensor y con calor. Requiere evacuación selectiva.",
        zoneId: "zone-south",
        category: "poblacion vulnerable",
        severity: "critical",
        confidence: "medium",
        confirmed: null,
      },
    },
    {
      id: "blackout-7",
      atSeconds: 225,
      label: "La mensajería masiva deja de confirmar envíos",
      demoKind: "integration-failure",
    },
  ],
};

/** Guion alternativo: crecida del Guadalquivir y temporal en el litoral. */
const floodScript: ScenarioScript = {
  id: "flood-guadalquivir",
  name: "Crecida del Guadalquivir y temporal en el litoral",
  description:
    "El río supera el nivel de alerta, se abre un desembalse de emergencia, se corta la A-4 y los refugios se llenan antes de tiempo.",
  beats: [
    {
      id: "flood-1",
      atSeconds: 20,
      label: "El Guadalquivir supera el nivel de alerta a su paso por Sevilla",
      event: {
        source: "scenario",
        title: "Nivel de alerta superado en el Guadalquivir",
        description:
          "Los aforos confirman que el río rebasa el umbral de alerta y sigue subiendo tras las lluvias en cabecera.",
        zoneId: "zone-central",
        category: "inundacion",
        severity: "high",
        confidence: "high",
        confirmed: true,
      },
    },
    {
      id: "flood-2",
      atSeconds: 55,
      label: "Desembalse de emergencia: dos horas para evacuar la vega",
      event: {
        source: "scenario",
        title: "Desembalse de emergencia aguas arriba",
        description:
          "La confederación abre compuertas. La evacuación preventiva de la vega deja de ser opcional y pasa a tener plazo.",
        zoneId: "zone-central",
        category: "evacuacion",
        severity: "critical",
        confidence: "high",
        confirmed: true,
      },
    },
    {
      id: "flood-3",
      atSeconds: 90,
      label: "La carretera de acceso queda cortada por la crecida",
      demoKind: "route-blocked",
    },
    {
      id: "flood-4",
      atSeconds: 125,
      label: "Temporal marítimo en el Estrecho: el relevo logístico no sale",
      event: {
        source: "scenario",
        title: "Temporal marítimo bloquea el enlace logístico",
        description:
          "El puerto suspende salidas. El material de refugio previsto para esta noche no llegará por mar.",
        zoneId: "zone-islands",
        category: "logistica",
        severity: "high",
        confidence: "medium",
        confirmed: null,
      },
    },
    {
      id: "flood-5",
      atSeconds: 160,
      label: "Una embarcación de rescate queda fuera de servicio",
      demoKind: "resource-down",
    },
    {
      id: "flood-6",
      atSeconds: 195,
      label: "Los refugios de la costa superan su capacidad",
      event: {
        source: "scenario",
        title: "Refugios de la Costa del Sol al límite",
        description:
          "Llegan más desplazados de los previstos y la capacidad de acogida se agota antes de lo planificado.",
        zoneId: "zone-south",
        category: "refugio",
        severity: "high",
        confidence: "medium",
        confirmed: null,
      },
    },
    {
      id: "flood-7",
      atSeconds: 230,
      label: "El proveedor de SMS deja de confirmar entregas",
      demoKind: "integration-failure",
    },
  ],
};

export const DEFAULT_SCRIPT_ID = wildfireScript.id;

export const scenarioScripts: ScenarioScript[] = [wildfireScript, blackoutScript, floodScript];

export function findScript(id: string): ScenarioScript | undefined {
  return scenarioScripts.find((script) => script.id === id);
}

export function listScenarioScripts() {
  return scenarioScripts.map((script) => ({
    id: script.id,
    name: script.name,
    description: script.description,
    beats: script.beats.length,
    durationSeconds: script.beats.reduce((max, beat) => Math.max(max, beat.atSeconds), 0),
  }));
}

// ---------------------------------------------------------------------------
// Estado extra del motor
// ---------------------------------------------------------------------------

export interface ScenarioRuntime {
  /** Guion en curso. */
  scriptId: string;
  /** Multiplicador de velocidad: 1 = tiempo real, 4 = ensayo rapido. */
  speed: number;
  /** El guion esta pausado a mitad (no terminado). */
  paused: boolean;
  pausedAt: string | null;
  /** Segundos de guion consumidos en tramos ya cerrados. */
  accumulatedSeconds: number;
  /** Instante real (epoch ms) en que empezo el tramo en curso. */
  segmentStartedAtMs: number | null;
  /** Beats que se dieron por superados sin llegar a ejecutarse. */
  skippedBeatIds: string[];
  /** Instante en que se agoto el guion. */
  finishedAt: string | null;
  /**
   * Instante real del arranque original de la ejecucion. `scenario.startedAt`
   * es un inicio *virtual* (ver syncVirtualStart), asi que el dato honesto de
   * "cuando empezo todo esto" vive aqui.
   */
  startedAtReal: string | null;
}

export type ScenarioStateWithRuntime = ScenarioState & { runtime: ScenarioRuntime };

function defaultRuntime(scriptId: string): ScenarioRuntime {
  return {
    scriptId,
    speed: 1,
    paused: false,
    pausedAt: null,
    accumulatedSeconds: 0,
    segmentStartedAtMs: null,
    skippedBeatIds: [],
    finishedAt: null,
    startedAtReal: null,
  };
}

/**
 * Adosa (o repara) el estado extra. Es tolerante con estados restaurados de
 * persistencia que se guardaron con una version anterior del motor.
 */
export function withRuntime(scenario: ScenarioState, nowMs = Date.now()): ScenarioStateWithRuntime {
  const target = scenario as ScenarioStateWithRuntime;
  const existing = target.runtime as Partial<ScenarioRuntime> | undefined;
  const base = defaultRuntime(scenario.id);

  target.runtime = {
    scriptId: typeof existing?.scriptId === "string" ? existing.scriptId : base.scriptId,
    speed: isUsableSpeed(existing?.speed) ? (existing?.speed as number) : base.speed,
    paused: existing?.paused === true,
    pausedAt: typeof existing?.pausedAt === "string" ? existing.pausedAt : null,
    accumulatedSeconds:
      typeof existing?.accumulatedSeconds === "number" &&
      Number.isFinite(existing.accumulatedSeconds)
        ? Math.max(0, existing.accumulatedSeconds)
        : base.accumulatedSeconds,
    segmentStartedAtMs:
      typeof existing?.segmentStartedAtMs === "number" &&
      Number.isFinite(existing.segmentStartedAtMs)
        ? existing.segmentStartedAtMs
        : null,
    skippedBeatIds: Array.isArray(existing?.skippedBeatIds)
      ? [...(existing.skippedBeatIds as string[])]
      : [],
    finishedAt: typeof existing?.finishedAt === "string" ? existing.finishedAt : null,
    startedAtReal:
      typeof existing?.startedAtReal === "string"
        ? existing.startedAtReal
        : (scenario.startedAt ?? null),
  };

  // Un estado restaurado puede decir "corriendo" sin tramo abierto: se abre uno
  // ahora en vez de calcular un tiempo transcurrido imposible.
  if (target.running && target.runtime.segmentStartedAtMs === null) {
    target.runtime.segmentStartedAtMs = nowMs;
  }

  return target;
}

function isUsableSpeed(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= MIN_SPEED && value <= MAX_SPEED
  );
}

/** Normaliza una velocidad recibida de fuera. Devuelve null si no es valida. */
export function parseSpeed(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 100) / 100;
  if (rounded < MIN_SPEED || rounded > MAX_SPEED) return null;
  return rounded;
}

// ---------------------------------------------------------------------------
// Configuracion pendiente
// ---------------------------------------------------------------------------

// Las rutas HTTP no pueden alcanzar el objeto de escenario vivo (vive dentro de
// lib/store.ts, que no es de este modulo), asi que dejan aqui la configuracion
// y el motor la consume en el siguiente startScenario/dueBeats.

export interface ScenarioConfig {
  speed?: number;
  scriptId?: string;
  restart?: boolean;
}

let pendingConfig: ScenarioConfig = {};

export function configureScenario(config: ScenarioConfig): void {
  if (config.speed !== undefined) {
    const speed = parseSpeed(config.speed);
    if (speed !== null) pendingConfig.speed = speed;
  }
  if (typeof config.scriptId === "string" && findScript(config.scriptId)) {
    pendingConfig.scriptId = config.scriptId;
  }
  if (config.restart === true) pendingConfig.restart = true;
}

/** Limpia configuracion pendiente y latido. Pensado para tests y reinicios. */
export function resetScenarioEngine(): void {
  pendingConfig = {};
  stopHeartbeat();
}

// ---------------------------------------------------------------------------
// Reloj de guion
// ---------------------------------------------------------------------------

function segmentSeconds(runtime: ScenarioRuntime, nowMs: number): number {
  if (runtime.segmentStartedAtMs === null) return 0;
  const realSeconds = Math.max(0, (nowMs - runtime.segmentStartedAtMs) / 1000);
  return realSeconds * runtime.speed;
}

/** Segundos de guion consumidos hasta `nowMs`. */
export function scriptSeconds(scenario: ScenarioState, nowMs = Date.now()): number {
  const target = withRuntime(scenario, nowMs);
  const runtime = target.runtime;
  if (!target.running) return runtime.accumulatedSeconds;
  return runtime.accumulatedSeconds + segmentSeconds(runtime, nowMs);
}

/** Cierra el tramo en curso acumulando su tiempo. No cambia running. */
function rebase(target: ScenarioStateWithRuntime, nowMs: number): void {
  const runtime = target.runtime;
  if (target.running) runtime.accumulatedSeconds += segmentSeconds(runtime, nowMs);
  runtime.segmentStartedAtMs = nowMs;
}

/**
 * Mantiene `scenario.startedAt` como un inicio VIRTUAL: el instante en que
 * habria arrancado un guion a 1x sin pausas para estar justo donde esta ahora.
 *
 * La interfaz calcula su cronometro como (ahora - startedAt), asi que si
 * startedAt fuese el arranque real, una pausa de cinco minutos pintaria 5:20
 * mientras el guion va por 0:40 y el proximo beat pareceria eternamente
 * atrasado. Con el inicio virtual el cronometro cuadra sin tocar la interfaz.
 * El arranque real queda en runtime.startedAtReal.
 */
function syncVirtualStart(target: ScenarioStateWithRuntime, nowMs: number, seconds: number): void {
  target.startedAt = new Date(nowMs - Math.max(0, seconds) * 1000).toISOString();
}

function applyPendingSpeed(target: ScenarioStateWithRuntime, nowMs: number): void {
  if (pendingConfig.speed === undefined) return;
  const speed = pendingConfig.speed;
  pendingConfig.speed = undefined;
  if (speed === target.runtime.speed) return;
  // Se cierra el tramo con la velocidad vieja para no perder ni regalar tiempo.
  rebase(target, nowMs);
  target.runtime.speed = speed;
}

// ---------------------------------------------------------------------------
// Beats
// ---------------------------------------------------------------------------

function cloneBeats(beats: ScenarioBeat[]): ScenarioBeat[] {
  return JSON.parse(JSON.stringify(beats)) as ScenarioBeat[];
}

/**
 * Orden determinista: primero por instante, y ante empate por la posicion
 * original en el guion. Dos beats con el mismo atSeconds siempre se disparan en
 * el mismo orden, ejecucion tras ejecucion.
 */
export function orderedBeats(scenario: ScenarioState): ScenarioBeat[] {
  return scenario.beats
    .map((beat, index) => ({ beat, index }))
    .sort((a, b) => a.beat.atSeconds - b.beat.atSeconds || a.index - b.index)
    .map((entry) => entry.beat);
}

function isSettled(target: ScenarioStateWithRuntime, beat: ScenarioBeat): boolean {
  return target.firedBeatIds.includes(beat.id) || target.runtime.skippedBeatIds.includes(beat.id);
}

function finishIfExhausted(target: ScenarioStateWithRuntime, nowMs: number): void {
  const remaining = target.beats.filter((beat) => !isSettled(target, beat));
  if (remaining.length > 0) return;
  if (target.running) rebase(target, nowMs);
  target.running = false;
  target.runtime.paused = false;
  target.runtime.finishedAt ??= new Date(nowMs).toISOString();
  target.elapsedSeconds = Math.max(0, Math.round(target.runtime.accumulatedSeconds));
}

// ---------------------------------------------------------------------------
// API que consume lib/store.ts
// ---------------------------------------------------------------------------

export function createScenarioState(scriptId: string = DEFAULT_SCRIPT_ID): ScenarioState {
  const script = findScript(scriptId) ?? wildfireScript;
  const scenario: ScenarioState = {
    id: script.id,
    name: script.name,
    description: script.description,
    running: false,
    startedAt: null,
    elapsedSeconds: 0,
    beats: cloneBeats(script.beats),
    firedBeatIds: [],
  };
  return withRuntime(scenario);
}

function applyScript(target: ScenarioStateWithRuntime, script: ScenarioScript): void {
  target.id = script.id;
  target.name = script.name;
  target.description = script.description;
  target.beats = cloneBeats(script.beats);
  target.runtime.scriptId = script.id;
}

/**
 * Arranca o REANUDA el guion.
 *
 * Empieza de cero solo si se pide explicitamente (configureScenario con
 * restart), si se cambia de guion, si nunca habia arrancado o si ya habia
 * terminado. En cualquier otro caso reanuda conservando el tiempo consumido:
 * pulsar "parar" y "arrancar" es pausa/reanudacion, no un reinicio encubierto.
 */
export function startScenario(scenario: ScenarioState, at: string): ScenarioState {
  const parsed = Date.parse(at);
  const atMs = Number.isNaN(parsed) ? Date.now() : parsed;
  const atIso = Number.isNaN(parsed) ? new Date(atMs).toISOString() : at;
  const target = withRuntime(scenario, atMs);
  const runtime = target.runtime;

  const requestedScriptId = pendingConfig.scriptId;
  const requestedRestart = pendingConfig.restart === true;
  applyPendingSpeed(target, atMs);
  pendingConfig.scriptId = undefined;
  pendingConfig.restart = undefined;

  // No perder el tramo abierto si ya estaba corriendo.
  if (target.running) rebase(target, atMs);

  const script = requestedScriptId ? findScript(requestedScriptId) : undefined;
  const scriptChanged = Boolean(script && script.id !== runtime.scriptId);
  if (script && scriptChanged) applyScript(target, script);

  const neverStarted = target.startedAt === null;
  const exhausted =
    runtime.finishedAt !== null || target.beats.every((beat) => isSettled(target, beat));
  const fresh = scriptChanged || requestedRestart || neverStarted || exhausted;

  if (fresh) {
    target.firedBeatIds = [];
    target.elapsedSeconds = 0;
    runtime.accumulatedSeconds = 0;
    runtime.skippedBeatIds = [];
    runtime.finishedAt = null;
    runtime.startedAtReal = atIso;
  } else {
    runtime.startedAtReal ??= atIso;
  }

  syncVirtualStart(target, atMs, runtime.accumulatedSeconds);
  runtime.segmentStartedAtMs = atMs;
  runtime.paused = false;
  runtime.pausedAt = null;
  target.running = true;
  return target;
}

/**
 * Pausa el guion conservando el tiempo consumido. Reanudar con startScenario
 * continua desde el mismo punto del relato.
 */
export function stopScenario(scenario: ScenarioState, atMs = Date.now()): ScenarioState {
  const target = withRuntime(scenario, atMs);
  if (target.running) rebase(target, atMs);
  target.running = false;
  target.runtime.segmentStartedAtMs = null;
  target.elapsedSeconds = Math.max(0, Math.round(target.runtime.accumulatedSeconds));
  if (target.startedAt !== null) syncVirtualStart(target, atMs, target.runtime.accumulatedSeconds);

  const exhausted = target.beats.every((beat) => isSettled(target, beat));
  target.runtime.paused = !exhausted && target.startedAt !== null;
  target.runtime.pausedAt = target.runtime.paused
    ? new Date(atMs).toISOString()
    : target.runtime.pausedAt;
  return target;
}

/**
 * Devuelve los beats que deben dispararse en este instante y los marca como
 * disparados. store.ts se encarga de aplicarlos.
 *
 * Politica ante un sondeo interrumpido: como mucho un beat por llamada; los
 * beats vencidos hace mas de STALE_AFTER_SECONDS que ya tienen otro posterior
 * vencido se marcan como omitidos, porque describen un mundo que ya quedo
 * atras. El resto se drena en orden, un beat por tick.
 */
export function dueBeats(scenario: ScenarioState, nowMs: number): ScenarioBeat[] {
  const target = withRuntime(scenario, nowMs);
  applyPendingSpeed(target, nowMs);
  if (!target.running || !target.startedAt) return [];

  const seconds = target.runtime.accumulatedSeconds + segmentSeconds(target.runtime, nowMs);
  target.elapsedSeconds = Math.max(0, Math.round(seconds));
  syncVirtualStart(target, nowMs, seconds);

  const due = orderedBeats(target).filter(
    (beat) => !isSettled(target, beat) && beat.atSeconds <= seconds,
  );
  if (due.length === 0) return [];

  // El ultimo vencido nunca se omite: representa el presente de la crisis.
  const superseded = due
    .slice(0, -1)
    .filter((beat) => seconds - beat.atSeconds > STALE_AFTER_SECONDS)
    .map((beat) => beat.id);
  for (const id of superseded) target.runtime.skippedBeatIds.push(id);

  const fired = due.filter((beat) => !superseded.includes(beat.id)).slice(0, MAX_BEATS_PER_TICK);
  for (const beat of fired) target.firedBeatIds.push(beat.id);

  finishIfExhausted(target, nowMs);
  return fired;
}

/** Resumen legible del estado del motor, util para la UI y para depurar. */
export function scenarioStatus(scenario: ScenarioState, nowMs = Date.now()) {
  const target = withRuntime(scenario, nowMs);
  const total = target.beats.length;
  const settled = target.beats.filter((beat) => isSettled(target, beat)).length;
  const next = orderedBeats(target).find((beat) => !isSettled(target, beat)) ?? null;
  return {
    scriptId: target.runtime.scriptId,
    running: target.running,
    paused: target.runtime.paused,
    finished: target.runtime.finishedAt !== null,
    speed: target.runtime.speed,
    elapsedSeconds: Math.round(scriptSeconds(target, nowMs)),
    firedBeats: target.firedBeatIds.length,
    skippedBeats: target.runtime.skippedBeatIds.length,
    remainingBeats: total - settled,
    nextBeat: next ? { id: next.id, atSeconds: next.atSeconds, label: next.label } : null,
  };
}

// ---------------------------------------------------------------------------
// Latido de servidor
// ---------------------------------------------------------------------------

// Una crisis no espera a que alguien mire la pantalla: mientras el guion corre,
// un unico intervalo empuja el reloj aunque nadie sondee. Precauciones:
//  - El handle vive en globalThis, asi que una recarga de modulo en desarrollo
//    no deja dos intervalos vivos: ensureHeartbeat siempre limpia el anterior
//    antes de instalar el suyo (y ademas el nuevo cierre apunta al modulo
//    recien cargado, no al viejo).
//  - unref(): el intervalo jamas mantiene vivo el proceso.
//  - Se apaga solo en cuanto el guion deja de correr, y cualquier excepcion en
//    el tick lo apaga tambien. Un temporizador con fugas es peor que ninguno.
//  - Desactivado en tests y con SCENARIO_AUTOTICK=0.
// El motor sigue siendo correcto sin latido (el reloj es por tiempo real); el
// latido solo hace que los cambios se materialicen sin espectadores.

interface ScenarioHeartbeat {
  timer: ReturnType<typeof setInterval>;
  intervalMs: number;
  startedAt: string;
}

declare global {
  var crisisScenarioHeartbeat: ScenarioHeartbeat | undefined;
}

export function heartbeatEnabled(): boolean {
  if (process.env.SCENARIO_AUTOTICK === "0") return false;
  if (process.env.VITEST) return false;
  return process.env.NODE_ENV !== "test";
}

export function heartbeatStatus(): { running: boolean; intervalMs: number | null } {
  const beat = globalThis.crisisScenarioHeartbeat;
  return { running: Boolean(beat), intervalMs: beat?.intervalMs ?? null };
}

export function stopHeartbeat(): void {
  const beat = globalThis.crisisScenarioHeartbeat;
  if (!beat) return;
  clearInterval(beat.timer);
  globalThis.crisisScenarioHeartbeat = undefined;
}

/**
 * Instala el latido. `tick` debe avanzar el escenario y devolver si el guion
 * sigue corriendo; en cuanto devuelva false (o lance), el latido se apaga.
 */
export function ensureHeartbeat(
  tick: () => boolean,
  intervalMs: number = DEFAULT_HEARTBEAT_MS,
): "started" | "disabled" {
  if (!heartbeatEnabled()) return "disabled";

  // Siempre se reemplaza: garantiza un unico intervalo y que el cierre activo
  // sea el del modulo mas reciente tras una recarga en caliente.
  stopHeartbeat();

  const safeInterval = Math.min(Math.max(Math.round(intervalMs), 1000), 60_000);
  const timer = setInterval(() => {
    let keepGoing = false;
    try {
      keepGoing = tick();
    } catch {
      keepGoing = false;
    }
    if (!keepGoing) stopHeartbeat();
  }, safeInterval);

  (timer as { unref?: () => void }).unref?.();
  globalThis.crisisScenarioHeartbeat = {
    timer,
    intervalMs: safeInterval,
    startedAt: new Date().toISOString(),
  };
  return "started";
}
