// PROPIETARIO: agente de persistencia, historial, auditoria y aprendizaje.
//
// Persistencia en ficheros JSON, sin dependencias nativas ni compilacion: en un
// hackathon, una compilacion nativa fallida el dia de la demo es un desastre.
//
// Tres garantias sostienen este modulo:
//
//  1. Nunca lanza. Un fallo de disco no puede tumbar el centro de mando, asi
//     que toda operacion devuelve un valor seguro (null, [], false) en vez de
//     propagar la excepcion.
//  2. Escritura atomica. Se escribe a un fichero temporal y se renombra, de
//     modo que un corte a mitad no deja un JSON truncado que impida arrancar.
//  3. Lo que se lee se valida. Un fichero viejo, truncado o de otra version del
//     esquema se descarta entero y se arranca de cero, porque store.ts accede a
//     `restored.plan.version` sin comprobarlo y un objeto incompleto reventaria
//     la aplicacion al arrancar.
//
// Ademas, nunca se escriben credenciales ni datos personales de contacto:
// telefonos y correos se borran antes de tocar el disco (AGENTS.md).

import fs from "node:fs";
import path from "node:path";
import { seedContacts } from "./seed";
import type { LearnedWeights, RunRecord, SituationState } from "./types";

// ---------------------------------------------------------------------------
// Configuracion
// ---------------------------------------------------------------------------

export const DATA_DIR = ".data";

/**
 * Version del esquema en disco. Subir este numero invalida automaticamente
 * todo lo guardado con el formato anterior: se descarta y se arranca limpio.
 */
export const SCHEMA_VERSION = 1;

export const STATE_FILE = "state.json";
export const RUNS_FILE = "runs.json";
export const WEIGHTS_FILE = "weights.json";

/** Ejecuciones guardadas como maximo; las mas antiguas se van cayendo. */
export const MAX_RUNS = 50;

/** Silencio necesario antes de volcar el estado a disco. */
export const SAVE_DEBOUNCE_MS = 500;

/** Retardo maximo tolerado: aunque no pare de haber cambios, se vuelca. */
export const SAVE_MAX_DELAY_MS = 4000;

/** true si la persistencia esta activada por configuracion. */
export function isPersistenceEnabled(): boolean {
  return process.env.CRISIS_PERSISTENCE === "on";
}

/** Directorio de datos. `CRISIS_DATA_DIR` lo redirige (lo usan los tests). */
export function resolveDataDir(): string {
  const override = process.env.CRISIS_DATA_DIR;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.resolve(process.cwd(), DATA_DIR);
}

function filePath(name: string): string {
  return path.join(resolveDataDir(), name);
}

// ---------------------------------------------------------------------------
// Diagnostico
// ---------------------------------------------------------------------------

export type PersistenceIssue =
  | "none"
  | "missing"
  | "unreadable"
  | "invalid-json"
  | "schema-mismatch"
  | "invalid-shape"
  | "write-failed";

interface Diagnostics {
  lastLoadIssue: PersistenceIssue;
  lastLoadDetail: string | null;
  lastWriteError: string | null;
  writes: number;
  skippedWrites: number;
}

const diagnostics: Diagnostics = {
  lastLoadIssue: "none",
  lastLoadDetail: null,
  lastWriteError: null,
  writes: 0,
  skippedWrites: 0,
};

/** Para poder ensenar en la UI o en el informe por que no se restauro nada. */
export function getPersistenceDiagnostics(): Diagnostics {
  return { ...diagnostics };
}

// ---------------------------------------------------------------------------
// Lectura y escritura atomica
// ---------------------------------------------------------------------------

interface Envelope<T> {
  schemaVersion: number;
  savedAt: string;
  payload: T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Lee un sobre del disco. Devuelve null ante cualquier problema: fichero
 * ausente, ilegible, JSON invalido, esquema antiguo o contenido inesperado.
 */
function readEnvelope<T>(name: string): T | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath(name), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    diagnostics.lastLoadIssue = code === "ENOENT" ? "missing" : "unreadable";
    diagnostics.lastLoadDetail = code ?? String(error);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Un JSON truncado por un corte a mitad de escritura cae aqui.
    diagnostics.lastLoadIssue = "invalid-json";
    diagnostics.lastLoadDetail = `${name} no es JSON valido`;
    return null;
  }

  if (!isRecord(parsed)) {
    diagnostics.lastLoadIssue = "invalid-shape";
    diagnostics.lastLoadDetail = `${name} no contiene un objeto`;
    return null;
  }

  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    diagnostics.lastLoadIssue = "schema-mismatch";
    diagnostics.lastLoadDetail = `${name} tiene esquema ${String(parsed.schemaVersion)}, se esperaba ${SCHEMA_VERSION}`;
    return null;
  }

  if (parsed.payload === undefined || parsed.payload === null) {
    diagnostics.lastLoadIssue = "invalid-shape";
    diagnostics.lastLoadDetail = `${name} no trae contenido`;
    return null;
  }

  diagnostics.lastLoadIssue = "none";
  diagnostics.lastLoadDetail = null;
  return parsed.payload as T;
}

/**
 * Escribe a un temporal y renombra. El renombrado es atomico dentro del mismo
 * sistema de ficheros, asi que el lector ve el fichero entero o el anterior,
 * nunca uno a medias.
 */
function writeEnvelope(name: string, payload: unknown): boolean {
  const dir = resolveDataDir();
  const target = path.join(dir, name);
  const temporary = path.join(dir, `.${name}.tmp-${process.pid}-${Date.now().toString(36)}`);

  const envelope: Envelope<unknown> = {
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    payload,
  };

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(envelope), "utf8");
    fs.renameSync(temporary, target);
    diagnostics.writes += 1;
    diagnostics.lastWriteError = null;
    return true;
  } catch (error) {
    diagnostics.lastWriteError = error instanceof Error ? error.message : String(error);
    diagnostics.lastLoadIssue =
      diagnostics.lastLoadIssue === "none" ? "none" : diagnostics.lastLoadIssue;
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Ni siquiera limpiar puede hacer fallar la demo.
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Saneado: fuera credenciales y datos de contacto
// ---------------------------------------------------------------------------

export const REDACTED_EMAIL = "[correo omitido]";
export const REDACTED_PHONE = "[telefono omitido]";

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/g;
const PHONE_PATTERN = /\+?\d[\d\s().-]{7,}\d/g;

function digitsOf(text: string): string {
  return text.replace(/\D/g, "");
}

/**
 * Decide si un numero parece un telefono y no una fecha, un identificador o un
 * numero de version. Preferimos no redactar de mas: perder texto util en el
 * registro tambien estorba.
 */
function looksLikePhone(match: string): boolean {
  const digits = digitsOf(match);
  if (digits.length < 9 || digits.length > 15) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(match)) return false; // fecha ISO
  if (match.trim().startsWith("+")) return true;
  const hasSeparator = /[\s().-]/.test(match);
  if (hasSeparator) return true;
  // Sin separadores solo redactamos lo que encaja con un numero espanol.
  return digits.length === 9 && /^[6789]/.test(digits);
}

/** Borra correos y telefonos de un texto libre antes de escribirlo. */
export function redact(text: string): string {
  return text
    .replace(EMAIL_PATTERN, REDACTED_EMAIL)
    .replace(PHONE_PATTERN, (match) => (looksLikePhone(match) ? REDACTED_PHONE : match));
}

function redactOptional<T extends string | null | undefined>(value: T): T {
  return (typeof value === "string" ? redact(value) : value) as T;
}

/**
 * Copia del estado apta para el disco: sin telefonos, sin correos y con los
 * textos libres filtrados por si alguien pego un contacto en una descripcion.
 */
export function sanitizeState(state: SituationState): SituationState {
  const copy = JSON.parse(JSON.stringify(state)) as SituationState;

  for (const contact of copy.contacts ?? []) {
    contact.phone = null;
    contact.email = null;
    contact.name = redact(contact.name);
  }

  for (const event of copy.events ?? []) {
    event.title = redact(event.title);
    event.description = redact(event.description);
  }

  for (const action of copy.actions ?? []) {
    action.target = redact(action.target);
    action.objective = redact(action.objective);
    action.reason = redact(action.reason);
    action.result = redactOptional(action.result);
    action.error = redactOptional(action.error);
  }

  for (const chain of copy.chains ?? []) {
    chain.objective = redact(chain.objective);
    for (const step of chain.steps ?? []) step.reason = redact(step.reason);
  }

  for (const entry of copy.audit ?? []) entry.summary = redact(entry.summary);

  const plans = [copy.plan, ...(copy.planHistory ?? [])].filter(Boolean);
  for (const plan of plans) {
    plan.summary = redact(plan.summary);
    plan.trigger = redact(plan.trigger);
    for (const priority of plan.priorities ?? []) priority.reason = redact(priority.reason);
    for (const change of plan.changes ?? []) {
      change.label = redact(change.label);
      change.detail = redact(change.detail);
    }
  }

  if (copy.scenario) {
    for (const beat of copy.scenario.beats ?? []) {
      beat.label = redact(beat.label);
      if (beat.event?.title) beat.event.title = redact(beat.event.title);
      if (beat.event?.description) beat.event.description = redact(beat.event.description);
    }
  }

  if (copy.integration) {
    copy.integration.lastExternalError = redactOptional(copy.integration.lastExternalError);
  }

  return copy;
}

/**
 * Devuelve a los contactos restaurados sus canales desde `seed.ts`. Los datos
 * de contacto viven en configuracion versionada, no en el fichero de estado,
 * asi que restaurar no puede resucitar un telefono que nunca guardamos.
 */
function rehydrateContactChannels(state: SituationState): SituationState {
  const bySeedId = new Map(seedContacts.map((contact) => [contact.id, contact]));
  for (const contact of state.contacts) {
    const seeded = bySeedId.get(contact.id);
    if (!seeded) continue;
    contact.phone = seeded.phone;
    contact.email = seeded.email;
  }
  return state;
}

// ---------------------------------------------------------------------------
// Validacion de lo que viene del disco
// ---------------------------------------------------------------------------

function hasArrays(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => Array.isArray(value[key]));
}

function isValidPlan(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.version !== "number" || !Number.isFinite(value.version)) return false;
  if (typeof value.summary !== "string") return false;
  if (typeof value.trigger !== "string") return false;
  if (typeof value.generatedAt !== "string") return false;
  if (value.previousVersion !== null && typeof value.previousVersion !== "number") return false;
  return hasArrays(value, ["priorities", "proposedActionIds", "invalidatedActionIds", "changes"]);
}

function isValidLearning(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isRecord(value.channelStats) || !isRecord(value.contactStats)) return false;
  if (typeof value.unconfirmedPenalty !== "number" || !Number.isFinite(value.unconfirmedPenalty))
    return false;
  return typeof value.runsAnalyzed === "number" && Number.isFinite(value.runsAnalyzed);
}

/**
 * Comprueba que lo leido es un estado completo y utilizable. store.ts hace
 * `restored.plan.version + 1` nada mas arrancar, asi que aqui somos estrictos:
 * a la minima duda devolvemos null y la aplicacion arranca con el estado semilla.
 */
export function validateState(value: unknown): SituationState | null {
  if (!isRecord(value)) return null;

  const required = [
    "events",
    "zones",
    "resources",
    "contacts",
    "chains",
    "actions",
    "planHistory",
    "audit",
  ];
  if (!hasArrays(value, required)) return null;
  if (!isValidPlan(value.plan)) return null;
  if (!(value.planHistory as unknown[]).every((plan) => isValidPlan(plan))) return null;

  const scenario = value.scenario;
  if (!isRecord(scenario)) return null;
  if (typeof scenario.running !== "boolean") return null;
  if (!hasArrays(scenario, ["beats", "firedBeatIds"])) return null;

  if (!isValidLearning(value.learning)) return null;

  const integration = value.integration;
  if (!isRecord(integration)) return null;
  if (integration.mode !== "happyrobot" && integration.mode !== "mock") return null;
  if (typeof integration.liveActionsExecuted !== "number") return null;
  if (typeof integration.mockActionsExecuted !== "number") return null;

  return value as unknown as SituationState;
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

/** Carga el estado guardado, o null si no hay nada utilizable. */
export function loadState(): SituationState | null {
  if (!isPersistenceEnabled()) return null;
  try {
    const payload = readEnvelope<unknown>(STATE_FILE);
    if (payload === null) return null;
    const validated = validateState(payload);
    if (!validated) {
      diagnostics.lastLoadIssue = "invalid-shape";
      diagnostics.lastLoadDetail = "el estado guardado no encaja con el esquema actual";
      return null;
    }
    return rehydrateContactChannels(validated);
  } catch (error) {
    // Defensa extra: ni un fallo inesperado puede impedir arrancar.
    diagnostics.lastLoadIssue = "unreadable";
    diagnostics.lastLoadDetail = error instanceof Error ? error.message : String(error);
    return null;
  }
}

// --- Escritura diferida ------------------------------------------------------
// saveState se llama en cada replanificacion. Escribir el estado entero cada vez
// machaca el disco sin necesidad, asi que agrupamos: se vuelca tras un rato de
// silencio, y como muy tarde a los SAVE_MAX_DELAY_MS. El ultimo estado nunca se
// pierde porque siempre se guarda el pendiente mas reciente.

let pendingState: SituationState | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let firstPendingAt = 0;
let exitHookInstalled = false;

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  try {
    process.on("exit", () => {
      flushState();
    });
  } catch {
    // Entornos sin `process.on` utilizable: se pierde el ultimo volcado, nada mas.
  }
}

function clearPendingTimer() {
  if (!pendingTimer) return;
  clearTimeout(pendingTimer);
  pendingTimer = null;
}

/** Vuelca ya lo que hubiera pendiente. Devuelve true si escribio algo. */
export function flushState(): boolean {
  clearPendingTimer();
  const state = pendingState;
  pendingState = null;
  firstPendingAt = 0;
  if (!state) return false;
  return writeEnvelope(STATE_FILE, sanitizeState(state));
}

/** Descarta lo pendiente sin escribirlo (util al limpiar en los tests). */
export function discardPendingState(): void {
  clearPendingTimer();
  pendingState = null;
  firstPendingAt = 0;
}

/** Guarda el estado. Nunca debe lanzar: un fallo de disco no puede tumbar la demo. */
export function saveState(state: SituationState): void {
  try {
    if (!isPersistenceEnabled()) {
      diagnostics.skippedWrites += 1;
      return;
    }
    installExitHook();

    pendingState = state;
    const now = Date.now();
    if (firstPendingAt === 0) firstPendingAt = now;

    // Si llevamos demasiado tiempo acumulando, escribimos sin esperar mas.
    if (now - firstPendingAt >= SAVE_MAX_DELAY_MS) {
      flushState();
      return;
    }

    clearPendingTimer();
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      flushState();
    }, SAVE_DEBOUNCE_MS);
    // Un volcado pendiente no debe mantener vivo el proceso ni colgar los tests.
    pendingTimer?.unref?.();
  } catch {
    // Por contrato, saveState no propaga nunca.
  }
}

// ---------------------------------------------------------------------------
// Ejecuciones y pesos aprendidos
// ---------------------------------------------------------------------------

function isValidRun(value: unknown): value is RunRecord {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.scenarioId !== "string") return false;
  if (typeof value.startedAt !== "string") return false;
  if (value.endedAt !== null && typeof value.endedAt !== "string") return false;
  const counters = ["actionsTotal", "actionsSucceeded", "actionsFailed", "planVersions"];
  if (
    !counters.every(
      (key) => typeof value[key] === "number" && Number.isFinite(value[key] as number),
    )
  )
    return false;
  return Array.isArray(value.notes) && value.notes.every((note) => typeof note === "string");
}

/** Historial de ejecuciones anteriores, para el bonus de aprendizaje. */
export function loadRuns(): RunRecord[] {
  if (!isPersistenceEnabled()) return [];
  try {
    const payload = readEnvelope<unknown>(RUNS_FILE);
    if (!Array.isArray(payload)) return [];
    // Una entrada rota no invalida el resto del historial: se descarta ella sola.
    return payload.filter(isValidRun);
  } catch {
    return [];
  }
}

/** Anade o actualiza una ejecucion. Se reescribe por id, asi que es idempotente. */
export function saveRun(run: RunRecord): void {
  try {
    if (!isPersistenceEnabled()) return;
    if (!isValidRun(run)) return;
    const existing = loadRuns().filter((candidate) => candidate.id !== run.id);
    const sanitized: RunRecord = { ...run, notes: run.notes.map(redact) };
    const next = [...existing, sanitized].slice(-MAX_RUNS);
    writeEnvelope(RUNS_FILE, next);
  } catch {
    // Perder una ejecucion del historial no puede tumbar la demo.
  }
}

export function loadWeights(): LearnedWeights | null {
  if (!isPersistenceEnabled()) return null;
  try {
    const payload = readEnvelope<unknown>(WEIGHTS_FILE);
    if (!isValidLearning(payload)) return null;
    const weights = payload as unknown as LearnedWeights;
    return {
      channelStats: weights.channelStats ?? {},
      contactStats: weights.contactStats ?? {},
      unconfirmedPenalty: weights.unconfirmedPenalty,
      runsAnalyzed: weights.runsAnalyzed,
      updatedAt: typeof weights.updatedAt === "string" ? weights.updatedAt : null,
    };
  } catch {
    return null;
  }
}

export function saveWeights(weights: LearnedWeights): void {
  try {
    if (!isPersistenceEnabled()) return;
    if (!isValidLearning(weights)) return;
    writeEnvelope(WEIGHTS_FILE, weights);
  } catch {
    // Igual que arriba: el aprendizaje es un extra, no un punto de fallo.
  }
}

/** Borra todo lo persistido. Solo para reinicios explicitos y para los tests. */
export function clearPersistedData(): void {
  discardPendingState();
  try {
    for (const name of [STATE_FILE, RUNS_FILE, WEIGHTS_FILE]) {
      fs.rmSync(filePath(name), { force: true });
    }
  } catch {
    // Nada que hacer si el disco no colabora.
  }
}
