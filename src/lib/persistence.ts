// OWNER: persistence, history, audit, and learning agent.
//
// JSON file persistence, without native dependencies or compilation: in a
// hackathon, a failed native build on demo day is a disaster.
//
// Three guarantees support this module:
//
//  1. Never throws. A disk failure must not crash the command center, so
//     every operation returns a safe default (null, [], false) instead of
//     propagating the exception.
//  2. Atomic write. Writes to a temporary file and renames, ensuring
//     an interruption midway does not leave truncated JSON preventing startup.
//  3. Validate on read. An old, truncated, or mismatched schema version file
//     is discarded entirely and starts fresh, because store.ts accesses
//     `restored.plan.version` directly and an incomplete object would crash
//     the app on startup.
//
// Additionally, credentials and personal contact details are never written:
// phone numbers and emails are redacted before touching disk (AGENTS.md).

import fs from "node:fs";
import path from "node:path";
import { seedContacts } from "./seed";
import type { LearnedWeights, RunRecord, SituationState } from "./types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const DATA_DIR = ".data";

/**
 * Schema version on disk. Bumping this number automatically invalidates
 * anything stored in the previous format: discarded and starts clean.
 */
export const SCHEMA_VERSION = 1;

export const STATE_FILE = "state.json";
export const RUNS_FILE = "runs.json";
export const WEIGHTS_FILE = "weights.json";

/** Maximum saved runs; older ones are dropped. */
export const MAX_RUNS = 50;

/** Required silence period before flushing state to disk. */
export const SAVE_DEBOUNCE_MS = 500;

/** Maximum tolerated delay: flushes even under continuous changes. */
export const SAVE_MAX_DELAY_MS = 4000;

/** true if persistence is enabled by configuration. */
export function isPersistenceEnabled(): boolean {
  return process.env.CRISIS_PERSISTENCE === "on";
}

/** Data directory. `CRISIS_DATA_DIR` redirects it (used by tests). */
export function resolveDataDir(): string {
  const override = process.env.CRISIS_DATA_DIR;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.resolve(process.cwd(), DATA_DIR);
}

function filePath(name: string): string {
  return path.join(resolveDataDir(), name);
}

// ---------------------------------------------------------------------------
// Diagnostics
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

/** For displaying in UI or reports why nothing was restored. */
export function getPersistenceDiagnostics(): Diagnostics {
  return { ...diagnostics };
}

// ---------------------------------------------------------------------------
// Reading and atomic writing
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
 * Reads an envelope from disk. Returns null on any issue: missing file,
 * unreadable, invalid JSON, old schema, or unexpected payload.
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
    // Truncated JSON from an interrupted write falls here.
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
 * Writes to a temporary file and renames. Renaming is atomic within the same
 * filesystem, so readers see either the whole file or the previous one,
 * never a partial one.
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
      // Not even cleanup can crash the demo.
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sanitization: strip credentials and contact info
// ---------------------------------------------------------------------------

export const REDACTED_EMAIL = "[correo omitido]";
export const REDACTED_PHONE = "[telefono omitido]";

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/g;
const PHONE_PATTERN = /\+?\d[\d\s().-]{7,}\d/g;

function digitsOf(text: string): string {
  return text.replace(/\D/g, "");
}

/**
 * Determines if a number looks like a phone and not a date, identifier, or
 * version number. We avoid over-redacting: losing useful text in logs
 * is also disruptive.
 */
function looksLikePhone(match: string): boolean {
  const digits = digitsOf(match);
  if (digits.length < 9 || digits.length > 15) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(match)) return false; // ISO date
  if (match.trim().startsWith("+")) return true;
  const hasSeparator = /[\s().-]/.test(match);
  if (hasSeparator) return true;
  // Without separators, only redact what matches a Spanish phone number.
  return digits.length === 9 && /^[6789]/.test(digits);
}

/** Strips emails and phone numbers from free text before writing. */
export function redact(text: string): string {
  return text
    .replace(EMAIL_PATTERN, REDACTED_EMAIL)
    .replace(PHONE_PATTERN, (match) => (looksLikePhone(match) ? REDACTED_PHONE : match));
}

function redactOptional<T extends string | null | undefined>(value: T): T {
  return (typeof value === "string" ? redact(value) : value) as T;
}

/**
 * Copy of state suitable for disk: without phone numbers, without emails,
 * and with free text filtered in case someone pasted contact info in descriptions.
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
 * Restores contact channels from `seed.ts`. Contact details live in
 * versioned configuration, not in state file, so restoring cannot
 * resurrect a phone number never saved.
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
// Validation of disk data
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

function hasMapCoordinates(zone: unknown): boolean {
  if (!isRecord(zone) || !isRecord(zone.coordinates)) return false;
  const { lat, lng } = zone.coordinates;
  return (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    typeof lng === "number" &&
    Number.isFinite(lng)
  );
}

/**
 * Verifies that read data is a complete and usable state. store.ts executes
 * `restored.plan.version + 1` right on startup, so we are strict here:
 * on any doubt return null and the application starts with seed state.
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
  // States saved before zones had lat/lng would break the map.
  if (!(value.zones as unknown[]).every((zone) => hasMapCoordinates(zone))) return null;
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
// State
// ---------------------------------------------------------------------------

/** Loads saved state, or null if nothing usable. */
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
    // Extra defense: not even an unexpected failure can prevent startup.
    diagnostics.lastLoadIssue = "unreadable";
    diagnostics.lastLoadDetail = error instanceof Error ? error.message : String(error);
    return null;
  }
}

// --- Deferred write ---------------------------------------------------------
// saveState is called on every replan. Writing the entire state every time
// pounds disk unnecessarily, so we batch: flushed after a quiet period,
// and at most by SAVE_MAX_DELAY_MS. The latest state is never lost
// because the most recent pending state is always saved.

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
    // Environments without usable `process.on`: only the last flush is lost.
  }
}

function clearPendingTimer() {
  if (!pendingTimer) return;
  clearTimeout(pendingTimer);
  pendingTimer = null;
}

/** Flushes any pending state immediately. Returns true if something was written. */
export function flushState(): boolean {
  clearPendingTimer();
  const state = pendingState;
  pendingState = null;
  firstPendingAt = 0;
  if (!state) return false;
  return writeEnvelope(STATE_FILE, sanitizeState(state));
}

/** Discards pending state without writing (useful during test cleanup). */
export function discardPendingState(): void {
  clearPendingTimer();
  pendingState = null;
  firstPendingAt = 0;
}

/** Saves state. Must never throw: disk failure must not crash demo. */
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

    // If accumulating for too long, write without waiting further.
    if (now - firstPendingAt >= SAVE_MAX_DELAY_MS) {
      flushState();
      return;
    }

    clearPendingTimer();
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      flushState();
    }, SAVE_DEBOUNCE_MS);
    // A pending flush must not keep the process alive or hang tests.
    pendingTimer?.unref?.();
  } catch {
    // By contract, saveState never propagates exceptions.
  }
}

// ---------------------------------------------------------------------------
// Runs and learned weights
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

/** History of past runs, for learning bonus. */
export function loadRuns(): RunRecord[] {
  if (!isPersistenceEnabled()) return [];
  try {
    const payload = readEnvelope<unknown>(RUNS_FILE);
    if (!Array.isArray(payload)) return [];
    // A broken entry does not invalidate remaining history: it is discarded alone.
    return payload.filter(isValidRun);
  } catch {
    return [];
  }
}

/** Adds or updates a run. Overwritten by id, so it is idempotent. */
export function saveRun(run: RunRecord): void {
  try {
    if (!isPersistenceEnabled()) return;
    if (!isValidRun(run)) return;
    const existing = loadRuns().filter((candidate) => candidate.id !== run.id);
    const sanitized: RunRecord = { ...run, notes: run.notes.map(redact) };
    const next = [...existing, sanitized].slice(-MAX_RUNS);
    writeEnvelope(RUNS_FILE, next);
  } catch {
    // Losing a run from history cannot crash the demo.
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
    // As above: learning is a bonus, not a single point of failure.
  }
}

/** Clears all persisted data. Only for explicit resets and tests. */
export function clearPersistedData(): void {
  discardPendingState();
  try {
    for (const name of [STATE_FILE, RUNS_FILE, WEIGHTS_FILE]) {
      fs.rmSync(filePath(name), { force: true });
    }
  } catch {
    // Nothing to do if disk does not cooperate.
  }
}
