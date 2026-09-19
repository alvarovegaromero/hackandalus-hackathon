// OWNER: HappyRobot integration, contacts, and escalation agent.
// HappyRobot adapter: the only module that talks to the outside world.
//
// Contract source: the public npm package `@happyrobot-ai/sdk` (details in
// docs/happyDocumentation.md). Every approved action becomes one workflow run:
//
//   POST {baseUrl}/workflows/{workflowId}/runs   body { payload, environment }
//   -> { run_id }
//
// The workflow reports back through its own Webhook node into
// `src/app/api/webhooks/happyrobot/route.ts`. Everything that can differ per
// account (cluster URL, workflow ids, environment) is environment-driven so a
// demo-day adjustment is a `.env.local` change, never a code change.

import { timingSafeEqual } from "node:crypto";
import {
  briefingForRole,
  canReceiveLiveAction,
  contactDestination,
  liveActionBlockReason,
} from "./contacts";
import type {
  Action,
  ActionChannel,
  Contact,
  CrisisZone,
  ExecutionMode,
  Plan,
  Resource,
} from "./types";

// ---------------------------------------------------------------------------
// Results and errors
// ---------------------------------------------------------------------------

/** Which HappyRobot workflow an action maps to. */
export type HappyRobotWorkflowKind = "dispatch" | "public-alert" | "generic";
export type HappyRobotEnvironment = "production" | "staging" | "development";

export interface HappyRobotResult {
  /** HappyRobot `run_id` for live runs; a `mock-*` marker otherwise. */
  externalActionId: string;
  mode: ExecutionMode;
  /** true whenever nothing has left the process. */
  simulated: boolean;
  /** Explanation of what was done and why. Displayed in the UI. */
  detail: string;
  /** Workflow used, null when simulated before selection. */
  workflow: HappyRobotWorkflowKind | null;
}

export type HappyRobotErrorKind =
  | "missing-credentials"
  | "missing-workflow"
  | "not-approved"
  | "timeout"
  | "client-error"
  | "server-error"
  | "network"
  | "unreadable-response";

/** Error with a classified cause so the UI and retry logic know what happened. */
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

/** SDK default cluster. Our hackathon workspace lives in the EU cluster; set it in .env.local. */
export const DEFAULT_BASE_URL = "https://platform.happyrobot.ai/api/v2";
export const DEFAULT_RUNS_PATH = "/workflows/{workflowId}/runs";

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export interface HappyRobotConfig {
  baseUrl: string;
  apiKey: string;
  /** Runs are created in this environment; `development` by default so nothing hits production by accident. */
  environment: HappyRobotEnvironment;
  /** Workflow id or slug per kind; empty when not configured. */
  workflows: Record<HappyRobotWorkflowKind, string>;
  /** Local channel -> workflow kind, e.g. call=dispatch. Unlisted channels use `generic`. */
  channelWorkflows: Partial<Record<ActionChannel, HappyRobotWorkflowKind>>;
  /** Trigger path. Supports {workflowId}. */
  runsPath: string;
  authHeader: string;
  authScheme: string;
  idempotencyHeader: string;
  /** Dot paths where the run id is searched in the response. */
  responseIdPaths: string[];
  timeoutMs: number;
  maxAttempts: number;
  retryBaseMs: number;
}

const WORKFLOW_KINDS: HappyRobotWorkflowKind[] = ["dispatch", "public-alert", "generic"];

function parseChannelWorkflows(
  raw: string | undefined,
): Partial<Record<ActionChannel, HappyRobotWorkflowKind>> {
  const map: Partial<Record<ActionChannel, HappyRobotWorkflowKind>> = {
    call: "dispatch",
    sms: "public-alert",
  };
  if (!raw) return map;
  for (const pair of raw.split(",")) {
    const [channel, kind] = pair.split("=").map((part) => part.trim());
    if (channel && kind && WORKFLOW_KINDS.includes(kind as HappyRobotWorkflowKind)) {
      map[channel as ActionChannel] = kind as HappyRobotWorkflowKind;
    }
  }
  return map;
}

function parseEnvironment(raw: string | undefined): HappyRobotEnvironment {
  if (raw === "production" || raw === "staging") return raw;
  return "development";
}

/** Reads live configuration. Not cached: tests alter the environment. */
export function happyRobotConfig(): HappyRobotConfig {
  return {
    baseUrl: (process.env.HAPPYROBOT_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
    apiKey: process.env.HAPPYROBOT_API_KEY ?? "",
    environment: parseEnvironment(process.env.HAPPYROBOT_ENVIRONMENT),
    workflows: {
      dispatch: process.env.HAPPYROBOT_DISPATCH_WORKFLOW_ID ?? "",
      "public-alert": process.env.HAPPYROBOT_PUBLIC_ALERT_WORKFLOW_ID ?? "",
      generic: process.env.HAPPYROBOT_WORKFLOW_ID ?? "",
    },
    channelWorkflows: parseChannelWorkflows(process.env.HAPPYROBOT_CHANNEL_WORKFLOWS),
    runsPath: process.env.HAPPYROBOT_RUNS_PATH ?? DEFAULT_RUNS_PATH,
    authHeader: process.env.HAPPYROBOT_AUTH_HEADER ?? "authorization",
    authScheme: process.env.HAPPYROBOT_AUTH_SCHEME ?? "Bearer",
    idempotencyHeader: process.env.HAPPYROBOT_IDEMPOTENCY_HEADER ?? "idempotency-key",
    responseIdPaths: (process.env.HAPPYROBOT_RESPONSE_ID_PATH ?? "run_id,id")
      .split(",")
      .map((path) => path.trim())
      .filter(Boolean),
    timeoutMs: envNumber("HAPPYROBOT_TIMEOUT_MS", 8000),
    maxAttempts: Math.max(1, envNumber("HAPPYROBOT_MAX_ATTEMPTS", 3)),
    retryBaseMs: envNumber("HAPPYROBOT_RETRY_BASE_MS", 400),
  };
}

export function getExecutionMode(): ExecutionMode {
  return process.env.ACTION_EXECUTION_MODE === "happyrobot" ? "happyrobot" : "mock";
}

/** Credentials plus at least one workflow to trigger. */
export function isHappyRobotConfigured(config = happyRobotConfig()) {
  return Boolean(
    config.apiKey && config.baseUrl && WORKFLOW_KINDS.some((kind) => config.workflows[kind]),
  );
}

/** Workflow kind for a local action channel. */
export function workflowKindForAction(action: Action, config = happyRobotConfig()) {
  return config.channelWorkflows[action.channel] ?? "generic";
}

/** Workflow id for an action: the channel's kind, falling back to the generic workflow. */
export function workflowIdForAction(action: Action, config = happyRobotConfig()) {
  const kind = workflowKindForAction(action, config);
  const id = config.workflows[kind] || config.workflows.generic;
  return { kind: config.workflows[kind] ? kind : ("generic" as const), id };
}

/** Complete trigger URL for a workflow. */
export function runEndpoint(workflowId: string, config = happyRobotConfig()): string {
  const path = config.runsPath.replace("{workflowId}", encodeURIComponent(workflowId));
  return `${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

// ---------------------------------------------------------------------------
// Webhook secret
// ---------------------------------------------------------------------------

/** Header where HappyRobot workflows send the shared secret. */
export const WEBHOOK_SECRET_HEADER = "x-happyrobot-secret";

export function isWebhookSecretConfigured(): boolean {
  return webhookSecrets().length > 0;
}

// Both names remain valid during migration; use the same value in both workflows.
function webhookSecrets(): string[] {
  return [process.env.HAPPYROBOT_WEBHOOK_SECRET, process.env.FARO_WEBHOOK_SECRET].filter(
    (value): value is string => Boolean(value),
  );
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
 * Strict validation for public endpoints: without a configured secret the
 * request is rejected. An open webhook would let anyone inject false signals
 * into the command center.
 */
export function verifyWebhookSecret(request: Request): { ok: boolean; reason?: string } {
  const expected = webhookSecrets();
  if (!expected.length) {
    return {
      ok: false,
      reason:
        "HappyRobot webhook is not configured: set HAPPYROBOT_WEBHOOK_SECRET in .env.local before exposing this route.",
    };
  }
  const received = request.headers.get(WEBHOOK_SECRET_HEADER);
  if (!received) {
    return { ok: false, reason: `Missing header ${WEBHOOK_SECRET_HEADER}.` };
  }
  if (!expected.map((secret) => safeEqual(received, secret)).some(Boolean)) {
    return { ok: false, reason: "Webhook secret does not match." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Payload construction (trigger params of the FARO workflows)
// ---------------------------------------------------------------------------

/** Live state the payload builders need besides the action and contact. */
export interface DispatchContext {
  resource?: Resource | null;
  zone?: CrisisZone | null;
  plan?: Plan | null;
  incidentId?: string;
}

/** Stable incident identifier sent to HappyRobot; the in-memory demo has one crisis. */
export function incidentId(): string {
  return process.env.CRISIS_INCIDENT_ID ?? "faro-sierra-bermeja-demo";
}

const text = (value: string | number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

/** Params of "FARO — Resource Dispatch" (webhook trigger, 15 fields). */
export function buildDispatchPayload(
  action: Action,
  contact: Contact,
  context: DispatchContext = {},
): Record<string, unknown> {
  const briefing = briefingForRole(contact.role, {
    objective: action.objective,
    zoneName: context.zone?.name ?? action.zoneId,
    reason: action.reason,
    urgent: true,
  });
  return {
    dispatch_id: action.idempotencyKey,
    incident_id: context.incidentId ?? incidentId(),
    plan_id: text(context.plan?.id),
    action_id: action.id,
    resource_id: text(action.resourceId ?? context.resource?.id ?? contact.id),
    resource_display_name: text(context.resource?.name ?? contact.name),
    resource_type: text(context.resource?.type ?? contact.role),
    resource_contact_name: contact.name,
    resource_phone: text(contact.phone),
    mission_summary: action.objective,
    mission_destination: text(context.zone?.name ?? action.zoneId),
    // Unknown by design: FARO does not invent an ETA. The agent skips empty fields.
    mission_requested_eta: "",
    mission_instructions: briefing.askFor,
    context: `${briefing.headline}. ${briefing.detail}`,
    requested_at: new Date().toISOString(),
  };
}

/** Params of "FARO — Public Alert — SMS" (webhook trigger with deterministic approval gate). */
export function buildPublicAlertPayload(
  action: Action,
  contact: Contact,
  context: DispatchContext = {},
): Record<string, unknown> {
  const briefing = briefingForRole(contact.role, {
    objective: action.objective,
    zoneName: context.zone?.name ?? action.zoneId,
    reason: action.reason,
    urgent: true,
  });
  return {
    action_id: action.id,
    incident_id: context.incidentId ?? incidentId(),
    plan_id: text(context.plan?.id),
    // The gate in HappyRobot only sends when FARO says "approved". Anything else stays blocked.
    approval_status: action.approvedBy ? "approved" : "pending",
    approval_approved_by: text(action.approvedBy),
    approval_approved_at: text(action.approvedAt),
    audience_id: action.zoneId,
    audience_label: text(context.zone?.name ?? action.zoneId),
    simulated_population_count: context.zone?.populationAtRisk ?? null,
    // Only explicitly supplied, demo-safe recipients. Nothing is discovered in HappyRobot.
    recipients: [{ recipient_id: contact.id, phone: contact.phone }],
    message: `${briefing.headline}. ${briefing.detail} ${briefing.askFor}`.trim(),
    requested_at: new Date().toISOString(),
  };
}

/** Free-form payload for workflows we have not modelled (email, ticket, slack...). */
export function buildGenericPayload(
  action: Action,
  contact: Contact | null,
  context: DispatchContext = {},
): Record<string, unknown> {
  const briefing = contact
    ? briefingForRole(contact.role, {
        objective: action.objective,
        zoneName: context.zone?.name ?? action.zoneId,
        reason: action.reason,
        urgent: action.channel === "call" || action.channel === "sms",
      })
    : null;
  return {
    channel: action.channel,
    target: action.target,
    destination: contact ? contactDestination(contact, action.channel) : null,
    objective: action.objective,
    briefing,
    action_id: action.id,
    incident_id: context.incidentId ?? incidentId(),
    plan_id: text(context.plan?.id),
    zone_id: action.zoneId,
    zone_name: text(context.zone?.name),
    reason: action.reason,
    attempt: action.attempt,
    contact_id: action.contactId ?? null,
    contact_role: contact?.role ?? null,
    chain_id: action.chainId ?? null,
    idempotency_key: action.idempotencyKey,
    requested_at: new Date().toISOString(),
  };
}

/** Body of `POST /workflows/{id}/runs` for an action. */
export function buildRunBody(
  kind: HappyRobotWorkflowKind,
  action: Action,
  contact: Contact | null,
  context: DispatchContext = {},
  config = happyRobotConfig(),
): { payload: Record<string, unknown>; environment: HappyRobotEnvironment } {
  const payload =
    kind === "dispatch" && contact
      ? buildDispatchPayload(action, contact, context)
      : kind === "public-alert" && contact
        ? buildPublicAlertPayload(action, contact, context)
        : buildGenericPayload(action, contact, context);
  return { payload, environment: config.environment };
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

function mockResult(action: Action, detail: string, workflow: HappyRobotWorkflowKind | null) {
  return {
    // The prefix marks the identifier itself as simulated so neither the UI
    // nor the logs can present it as a live run.
    externalActionId: `mock-simulated-${action.id}`,
    mode: "mock" as const,
    simulated: true,
    detail,
    workflow,
  } satisfies HappyRobotResult;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Looks up the contact and dispatch context in live state through a deferred
 * import: `store.ts` imports this module, so importing it eagerly would be a
 * cycle. At call time the module is initialised. On failure, return nulls and
 * let the safeguards downgrade to simulation.
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

async function resolveContext(action: Action): Promise<DispatchContext> {
  try {
    const { getSituation } = await import("./store");
    const situation = getSituation();
    return {
      resource: situation.resources.find((candidate) => candidate.id === action.resourceId) ?? null,
      zone: situation.zones.find((candidate) => candidate.id === action.zoneId) ?? null,
      plan: situation.plan,
    };
  } catch {
    return {};
  }
}

/**
 * Executes an action. In `mock` mode nothing leaves the process. In
 * `happyrobot` mode a run is only triggered when the contact is approved for
 * the demo; otherwise the action is downgraded to simulation with the reason.
 *
 * @param contact resolved contact. If omitted, looked up in live state.
 * @param context resource/zone/plan for the payload. If omitted, looked up in live state.
 */
export async function executeHappyRobotAction(
  action: Action,
  contact?: Contact | null,
  context?: DispatchContext,
): Promise<HappyRobotResult> {
  const mode = getExecutionMode();

  if (mode === "mock") {
    return mockResult(action, "Simulated mode: nobody outside the system was contacted.", null);
  }

  const config = happyRobotConfig();
  if (!isHappyRobotConfigured(config)) {
    throw new HappyRobotError(
      "missing-credentials",
      "HappyRobot credentials are missing: set HAPPYROBOT_API_KEY, HAPPYROBOT_BASE_URL and at least one workflow id (HAPPYROBOT_DISPATCH_WORKFLOW_ID, HAPPYROBOT_PUBLIC_ALERT_WORKFLOW_ID or HAPPYROBOT_WORKFLOW_ID) in .env.local.",
    );
  }

  const { kind, id: workflowId } = workflowIdForAction(action, config);
  if (!workflowId) {
    throw new HappyRobotError(
      "missing-workflow",
      `No HappyRobot workflow is configured for channel "${action.channel}" (kind ${workflowKindForAction(action, config)}).`,
    );
  }

  // SAFEGUARD: without a demo-approved contact nothing leaves to the outside world.
  const resolved = contact !== undefined ? contact : await resolveContact(action);
  const blockReason = liveActionBlockReason(resolved);
  if (blockReason || !resolved || !canReceiveLiveAction(resolved)) {
    return {
      externalActionId: `mock-not-approved-${action.id}`,
      mode: "mock",
      simulated: true,
      detail: `Downgraded to simulation because ${blockReason ?? "the recipient is not approved for the demo"}. Nothing was sent outside.`,
      workflow: kind,
    };
  }

  const dispatchContext = context ?? (await resolveContext(action));
  const url = runEndpoint(workflowId, config);
  const body = JSON.stringify(buildRunBody(kind, action, resolved, dispatchContext, config));
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    // Canonical idempotency key: owned by the store and renewed on each
    // operator retry, never invented here.
    [config.idempotencyHeader]: action.idempotencyKey,
    [config.authHeader]: config.authScheme
      ? `${config.authScheme} ${config.apiKey}`
      : config.apiKey,
  };

  /** Single attempt with its own abort timer. */
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

      const raw = await response.text();

      if (!response.ok) {
        const excerpt = raw.slice(0, 300);
        if (response.status >= 400 && response.status < 500) {
          // A 4xx is our fault (workflow id, credentials, body): retrying only repeats it.
          throw new HappyRobotError(
            "client-error",
            `HappyRobot rejected the run with ${response.status}: check the workflow id (${workflowId}), the API key/cluster or the payload. Response: ${excerpt || "empty"}`,
            { status: response.status, attempts: attempt },
          );
        }
        throw new HappyRobotError(
          "server-error",
          `HappyRobot answered ${response.status} (service failure). Response: ${excerpt || "empty"}`,
          { status: response.status, attempts: attempt },
        );
      }

      let parsed: unknown;
      try {
        parsed = raw.length > 0 ? JSON.parse(raw) : {};
      } catch {
        // The run may have started: do not accept it as valid, but warn that
        // a retry could duplicate the call or message.
        throw new HappyRobotError(
          "unreadable-response",
          `HappyRobot accepted the request (${response.status}) but returned an unreadable body. Check the run in HappyRobot before retrying. Response: ${raw.slice(0, 200)}`,
          { status: response.status, attempts: attempt },
        );
      }

      const runId =
        config.responseIdPaths.map((path) => readPath(parsed, path)).find(Boolean) ??
        `happyrobot-${action.idempotencyKey}`;

      return {
        externalActionId: runId,
        mode: "happyrobot",
        simulated: false,
        detail: `Run started in HappyRobot (${kind} workflow, ${config.environment}) for ${resolved.name}, attempt ${attempt} of ${config.maxAttempts}.`,
        workflow: kind,
      };
    } finally {
      clearTimeout(timer);
    }
  };

  let lastError: HappyRobotError | null = null;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    try {
      return await dispatchOnce(attempt);
    } catch (error) {
      const classified = classifyError(error, attempt, config);
      lastError = classified;
      // Only retry what could succeed on repetition: network failure,
      // timeout and 5xx. A 4xx is never retried.
      const retryable =
        classified.kind === "server-error" ||
        classified.kind === "network" ||
        classified.kind === "timeout";
      if (!retryable || attempt === config.maxAttempts) throw classified;
      // Exponential backoff. The idempotency key does not change between
      // internal retries, so HappyRobot can deduplicate them.
      await sleep(config.retryBaseMs * 2 ** (attempt - 1));
    }
  }

  throw (
    lastError ??
    new HappyRobotError(
      "network",
      "HappyRobot did not answer and the failure could not be classified.",
    )
  );
}

function classifyError(error: unknown, attempt: number, config: HappyRobotConfig): HappyRobotError {
  if (error instanceof HappyRobotError) return error;
  if (error instanceof Error) {
    if (error.name === "AbortError" || /abort/i.test(error.message)) {
      return new HappyRobotError(
        "timeout",
        `HappyRobot timed out after ${config.timeoutMs} ms on attempt ${attempt}. The run may not have started; the command center does not stay blocked waiting.`,
        { attempts: attempt },
      );
    }
    return new HappyRobotError(
      "network",
      `Could not reach HappyRobot on attempt ${attempt}: ${error.message}. Check HAPPYROBOT_BASE_URL and connectivity.`,
      { attempts: attempt },
    );
  }
  return new HappyRobotError("network", `Unknown failure calling HappyRobot: ${String(error)}`, {
    attempts: attempt,
  });
}
