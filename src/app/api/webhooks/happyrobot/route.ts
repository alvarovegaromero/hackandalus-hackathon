// OWNER: HappyRobot integration, contacts, and escalation agent.
// HappyRobot callback entry point. SEPARATE route by design: only external
// calls enter here, with a mandatory shared secret. UI operations (cancel,
// retry) live in /api/actions/[id]/status and cannot share this gateway.
//
// This is the highest-scoring loop of the challenge: HappyRobot calls someone,
// what that person reports enters as a new signal, and the plan rebuilds.
//
// Accepted bodies (all produced by the Webhook node at the end of a workflow):
//   - "FARO — Resource Dispatch": `dispatch_result` (or `dispatch_result_json`).
//   - "FARO — Public Alert — SMS": `public_alert_result` (or `public_alert_result_json`).
//   - Generic: { localActionId | externalActionId, status, summary, error, newInformation[] }.

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  WEBHOOK_SECRET_HEADER,
  isWebhookSecretConfigured,
  verifyWebhookSecret,
} from "@/lib/happyrobot";
import { addEvent, getSituation, setActionStatus, updateResource } from "@/lib/store";
import type {
  Action,
  ActionStatus,
  Confidence,
  IncomingEventPayload,
  Resource,
  Severity,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Headers and error shape aligned with `lib/validation.ts` (`error` + `code`),
 * without importing it: that layer validates UI bodies while here the raw
 * body text is needed to compute the idempotency hash.
 */
const NO_CACHE = {
  "cache-control": "no-store, no-cache, must-revalidate",
  pragma: "no-cache",
} as const;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_CACHE });
}

function fail(code: string, error: string, status: number, extra: Record<string, unknown> = {}) {
  return json({ error, code, ...extra }, status);
}

/** This route only handles callbacks: any other method is rejected. */
const notAllowed = () =>
  NextResponse.json(
    {
      error: "Method not allowed. Valid methods on this route: POST.",
      code: "metodo_no_permitido",
    },
    { status: 405, headers: { ...NO_CACHE, allow: "POST" } },
  );

export const GET = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;

// ---------------------------------------------------------------------------
// Callback shapes (see docs/happyDocumentation.md)
// ---------------------------------------------------------------------------

interface NewInformationItem {
  type?: string;
  zoneId?: string;
  description?: string;
  severity?: Severity;
  confidence?: Confidence;
  confirmed?: boolean | null;
}

interface GenericCallback {
  externalActionId?: string;
  localActionId?: string;
  status?: string;
  summary?: string;
  error?: string;
  /** Delivery identifier, if sent by HappyRobot. */
  deliveryId?: string;
  eventId?: string;
  newInformation?: NewInformationItem[];
}

interface DispatchClaim {
  statement?: string | null;
  uncertainty?: string | null;
}

/** Output of the "Normalize Outcome" node of FARO — Resource Dispatch. */
interface DispatchResult {
  dispatch_id?: string | null;
  incident_id?: string | null;
  plan_id?: string | null;
  action_id?: string | null;
  resource_id?: string | null;
  dispatch_status?: string | null;
  eta_minutes?: number | null;
  constraint_description?: string | null;
  rejection_reason?: string | null;
  responder_statement?: string | null;
  claims?: DispatchClaim[] | null;
  native_interaction_id?: string | null;
  transcript_reference?: string | null;
  completed_at?: string | null;
}

/** Output of the "Build Public Alert Result" node of FARO — Public Alert — SMS. */
interface PublicAlertResult {
  action_id?: string | null;
  alert_status?: string | null;
  audience_label?: string | null;
  simulated_population_count?: number | null;
  recipient_count?: number | null;
  sent_count?: number | null;
  delivered_count?: number | null;
  failed_count?: number | null;
  results?: unknown[] | null;
  completed_at?: string | null;
}

type CallbackKind = "dispatch" | "public-alert" | "generic";

/** What the callback asks the command center to do, independent of its wire shape. */
interface CallbackIntent {
  kind: CallbackKind;
  actionRef: string | null;
  status: ActionStatus | null;
  externalActionId?: string;
  error?: string;
  summary: string | null;
  information: IncomingEventPayload[];
  resourceUpdate: { resourceId: string; status: Resource["status"] } | null;
  notes: string[];
}

/** Generic external states -> local states. */
const genericStatusMap: Record<string, ActionStatus> = {
  completed: "succeeded",
  complete: "succeeded",
  success: "succeeded",
  succeeded: "succeeded",
  in_progress: "running",
  running: "running",
  needs_human: "blocked",
  blocked: "blocked",
  failed: "failed",
  error: "failed",
  cancelled: "cancelled",
  canceled: "cancelled",
};

/** Dispatch outcomes -> local states. Anything that needs a human decision is `blocked`. */
const dispatchStatusMap: Record<string, ActionStatus> = {
  accepted: "succeeded",
  accepted_with_constraint: "succeeded",
  rejected: "blocked",
  unavailable: "blocked",
  unclear: "blocked",
  no_answer: "failed",
  failed: "failed",
};

/** Alert outcomes -> local states. `partial` needs an operator decision on the failed recipients. */
const alertStatusMap: Record<string, ActionStatus> = {
  completed: "succeeded",
  partial: "blocked",
  failed: "failed",
  not_approved: "blocked",
};

const severities: Severity[] = ["low", "medium", "high", "critical"];
const confidences: Confidence[] = ["low", "medium", "high"];

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" || ["none", "null", "undefined"].includes(text.toLowerCase()) ? null : text;
}

/** Reads `key` as an object, or parses `${key}_json` when the workflow sent the JSON string variable. */
function readResult<T>(payload: Record<string, unknown>, key: string): T | null {
  const direct = payload[key];
  if (direct && typeof direct === "object") return direct as T;
  const serialized = payload[`${key}_json`];
  if (typeof serialized === "string" && serialized.trim()) {
    try {
      const parsed = JSON.parse(serialized);
      if (parsed && typeof parsed === "object") return parsed as T;
    } catch {
      return null;
    }
  }
  return null;
}

function findAction(ref: string | null): Action | undefined {
  if (!ref) return undefined;
  return getSituation().actions.find(
    (candidate) => candidate.id === ref || candidate.externalActionId === ref,
  );
}

// ---------------------------------------------------------------------------
// Interpretation
// ---------------------------------------------------------------------------

function interpretDispatch(result: DispatchResult): CallbackIntent {
  const raw = (clean(result.dispatch_status) ?? "unclear").toLowerCase().replace(/\s+/g, "_");
  const status = dispatchStatusMap[raw] ?? "blocked";
  const actionRef = clean(result.action_id) ?? clean(result.dispatch_id)?.split(":")[0] ?? null;
  const action = findAction(actionRef);
  const notes: string[] = [];
  if (!dispatchStatusMap[raw])
    notes.push(`Unrecognized dispatch_status "${raw}" treated as unclear.`);

  const eta = typeof result.eta_minutes === "number" ? `${result.eta_minutes} min` : null;
  const constraint = clean(result.constraint_description);
  const reason = clean(result.rejection_reason);
  const statement = clean(result.responder_statement);
  const claims = (result.claims ?? [])
    .map((claim) => clean(claim?.statement))
    .filter((claim): claim is string => Boolean(claim));

  const summaryParts = [
    `Responder outcome: ${raw}`,
    eta ? `ETA ${eta}` : null,
    constraint ? `constraint: ${constraint}` : null,
    reason ? `reason: ${reason}` : null,
  ].filter(Boolean);
  const summary = summaryParts.join(" · ");

  const error =
    status === "succeeded"
      ? undefined
      : raw === "no_answer"
        ? "The responder did not answer the HappyRobot call."
        : raw === "failed"
          ? "The HappyRobot call failed technically."
          : `Responder ${raw.replace(/_/g, " ")}${reason ? `: ${reason}` : constraint ? `: ${constraint}` : ""}. Operator decision required.`;

  // What the responder said is field intelligence; it enters as a signal so the plan can react.
  const information: IncomingEventPayload[] = [];
  if (statement || claims.length > 0) {
    information.push({
      source: "happyrobot",
      title: `Dispatch feedback: ${raw.replace(/_/g, " ")}`,
      description: [statement, ...claims].filter(Boolean).join("\n"),
      zoneId: action?.zoneId,
      category: "dispatch-feedback",
      severity: "medium",
      confidence: "high",
      confirmed: null,
    });
  }

  const resourceId = clean(result.resource_id) ?? action?.resourceId ?? null;
  const resourceUpdate =
    resourceId && (raw === "rejected" || raw === "unavailable")
      ? { resourceId, status: "unavailable" as const }
      : null;

  return {
    kind: "dispatch",
    actionRef,
    status,
    externalActionId: clean(result.native_interaction_id) ?? undefined,
    error,
    summary,
    information,
    resourceUpdate,
    notes,
  };
}

function interpretPublicAlert(result: PublicAlertResult): CallbackIntent {
  const raw = (clean(result.alert_status) ?? "failed").toLowerCase();
  const status = alertStatusMap[raw] ?? "failed";
  const notes: string[] = [];
  if (!alertStatusMap[raw]) notes.push(`Unrecognized alert_status "${raw}" treated as failed.`);

  const recipients = result.recipient_count ?? 0;
  const sent = result.sent_count ?? 0;
  const failed = result.failed_count ?? 0;
  const summary = `Public alert ${raw}: ${sent} of ${recipients} recipients sent, ${failed} failed${
    result.audience_label ? ` (${result.audience_label})` : ""
  }.`;
  const error =
    status === "succeeded"
      ? undefined
      : raw === "not_approved"
        ? "HappyRobot gate refused to send: the request did not carry approval_status=approved."
        : raw === "partial"
          ? `${failed} of ${recipients} alert messages failed. Decide whether to retry the failed recipients.`
          : "The public alert could not be sent.";

  return {
    kind: "public-alert",
    actionRef: clean(result.action_id),
    status,
    error,
    summary,
    information: [],
    resourceUpdate: null,
    notes,
  };
}

function interpretGeneric(payload: GenericCallback): CallbackIntent | { invalid: string } {
  const info = Array.isArray(payload.newInformation) ? payload.newInformation : [];
  if (!payload.status && info.length === 0) {
    return { invalid: "Callback contains neither status nor new information: nothing to apply." };
  }
  let status: ActionStatus | null = null;
  if (payload.status) {
    status = genericStatusMap[payload.status.toLowerCase()] ?? null;
    if (!status) return { invalid: `Unrecognized status "${payload.status}".` };
  }
  const information = info.map((item): IncomingEventPayload => ({
    source: "happyrobot",
    title: item.type ? `New information: ${item.type}` : "New information from HappyRobot",
    description: item.description ?? "Information gathered during a HappyRobot interaction.",
    zoneId: item.zoneId,
    category: item.type ?? "coordination",
    // What someone reports on the phone arrives with high confidence but
    // unverified: a strong unconfirmed signal unless stated otherwise.
    severity: item.severity && severities.includes(item.severity) ? item.severity : "high",
    confidence: item.confidence && confidences.includes(item.confidence) ? item.confidence : "high",
    confirmed: item.confirmed ?? null,
  }));
  return {
    kind: "generic",
    actionRef: payload.localActionId ?? payload.externalActionId ?? null,
    status,
    externalActionId: payload.externalActionId,
    error:
      status === "failed"
        ? (payload.error ?? payload.summary ?? "HappyRobot marked the action as failed.")
        : undefined,
    summary: payload.summary ?? null,
    information,
    resourceUpdate: null,
    notes: [],
  };
}

function interpret(payload: Record<string, unknown>): CallbackIntent | { invalid: string } {
  const dispatch =
    readResult<DispatchResult>(payload, "dispatch_result") ??
    ("dispatch_status" in payload ? (payload as DispatchResult) : null);
  if (dispatch) return interpretDispatch(dispatch);

  const alert =
    readResult<PublicAlertResult>(payload, "public_alert_result") ??
    ("alert_status" in payload ? (payload as PublicAlertResult) : null);
  if (alert) return interpretPublicAlert(alert);

  return interpretGeneric(payload as GenericCallback);
}

// ---------------------------------------------------------------------------
// Idempotency on ingestion
// ---------------------------------------------------------------------------

interface ProcessedDelivery {
  at: number;
  status: number;
  body: Record<string, unknown>;
}

declare global {
  var happyRobotDeliveries: Map<string, ProcessedDelivery> | undefined;
}

/** Window during which a repeated callback is considered identical. */
const DELIVERY_TTL_MS = 15 * 60 * 1000;
const DELIVERY_MAX = 500;

function deliveries(): Map<string, ProcessedDelivery> {
  globalThis.happyRobotDeliveries ??= new Map<string, ProcessedDelivery>();
  return globalThis.happyRobotDeliveries;
}

function rememberDelivery(key: string, status: number, body: Record<string, unknown>) {
  const registry = deliveries();
  registry.set(key, { at: Date.now(), status, body });
  const limit = Date.now() - DELIVERY_TTL_MS;
  for (const [id, entry] of registry) {
    if (entry.at < limit) registry.delete(id);
  }
  while (registry.size > DELIVERY_MAX) {
    const first = registry.keys().next();
    if (first.done) break;
    registry.delete(first.value);
  }
}

function seenDelivery(key: string): ProcessedDelivery | null {
  const entry = deliveries().get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > DELIVERY_TTL_MS) {
    deliveries().delete(key);
    return null;
  }
  return entry;
}

/**
 * Delivery key: the one sent by HappyRobot if present, otherwise a hash of the
 * body. Two identical callbacks share a hash, so a resend does not duplicate
 * signals or re-transition the action status.
 */
function deliveryKey(request: Request, raw: string, payload: Record<string, unknown>): string {
  const header =
    request.headers.get("x-happyrobot-delivery-id") ?? request.headers.get("x-happyrobot-event-id");
  const declared = header ?? payload.deliveryId ?? payload.eventId;
  if (typeof declared === "string" && declared) return `id:${declared}`;
  return `hash:${createHash("sha256").update(raw).digest("hex")}`;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // 1. Mandatory secret. Without the variable the route is closed: a public
  //    webhook without a secret allows injecting false signals into the crisis.
  const verification = verifyWebhookSecret(request);
  if (!verification.ok) {
    const configured = isWebhookSecretConfigured();
    return fail(
      configured ? "no_autorizado" : "error_interno",
      verification.reason ?? "Callback rejected.",
      configured ? 401 : 503,
      { expectedHeader: WEBHOOK_SECRET_HEADER },
    );
  }

  // 2. Body.
  const raw = await request.text();
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = raw.length > 0 ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return fail("cuerpo_invalido", "Callback body must be a JSON object.", 400);
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return fail("json_invalido", "Callback body is not valid JSON.", 400);
  }

  const intent = interpret(payload);
  if ("invalid" in intent) return fail("cuerpo_invalido", intent.invalid, 400);

  // 3. Idempotency: the same repeated callback returns the same response
  //    without touching state again.
  const key = deliveryKey(request, raw, payload);
  const previous = seenDelivery(key);
  if (previous) {
    return json({ ...previous.body, duplicate: true }, previous.status);
  }

  const ingestedEventIds: string[] = [];
  const notes = [...intent.notes];
  let status = 200;

  // 4. New information -> system signals. Ingested before moving the action
  //    status: even if the action no longer exists, what the person on the
  //    phone reported remains valuable for replanning.
  for (const item of intent.information) {
    const result = addEvent(item, "happyrobot");
    ingestedEventIds.push(result.event.id);
    if (result.duplicate)
      notes.push(`Signal merged with an equivalent one: ${result.event.title}.`);
  }

  // 5. Action status.
  let action: Action | null = null;
  if (intent.status) {
    if (!intent.actionRef) {
      notes.push("Callback carries a status but does not identify any local action.");
      status = 202;
    } else {
      try {
        action = setActionStatus(
          intent.actionRef,
          intent.status,
          intent.externalActionId,
          intent.error,
          "happyrobot",
        );
      } catch {
        // The action may have been reset between the call and the callback.
        notes.push(`No local action exists with reference "${intent.actionRef}".`);
        status = 202;
      }
    }
  }

  // 6. Resource availability reported by the responder. After the status
  //    change, so the release performed by setActionStatus does not undo it.
  let resource: Resource | null = null;
  if (intent.resourceUpdate) {
    try {
      resource = updateResource(
        intent.resourceUpdate.resourceId,
        intent.resourceUpdate.status,
        "happyrobot",
      );
    } catch {
      notes.push(`No local resource exists with id "${intent.resourceUpdate.resourceId}".`);
    }
  }

  const body: Record<string, unknown> = {
    ok: true,
    duplicate: false,
    kind: intent.kind,
    action,
    resource,
    ingestedEventIds,
    notes,
    summary: intent.summary,
  };
  rememberDelivery(key, status, body);
  return json(body, status);
}
