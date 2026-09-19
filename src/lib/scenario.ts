// OWNER: self-advancing scenario agent.
// Script engine: makes the situation evolve without anyone pressing buttons.
//
// Design decisions (documented because they govern the demo):
//
// 1. SCRIPT CLOCK, NOT TICK COUNTER. Progress is calculated from
//    elapsed real time, not from how many times it has been polled. Polling more
//    often does not accelerate the crisis and polling less does not freeze it:
//    upon checking again, the clock is already where it belongs.
// 2. AT MOST ONE BEAT PER TICK. If no one polls for a minute, the previous
//    version fired all overdue beats at once: six world changes
//    in the same instant, an unreadable plan diff, and an audit log
//    that looks like an error. Now it drains one by one.
// 3. OLD BEATS ARE SKIPPED, NOT REPLAYED. A beat describes the state
//    of the world at a given time; if more than STALE_AFTER_SECONDS of script time
//    have passed and there is a subsequent overdue beat, that older beat is superseded:
//    it is marked as skipped in runtime.skippedBeatIds (tracked, not
//    deleted) instead of replaying past history. The most recent
//    overdue beat is never skipped: the system jumps to the crisis present.
// 4. REAL PAUSE. Stopping preserves consumed script seconds; starting
//    again resumes where it was instead of returning to zero. To start from scratch,
//    it must be explicitly requested (restart) or switch scripts.
// 5. SPEED. A multiplier allows rehearsing at 4x and presenting at 1x without
//    touching the script. Changing it rebases the clock so as not to lose or gift
//    time already consumed.
//
// 6. COHERENT VISIBLE CLOCK. The UI renders the timer as
//    (now - scenario.startedAt), so startedAt is maintained as a *virtual*
//    start: the instant at which a script would have started without pauses
//    to be where it is now. The real start remains in runtime.startedAtReal.
//
// The ScenarioState type lives in lib/types.ts and cannot be modified, so extra
// state travels in a single `runtime` key attached to the object. It survives
// JSON cloning by the store, persistence, and reaches the UI.

import { seedScenarioBeats } from "./seed";
import type { ScenarioBeat, ScenarioState } from "./types";

// ---------------------------------------------------------------------------
// Engine parameters
// ---------------------------------------------------------------------------

/** Two beats are never fired in the same tick: the story is told in order. */
const MAX_BEATS_PER_TICK = 1;

/**
 * Script seconds an overdue beat can accumulate before being considered
 * superseded by a subsequent one. With beats separated by 35s, normal polling
 * (every 2-5s) never skips anything.
 */
const STALE_AFTER_SECONDS = 60;

/** Speed multiplier limits. */
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 10;

/** Default server heartbeat cadence. */
export const DEFAULT_HEARTBEAT_MS = 5000;

// ---------------------------------------------------------------------------
// Available scripts
// ---------------------------------------------------------------------------

export interface ScenarioScript {
  id: string;
  name: string;
  description: string;
  beats: ScenarioBeat[];
}

/**
 * Default script: wildfire in Sierra Morena. Beats live in lib/seed.ts
 * (another module's file) and are respected as-is.
 */
const wildfireScript: ScenarioScript = {
  id: "wildfire-andalucia",
  name: "Incendio forestal en Sierra Morena",
  description:
    "El frente avanza, el viento gira, una carretera se corta y un recurso cae mientras el sistema ejecuta acciones.",
  beats: seedScenarioBeats,
};

/** Alternative script: cascading blackout in the Guadalquivir valley. */
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

/** Alternative script: Guadalquivir flood and coastal storm. */
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
// Extra engine state
// ---------------------------------------------------------------------------

export interface ScenarioRuntime {
  /** Current script. */
  scriptId: string;
  /** Speed multiplier: 1 = real time, 4 = fast rehearsal. */
  speed: number;
  /** Script is paused midway (not finished). */
  paused: boolean;
  pausedAt: string | null;
  /** Script seconds consumed in closed segments. */
  accumulatedSeconds: number;
  /** Real instant (epoch ms) when current segment started. */
  segmentStartedAtMs: number | null;
  /** Beats deemed superseded without executing. */
  skippedBeatIds: string[];
  /** Instant when the script finished. */
  finishedAt: string | null;
  /**
   * Real instant of the original execution start. `scenario.startedAt`
   * is a *virtual* start (see syncVirtualStart), so honest data on
   * "when all this started" lives here.
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
 * Attaches (or repairs) extra state. Tolerant of states restored from
 * persistence saved with an older engine version.
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

  // A restored state may say "running" without an open segment: one is opened
  // now instead of calculating impossible elapsed time.
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

/** Normalizes an external speed value. Returns null if invalid. */
export function parseSpeed(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 100) / 100;
  if (rounded < MIN_SPEED || rounded > MAX_SPEED) return null;
  return rounded;
}

// ---------------------------------------------------------------------------
// Pending configuration
// ---------------------------------------------------------------------------

// HTTP routes cannot reach the live scenario object (it lives inside
// lib/store.ts, which is outside this module), so they leave configuration here
// and the engine consumes it in the next startScenario/dueBeats.

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

/** Clears pending configuration and heartbeat. Intended for tests and resets. */
export function resetScenarioEngine(): void {
  pendingConfig = {};
  stopHeartbeat();
}

// ---------------------------------------------------------------------------
// Script clock
// ---------------------------------------------------------------------------

function segmentSeconds(runtime: ScenarioRuntime, nowMs: number): number {
  if (runtime.segmentStartedAtMs === null) return 0;
  const realSeconds = Math.max(0, (nowMs - runtime.segmentStartedAtMs) / 1000);
  return realSeconds * runtime.speed;
}

/** Script seconds consumed up to `nowMs`. */
export function scriptSeconds(scenario: ScenarioState, nowMs = Date.now()): number {
  const target = withRuntime(scenario, nowMs);
  const runtime = target.runtime;
  if (!target.running) return runtime.accumulatedSeconds;
  return runtime.accumulatedSeconds + segmentSeconds(runtime, nowMs);
}

/** Closes current segment accumulating its time. Does not change running. */
function rebase(target: ScenarioStateWithRuntime, nowMs: number): void {
  const runtime = target.runtime;
  if (target.running) runtime.accumulatedSeconds += segmentSeconds(runtime, nowMs);
  runtime.segmentStartedAtMs = nowMs;
}

/**
 * Maintains `scenario.startedAt` as a VIRTUAL start: the instant at which
 * a script at 1x would have started without pauses to be right where it is now.
 *
 * The UI calculates its timer as (now - startedAt), so if startedAt were the
 * real start, a five-minute pause would display 5:20 while the script is at
 * 0:40 and the next beat would seem perpetually overdue. With the virtual
 * start, the timer aligns without touching the UI. The real start remains in
 * runtime.startedAtReal.
 */
function syncVirtualStart(target: ScenarioStateWithRuntime, nowMs: number, seconds: number): void {
  target.startedAt = new Date(nowMs - Math.max(0, seconds) * 1000).toISOString();
}

function applyPendingSpeed(target: ScenarioStateWithRuntime, nowMs: number): void {
  if (pendingConfig.speed === undefined) return;
  const speed = pendingConfig.speed;
  pendingConfig.speed = undefined;
  if (speed === target.runtime.speed) return;
  // Close the segment with the old speed to avoid losing or gifting time.
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
 * Deterministic ordering: first by instant, and on tie by original
 * script position. Two beats with the same atSeconds always fire in
 * the same order across runs.
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
// API consumed by lib/store.ts
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
 * Starts or RESUMES the script.
 *
 * Starts from scratch only if explicitly requested (configureScenario with
 * restart), if switching scripts, if never started, or if already finished.
 * In any other case, it resumes preserving consumed time: pressing "stop"
 * and "start" is pause/resume, not a covert restart.
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

  // Do not lose open segment if already running.
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
 * Pauses the script preserving consumed time. Resuming with startScenario
 * continues from the same point in the story.
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
 * Returns beats that should fire at this instant and marks them as
 * fired. store.ts applies them.
 *
 * Policy on interrupted polling: at most one beat per call; beats
 * overdue by more than STALE_AFTER_SECONDS with a subsequent overdue beat
 * are marked as skipped because they describe a superseded world.
 * The rest is drained in order, one beat per tick.
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

  // The last overdue beat is never skipped: it represents the crisis present.
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

/** Readable summary of engine state, useful for UI and debugging. */
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
// Server heartbeat
// ---------------------------------------------------------------------------

// A crisis does not wait for someone to look at the screen: while the script runs,
// a single interval advances the clock even if no one polls. Safeguards:
//  - The handle lives in globalThis, so a development module reload does not
//    leave two active intervals: ensureHeartbeat always clears the previous one
//    before installing its own (and the new closure points to the newly
//    loaded module, not the old one).
//  - unref(): the interval never keeps the process alive.
//  - Auto-shuts off as soon as the script stops running, and any exception in
//    the tick shuts it off too. A leaky timer is worse than none.
//  - Disabled in tests and when SCENARIO_AUTOTICK=0.
// The engine remains correct without a heartbeat (clock is real-time); the
// heartbeat only ensures changes materialize without observers.

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
 * Installs the heartbeat. `tick` must advance the scenario and return whether
 * the script is still running; as soon as it returns false (or throws), the heartbeat stops.
 */
export function ensureHeartbeat(
  tick: () => boolean,
  intervalMs: number = DEFAULT_HEARTBEAT_MS,
): "started" | "disabled" {
  if (!heartbeatEnabled()) return "disabled";

  // Always replaced: guarantees a single interval and that the active closure
  // is from the newest module after a hot reload.
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
