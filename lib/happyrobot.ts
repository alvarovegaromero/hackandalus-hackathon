// PROPIETARIO: agente de integración HappyRobot, contactos y escalado.
// Adaptador hacia HappyRobot: es la única pieza que habla con el exterior.
//
// Honestidad primero. `docs/happyDocumentation.md` deja constancia de que la
// documentación privada (docs.happyrobot.ai) está restringida, así que la ruta
// y la forma del cuerpo NO están verificadas contra el contrato real. Por eso
// todo lo que puede cambiar cuando se tenga acceso a esa documentación es
// configurable por variable de entorno, con el valor actual como defecto: el
// día de la demo basta con tocar `.env.local`, nunca este fichero.

import { timingSafeEqual } from "node:crypto";
import { briefingForRole, canReceiveLiveAction, contactDestination, liveActionBlockReason } from "./contacts";
import type { Action, ActionChannel, Contact, ExecutionMode } from "./types";

// ---------------------------------------------------------------------------
// Resultado y errores
// ---------------------------------------------------------------------------

export interface HappyRobotResult {
  externalActionId: string;
  mode: ExecutionMode;
  /** true siempre que no haya salido nada del proceso hacia el exterior. */
  simulated: boolean;
  /** Explicación en castellano de qué se hizo y por qué. Acaba en la UI. */
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

/** Error con causa clasificada, para que la UI y los reintentos sepan que paso. */
export class HappyRobotError extends Error {
  readonly kind: HappyRobotErrorKind;
  readonly status?: number;
  readonly attempts: number;

  constructor(
    kind: HappyRobotErrorKind,
    message: string,
    options: { status?: number; attempts?: number } = {}
  ) {
    super(message);
    this.name = "HappyRobotError";
    this.kind = kind;
    this.status = options.status;
    this.attempts = options.attempts ?? 1;
  }
}

// ---------------------------------------------------------------------------
// Configuración
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
  /** Ruta del endpoint de acción. Admite {agentId} y {workflowId}. */
  actionPath: string;
  authHeader: string;
  authScheme: string;
  idempotencyHeader: string;
  /** Forma del cuerpo: `flat` (por defecto), `wrapped` o `trigger`. */
  payloadShape: "flat" | "wrapped" | "trigger";
  /** Rutas separadas por comas donde buscar el id externo en la respuesta. */
  responseIdPaths: string[];
  timeoutMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  /** Traduccion de canal local a canal HappyRobot, p. ej. "call=voice". */
  channelMap: Partial<Record<ActionChannel, string>>;
}

function parseChannelMap(raw: string | undefined): Partial<Record<ActionChannel, string>> {
  // Defecto: nuestra "call" es "voice" en la nomenclatura pública de HappyRobot.
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

/** Lee la configuración viva. No se cachea: los tests cambian el entorno. */
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
    channelMap: parseChannelMap(process.env.HAPPYROBOT_CHANNEL_MAP)
  };
}

export function getExecutionMode(): ExecutionMode {
  return process.env.ACTION_EXECUTION_MODE === "happyrobot" ? "happyrobot" : "mock";
}

export function isHappyRobotConfigured() {
  return Boolean(
    process.env.HAPPYROBOT_API_KEY && process.env.HAPPYROBOT_BASE_URL && process.env.HAPPYROBOT_AGENT_ID
  );
}

/** URL completa del endpoint de acción, con las plantillas ya resueltas. */
export function actionEndpoint(config = happyRobotConfig()): string {
  const path = config.actionPath
    .replace("{agentId}", encodeURIComponent(config.agentId))
    .replace("{workflowId}", encodeURIComponent(config.workflowId));
  return `${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

// ---------------------------------------------------------------------------
// Secreto del webhook
// ---------------------------------------------------------------------------

/** Cabecera donde HappyRobot envia el secreto compartido. */
export const WEBHOOK_SECRET_HEADER = "x-happyrobot-secret";

export function isWebhookSecretConfigured(): boolean {
  return Boolean(process.env.HAPPYROBOT_WEBHOOK_SECRET);
}

/** Comparacion en tiempo constante, para no filtrar el secreto por tiempos. */
function safeEqual(received: string, expected: string): boolean {
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Se compara igualmente contra si mismo para que el coste no dependa de
    // si las longitudes coinciden.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Validacion estricta para endpoints públicos: si no hay secreto configurado,
 * la petición se rechaza. Un webhook abierto a internet sin secreto es una
 * puerta abierta para inyectar señales falsas en el centro de mando.
 */
export function verifyWebhookSecret(request: Request): { ok: boolean; reason?: string } {
  const expected = process.env.HAPPYROBOT_WEBHOOK_SECRET;
  if (!expected) {
    return {
      ok: false,
      reason:
        "El webhook de HappyRobot no está configurado: define HAPPYROBOT_WEBHOOK_SECRET en .env.local antes de exponer esta ruta."
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
 * Variante permisiva heredada: devuelve true cuando no hay secreto configurado.
 * Se mantiene para no romper a quien ya la usa, pero NO debe usarse en rutas
 * públicas nuevas. Para eso está `verifyWebhookSecret`.
 *
 * @deprecated Usa `verifyWebhookSecret`.
 */
export function validateWebhookSecret(request: Request) {
  const expected = process.env.HAPPYROBOT_WEBHOOK_SECRET;
  if (!expected) return true;
  const received = request.headers.get(WEBHOOK_SECRET_HEADER);
  if (!received) return false;
  return safeEqual(received, expected);
}

// ---------------------------------------------------------------------------
// Construccion del cuerpo
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
 * Cuerpo de la petición según la forma configurada. La forma `flat` es la que
 * documentamos como contrato interno en `docs/happyDocumentation.md`; las otras dos
 * existen para poder adaptarse sin tocar código cuando se confirme la real.
 */
export function buildActionPayload(
  action: Action,
  contact: Contact | null,
  config = happyRobotConfig()
): Record<string, unknown> {
  const channel = config.channelMap[action.channel] ?? action.channel;
  const briefing = contact
    ? briefingForRole(contact.role, {
        objective: action.objective,
        zoneName: action.zoneId,
        reason: action.reason,
        urgent: action.channel === "call" || action.channel === "sms"
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
      ...(config.workflowId ? { workflowId: config.workflowId } : {})
    }
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
// Ejecución
// ---------------------------------------------------------------------------

function mockResult(action: Action, detail: string): HappyRobotResult {
  return {
    // El prefijo deja el caracter simulado escrito en el propio identificador,
    // para que ni la UI ni un log puedan presentarlo como ejecución real.
    externalActionId: `mock-simulado-${action.id}`,
    mode: "mock",
    simulated: true,
    detail
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Busca el contacto de la acción en el estado vivo. Se hace con import
 * diferido porque `store.ts` ya importa este módulo: en tiempo de llamada el
 * módulo ya está inicializado, así que el ciclo no es un problema. Si algo
 * falla se devuelve null y la salvaguarda degrada a simulación.
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
 * Ejecuta una acción. En modo `mock` no sale nada del proceso. En modo
 * `happyrobot` solo se llama de verdad si el contacto está aprobado para la
 * demo; en cualquier otro caso se degrada a simulación y se explica por qué.
 *
 * @param contact contacto ya resuelto. Si no se pasa, se busca en el estado.
 */
export async function executeHappyRobotAction(
  action: Action,
  contact?: Contact | null
): Promise<HappyRobotResult> {
  const mode = getExecutionMode();

  if (mode === "mock") {
    return mockResult(action, "Modo simulado: no se ha contactado con nadie fuera del sistema.");
  }

  if (!isHappyRobotConfigured()) {
    throw new HappyRobotError(
      "missing-credentials",
      // El sufijo en inglés se mantiene por compatibilidad con tests de otro
      // módulo; el texto útil para el operador es el castellano.
      "Faltan credenciales de HappyRobot: define HAPPYROBOT_API_KEY, HAPPYROBOT_BASE_URL y HAPPYROBOT_AGENT_ID en .env.local (HappyRobot credentials are missing)."
    );
  }

  // SALVAGUARDA: sin contacto aprobado para demo no sale nada al exterior.
  const resolved = contact !== undefined ? contact : await resolveContact(action);
  const bloqueo = liveActionBlockReason(resolved);
  if (bloqueo || !resolved || !canReceiveLiveAction(resolved)) {
    return {
      externalActionId: `mock-no-aprobado-${action.id}`,
      mode: "mock",
      simulated: true,
      detail: `Degradado a simulación porque ${bloqueo ?? "el destinatario no está aprobado para la demo"}. No se ha enviado nada al exterior.`
    };
  }

  const config = happyRobotConfig();
  const url = actionEndpoint(config);
  const body = JSON.stringify(buildActionPayload(action, resolved, config));
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    // Clave de idempotencia canónica: la que gestiona el store y que cambia
    // en cada reintento del operador, no una inventada aquí.
    [config.idempotencyHeader]: action.idempotencyKey,
    [config.authHeader]: config.authScheme ? `${config.authScheme} ${config.apiKey}` : config.apiKey
  };

  /** Un único intento, con su propio temporizador de cancelacion. */
  const dispatchOnce = async (attempt: number): Promise<HappyRobotResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal
      });

      const text = await response.text();

      if (!response.ok) {
        const recorte = text.slice(0, 300);
        if (response.status >= 400 && response.status < 500) {
          // Un 4xx es culpa nuestra (ruta, credenciales, cuerpo o permisos):
          // reintentarlo solo repite el mismo error.
          throw new HappyRobotError(
            "client-error",
            `HappyRobot rechazó la acción con ${response.status}: revisa la ruta (${config.actionPath}), la clave o el formato del cuerpo. Respuesta: ${recorte || "sin cuerpo"}`,
            { status: response.status, attempts: attempt }
          );
        }
        throw new HappyRobotError(
          "server-error",
          `HappyRobot respondió ${response.status} (fallo del servicio). Respuesta: ${recorte || "sin cuerpo"}`,
          { status: response.status, attempts: attempt }
        );
      }

      let parsed: unknown;
      try {
        parsed = text.length > 0 ? JSON.parse(text) : {};
      } catch {
        // La acción puede haberse ejecutado: no la damos por buena, pero
        // avisamos de que un reintento podría duplicar el aviso.
        throw new HappyRobotError(
          "unreadable-response",
          `HappyRobot aceptó la petición (${response.status}) pero devolvió una respuesta ilegible. Comprueba en HappyRobot si la acción salió antes de reintentar. Respuesta: ${text.slice(0, 200)}`,
          { status: response.status, attempts: attempt }
        );
      }

      const externalId =
        config.responseIdPaths.map((path) => readPath(parsed, path)).find(Boolean) ??
        `happyrobot-${action.idempotencyKey}`;

      return {
        externalActionId: externalId,
        mode: "happyrobot",
        simulated: false,
        detail: `Acción enviada a HappyRobot (${config.channelMap[action.channel] ?? action.channel}) para ${resolved.name}, intento ${attempt} de ${config.maxAttempts}.`
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
      // Solo se reintenta lo que puede salir bien al repetirlo: fallo de red,
      // tiempo de espera agotado y 5xx. Un 4xx nunca se reintenta.
      const reintentable =
        clasificado.kind === "server-error" ||
        clasificado.kind === "network" ||
        clasificado.kind === "timeout";
      if (!reintentable || attempt === config.maxAttempts) throw clasificado;
      // Backoff exponencial. La clave de idempotencia no cambia entre
      // reintentos internos, así que HappyRobot puede deduplicarlos.
      await sleep(config.retryBaseMs * 2 ** (attempt - 1));
    }
  }

  throw (
    ultimoError ?? new HappyRobotError("network", "HappyRobot no respondió y no se pudo clasificar el fallo.")
  );
}

function classifyError(error: unknown, attempt: number, config: HappyRobotConfig): HappyRobotError {
  if (error instanceof HappyRobotError) return error;
  if (error instanceof Error) {
    if (error.name === "AbortError" || /abort/i.test(error.message)) {
      return new HappyRobotError(
        "timeout",
        `HappyRobot agotó el tiempo de espera de ${config.timeoutMs} ms en el intento ${attempt}. La acción puede no haber salido; el centro de mando no se queda bloqueado esperando.`,
        { attempts: attempt }
      );
    }
    return new HappyRobotError(
      "network",
      `No se pudo contactar con HappyRobot en el intento ${attempt}: ${error.message}. Comprueba HAPPYROBOT_BASE_URL y la conectividad.`,
      { attempts: attempt }
    );
  }
  return new HappyRobotError("network", `Fallo desconocido al llamar a HappyRobot: ${String(error)}`, {
    attempts: attempt
  });
}
