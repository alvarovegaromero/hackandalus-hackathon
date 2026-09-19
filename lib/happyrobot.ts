// OWNER: HappyRobot integration, contacts, and escalation agent.
// HappyRobot adapter: the only piece that speaks to the outside world.
//
// Honesty first. `docs/happyDocumentation.md` notes that private documentation
// (docs.happyrobot.ai) is restricted, so endpoint paths and payload shapes
// are NOT verified against the real contract. Therefore, everything that might
// change once access is granted is configurable via environment variables,
// with current values as defaults: on demo day, adjusting `.env.local` suffices,
// never this file.

import { timingSafeEqual } from "node:crypto";
import {
  briefingForRole,
  canReceiveLiveAction,
  contactDestination,
  liveActionBlockReason,
} from "./contacts";
import type { Action, ActionChannel, Contact, ExecutionMode } from "./types";

// ---------------------------------------------------------------------------
// Results and errors
// ---------------------------------------------------------------------------

export interface HappyRobotResult {
  externalActionId: string;
  mode: ExecutionMode;
  /** true whenever nothing has left the process to the outside world. */
  simulated: boolean;
  /** Explanation of what was done and why. Displayed in UI. */
  detail: string;
}

export type HappyRobotErrorKind =
  | "missing-credentials"
  | "not-approved"
  | "timeout"
  | "client-error"
  | "server-error"
  | "network"
  | "unreadable-response";

/** Error with classified cause, for UI and retry logic to understand what happened. */
export class HappyRobotError extends Error {
  readonly kind: HappyRobotErrorKind;
  readonly status?: number;
  readonly attempts: number;

  constructor(
    kind: HappyRobotErrorKind,
    message: string,
    options: { status?: number; attempts?: number } = {},
  ) {
    super(message);
    this.name = "HappyRobotError";
    this.kind = kind;
    this.status = options.status;
    this.attempts = options.attempts ?? 1;
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export interface HappyRobotConfig {
  baseUrl: string;
  apiKey: string;
  agentId: string;
  workflowId: string;
  /** Action endpoint path. Supports {agentId} and {workflowId}. */
  actionPath: string;
  authHeader: string;
  authScheme: string;
  idempotencyHeader: string;
  /** Payload shape: `flat` (default), `wrapped`, or `trigger`. */
  payloadShape: "flat" | "wrapped" | "trigger";
  /** Comma-separated paths where external ID is searched in response. */
  responseIdPaths: string[];
  timeoutMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  /** Translation of local channel to HappyRobot channel, e.g. "call=voice". */
  channelMap: Partial<Record<ActionChannel, string>>;
}

function parseChannelMap(raw: string | undefined): Partial<Record<ActionChannel, string>> {
  // Default: our "call" is "voice" in HappyRobot public nomenclature.
  const map: Partial<Record<ActionChannel, string>> = { call: "voice" };
  if (!raw) return map;
  for (const pair of raw.split(",")) {
    const [local, remote] = pair.split("=").map((part) => part.trim());
    if (local && remote) map[local as ActionChannel] = remote;
  }
  return map;
}

function parseShape(raw: string | undefined): HappyRobotConfig["payloadShape"] {
  if (raw === "wrapped" || raw === "trigger") return raw;
  return "flat";
}

/** Reads live configuration. Not cached: tests alter environment. */
export function happyRobotConfig(): HappyRobotConfig {
  return {
    baseUrl: (process.env.HAPPYROBOT_BASE_URL ?? "https://api.happyrobot.ai").replace(/\/$/, ""),
    apiKey: process.env.HAPPYROBOT_API_KEY ?? "",
    agentId: process.env.HAPPYROBOT_AGENT_ID ?? "",
    workflowId: process.env.HAPPYROBOT_WORKFLOW_ID ?? "",
    actionPath: process.env.HAPPYROBOT_ACTION_PATH ?? "/agents/{agentId}/actions",
    authHeader: process.env.HAPPYROBOT_AUTH_HEADER ?? "authorization",
    authScheme: process.env.HAPPYROBOT_AUTH_SCHEME ?? "Bearer",
    idempotencyHeader: process.env.HAPPYROBOT_IDEMPOTENCY_HEADER ?? "idempotency-key",
    payloadShape: parseShape(process.env.HAPPYROBOT_PAYLOAD_SHAPE),
    responseIdPaths: (process.env.HAPPYROBOT_RESPONSE_ID_PATH ?? "id,actionId,action_id,data.id")
      .split(",")
      .map((path) => path.trim())
      .filter(Boolean),
    timeoutMs: envNumber("HAPPYROBOT_TIMEOUT_MS", 8000),
    maxAttempts: Math.max(1, envNumber("HAPPYROBOT_MAX_ATTEMPTS", 3)),
    retryBaseMs: envNumber("HAPPYROBOT_RETRY_BASE_MS", 400),
    channelMap: parseChannelMap(process.env.HAPPYROBOT_CHANNEL_MAP),
  };
}

export function getExecutionMode(): ExecutionMode {
  return process.env.ACTION_EXECUTION_MODE === "happyrobot" ? "happyrobot" : "mock";
}

export function isHappyRobotConfigured() {
  return Boolean(
    process.env.HAPPYROBOT_API_KEY &&
    process.env.HAPPYROBOT_BASE_URL &&
    process.env.HAPPYROBOT_AGENT_ID,
  );
}

/** Complete URL of action endpoint, with templates resolved. */
export function actionEndpoint(config = happyRobotConfig()): string {
  const path = config.actionPath
    .replace("{agentId}", encodeURIComponent(config.agentId))
    .replace("{workflowId}", encodeURIComponent(config.workflowId));
  return `${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

// ---------------------------------------------------------------------------
// Webhook secret
// ---------------------------------------------------------------------------

/** Header where HappyRobot sends shared secret. */
export const WEBHOOK_SECRET_HEADER = "x-happyrobot-secret";

export function isWebhookSecretConfigured(): boolean {
  return Boolean(process.env.HAPPYROBOT_WEBHOOK_SECRET);
}

/** Constant-time comparison to avoid timing leaks. */
function safeEqual(received: string, expected: string): boolean {
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Compare against self anyway so cost does not depend on length matching.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Strict validation for public endpoints: if no secret is configured,
 * the request is rejected. A webhook open to the internet without a secret
 * is an open door to inject false signals into the command center.
 */
export function verifyWebhookSecret(request: Request): { ok: boolean; reason?: string } {
  const expected = process.env.HAPPYROBOT_WEBHOOK_SECRET;
  if (!expected) {
    return {
      ok: false,
      reason:
        "El webhook de HappyRobot no está configurado: define HAPPYROBOT_WEBHOOK_SECRET en .env.local antes de exponer esta ruta.",
    };
  }
  const received = request.headers.get(WEBHOOK_SECRET_HEADER);
  if (!received) {
    return { ok: false, reason: `Falta la cabecera ${WEBHOOK_SECRET_HEADER}.` };
  }
  if (!safeEqual(received, expected)) {
    return { ok: false, reason: "El secreto del webhook no coincide." };
  }
  return { ok: true };
}

/**
 * Permissive legacy variant: returns true when no secret is configured.
 * Preserved for backward compatibility, but must NOT be used on new
 * public routes. Use `verifyWebhookSecret` instead.
 *
 * @deprecated Use `verifyWebhookSecret`.
 */
export function validateWebhookSecret(request: Request) {
  const expected = process.env.HAPPYROBOT_WEBHOOK_SECRET;
  if (!expected) return true;
  const received = request.headers.get(WEBHOOK_SECRET_HEADER);
  if (!received) return false;
  return safeEqual(received, expected);
}

// ---------------------------------------------------------------------------
// Payload construction
// ---------------------------------------------------------------------------

export interface ActionPayloadCore {
  channel: string;
  target: string;
  destination: string | null;
  objective: string;
  briefing: { headline: string; detail: string; askFor: string } | null;
  metadata: Record<string, unknown>;
}

/**
 * Request body according to configured shape. The `flat` shape is documented
 * as the internal contract in `docs/happyDocumentation.md`; the other two exist
 * to adapt without code changes once the real contract is confirmed.
 */
export function buildActionPayload(
  action: Action,
  contact: Contact | null,
  config = happyRobotConfig(),
): Record<string, unknown> {
  const channel = config.channelMap[action.channel] ?? action.channel;
  const briefing = contact
    ? briefingForRole(contact.role, {
        objective: action.objective,
        zoneName: action.zoneId,
        reason: action.reason,
        urgent: action.channel === "call" || action.channel === "sms",
      })
    : null;

  const core: ActionPayloadCore = {
    channel,
    target: action.target,
    destination: contact ? contactDestination(contact, action.channel) : null,
    objective: action.objective,
    briefing,
    metadata: {
      localActionId: action.id,
      zoneId: action.zoneId,
      reason: action.reason,
      attempt: action.attempt,
      contactId: action.contactId ?? null,
      contactRole: contact?.role ?? null,
      chainId: action.chainId ?? null,
      idempotencyKey: action.idempotencyKey,
      ...(config.workflowId ? { workflowId: config.workflowId } : {}),
    },
  };

  if (config.payloadShape === "wrapped") return { action: core };
  if (config.payloadShape === "trigger") {
    return { input: core, idempotencyKey: action.idempotencyKey };
  }
  return { ...core };
}

function readPath(body: unknown, path: string): string | null {
  let cursor: unknown = body;
  for (const segment of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null) return null;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === "string" && cursor.length > 0 ? cursor : null;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function mockResult(action: Action, detail: string): HappyRobotResult {
  return {
    // Prefix writes simulated character into identifier itself, so neither
    // UI nor logs can present it as real execution.
    externalActionId: `mock-simulado-${action.id}`,
    mode: "mock",
    simulated: true,
    detail,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Looks up the action contact in live state. Done via deferred import
 * because `store.ts` already imports this module: at call time the
 * module is already initialized, so the cycle is not an issue. If lookup
 * fails, returns null and safeguard downgrades to simulation.
 */
async function resolveContact(action: Action): Promise<Contact | null> {
  if (!action.contactId) return null;
  try {
    const { getSituation } = await import("./store");
    return getSituation().contacts.find((candidate) => candidate.id === action.contactId) ?? null;
  } catch {
    return null;
  }
}

/**
 * Executes an action. In `mock` mode nothing leaves the process. In `happyrobot`
 * mode it only makes real calls if contact is approved for demo;
 * in any other case it downgrades to simulation and explains why.
 *
 * @param contact resolved contact. If omitted, looked up in state.
 */
export async function executeHappyRobotAction(
  action: Action,
  contact?: Contact | null,
): Promise<HappyRobotResult> {
  const mode = getExecutionMode();

  if (mode === "mock") {
    return mockResult(action, "Modo simulado: no se ha contactado con nadie fuera del sistema.");
  }

  if (!isHappyRobotConfigured()) {
    throw new HappyRobotError(
      "missing-credentials",
      // English suffix preserved for compatibility with tests in another module;
      // primary text for operator is Spanish.
      "Faltan credenciales de HappyRobot: define HAPPYROBOT_API_KEY, HAPPYROBOT_BASE_URL y HAPPYROBOT_AGENT_ID en .env.local (HappyRobot credentials are missing).",
    );
  }

  // SAFEGUARD: without demo-approved contact nothing leaves to the outside world.
  const resolved = contact !== undefined ? contact : await resolveContact(action);
  const bloqueo = liveActionBlockReason(resolved);
  if (bloqueo || !resolved || !canReceiveLiveAction(resolved)) {
    return {
      externalActionId: `mock-no-aprobado-${action.id}`,
      mode: "mock",
      simulated: true,
      detail: `Degradado a simulación porque ${bloqueo ?? "el destinatario no está aprobado para la demo"}. No se ha enviado nada al exterior.`,
    };
  }

  const config = happyRobotConfig();
  const url = actionEndpoint(config);
  const body = JSON.stringify(buildActionPayload(action, resolved, config));
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    // Canonical idempotency key: managed by store and changing on each
    // operator retry, not invented here.
    [config.idempotencyHeader]: action.idempotencyKey,
    [config.authHeader]: config.authScheme
      ? `${config.authScheme} ${config.apiKey}`
      : config.apiKey,
  };

  /** Single attempt, with its own abort timer. */
  const dispatchOnce = async (attempt: number): Promise<HappyRobotResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      const text = await response.text();

      if (!response.ok) {
        const recorte = text.slice(0, 300);
        if (response.status >= 400 && response.status < 500) {
          // A 4xx is our fault (route, credentials, body, or permissions):
          // retrying only repeats the same error.
          throw new HappyRobotError(
            "client-error",
            `HappyRobot rechazó la acción con ${response.status}: revisa la ruta (${config.actionPath}), la clave o el formato del cuerpo. Respuesta: ${recorte || "sin cuerpo"}`,
            { status: response.status, attempts: attempt },
          );
        }
        throw new HappyRobotError(
          "server-error",
          `HappyRobot respondió ${response.status} (fallo del servicio). Respuesta: ${recorte || "sin cuerpo"}`,
          { status: response.status, attempts: attempt },
        );
      }

      let parsed: unknown;
      try {
        parsed = text.length > 0 ? JSON.parse(text) : {};
      } catch {
        // The action may have executed: we do not accept it as valid, but
        // warn that a retry could duplicate notification.
        throw new HappyRobotError(
          "unreadable-response",
          `HappyRobot aceptó la petición (${response.status}) pero devolvió una respuesta ilegible. Comprueba en HappyRobot si la acción salió antes de reintentar. Respuesta: ${text.slice(0, 200)}`,
          { status: response.status, attempts: attempt },
        );
      }

      const externalId =
        config.responseIdPaths.map((path) => readPath(parsed, path)).find(Boolean) ??
        `happyrobot-${action.idempotencyKey}`;

      return {
        externalActionId: externalId,
        mode: "happyrobot",
        simulated: false,
        detail: `Acción enviada a HappyRobot (${config.channelMap[action.channel] ?? action.channel}) para ${resolved.name}, intento ${attempt} de ${config.maxAttempts}.`,
      };
    } finally {
      clearTimeout(timer);
    }
  };

  let ultimoError: HappyRobotError | null = null;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    try {
      return await dispatchOnce(attempt);
    } catch (error) {
      const clasificado = classifyError(error, attempt, config);
      ultimoError = clasificado;
      // Only retry what could succeed on repetition: network failure,
      // timeout, and 5xx. A 4xx is never retried.
      const reintentable =
        clasificado.kind === "server-error" ||
        clasificado.kind === "network" ||
        clasificado.kind === "timeout";
      if (!reintentable || attempt === config.maxAttempts) throw clasificado;
      // Exponential backoff. Idempotency key does not change between
      // internal retries, so HappyRobot can deduplicate them.
      await sleep(config.retryBaseMs * 2 ** (attempt - 1));
    }
  }

  throw (
    ultimoError ??
    new HappyRobotError("network", "HappyRobot no respondió y no se pudo clasificar el fallo.")
  );
}

function classifyError(error: unknown, attempt: number, config: HappyRobotConfig): HappyRobotError {
  if (error instanceof HappyRobotError) return error;
  if (error instanceof Error) {
    if (error.name === "AbortError" || /abort/i.test(error.message)) {
      return new HappyRobotError(
        "timeout",
        `HappyRobot agotó el tiempo de espera de ${config.timeoutMs} ms en el intento ${attempt}. La acción puede no haber salido; el centro de mando no se queda bloqueado esperando.`,
        { attempts: attempt },
      );
    }
    return new HappyRobotError(
      "network",
      `No se pudo contactar con HappyRobot en el intento ${attempt}: ${error.message}. Comprueba HAPPYROBOT_BASE_URL y la conectividad.`,
      { attempts: attempt },
    );
  }
  return new HappyRobotError(
    "network",
    `Fallo desconocido al llamar a HappyRobot: ${String(error)}`,
    {
      attempts: attempt,
    },
  );
}
