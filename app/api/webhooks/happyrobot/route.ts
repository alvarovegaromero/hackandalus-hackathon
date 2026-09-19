// OWNER: HappyRobot integration, contacts, and escalation agent.
// HappyRobot callback entry point. SEPARATE route by design: only external
// calls enter here, with mandatory secret. UI operations (cancel, retry)
// live in /api/actions/[id]/status and cannot share this gateway, because
// requiring a secret from them breaks the UI.
//
// This is the highest-scoring loop of the challenge: HappyRobot calls someone,
// what that person reports enters as a new signal, and the plan rebuilds itself.

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  WEBHOOK_SECRET_HEADER,
  isWebhookSecretConfigured,
  verifyWebhookSecret,
} from "@/lib/happyrobot";
import { addEvent, setActionStatus } from "@/lib/store";
import type { ActionStatus, Confidence, IncomingEventPayload, Severity } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Headers and error shape aligned with `lib/validation.ts` (`error` +
 * `code`), without importing it: that layer validates UI bodies while here
 * raw body text is needed to compute the idempotency hash.
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
const noPermitido = () =>
  NextResponse.json(
    {
      error: "Method not allowed. Valid methods on this route: POST.",
      code: "metodo_no_permitido",
    },
    { status: 405, headers: { ...NO_CACHE, allow: "POST" } },
  );

export const GET = noPermitido;
export const PUT = noPermitido;
export const PATCH = noPermitido;
export const DELETE = noPermitido;

// ---------------------------------------------------------------------------
// Callback shape (see docs/happyDocumentation.md)
// ---------------------------------------------------------------------------

interface NewInformationItem {
  type?: string;
  zoneId?: string;
  description?: string;
  severity?: Severity;
  confidence?: Confidence;
  confirmed?: boolean | null;
}

interface HappyRobotCallback {
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

/** External states -> local states. */
const statusMap: Record<string, ActionStatus> = {
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

const severidades: Severity[] = ["low", "medium", "high", "critical"];
const confianzas: Confidence[] = ["low", "medium", "high"];

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
  const registro = deliveries();
  registro.set(key, { at: Date.now(), status, body });
  const limite = Date.now() - DELIVERY_TTL_MS;
  for (const [id, entry] of registro) {
    if (entry.at < limite) registro.delete(id);
  }
  while (registro.size > DELIVERY_MAX) {
    const primero = registro.keys().next();
    if (primero.done) break;
    registro.delete(primero.value);
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
 * Delivery key: the one sent by HappyRobot if present, otherwise a hash
 * of the body. Two identical callbacks share a hash, so a resend does not
 * duplicate signals or re-transition the action status.
 */
function deliveryKey(request: Request, raw: string, payload: HappyRobotCallback): string {
  const cabecera =
    request.headers.get("x-happyrobot-delivery-id") ?? request.headers.get("x-happyrobot-event-id");
  const declarado = cabecera ?? payload.deliveryId ?? payload.eventId;
  if (declarado) return `id:${declarado}`;
  return `hash:${createHash("sha256").update(raw).digest("hex")}`;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // 1. Mandatory secret. Without configured variable the route is closed: a
  //    public webhook without a secret allows injecting false signals into the crisis.
  const verificacion = verifyWebhookSecret(request);
  if (!verificacion.ok) {
    const configurado = isWebhookSecretConfigured();
    return fail(
      configurado ? "no_autorizado" : "error_interno",
      verificacion.reason ?? "Callback rejected.",
      configurado ? 401 : 503,
      { expectedHeader: WEBHOOK_SECRET_HEADER },
    );
  }

  // 2. Body.
  const raw = await request.text();
  let payload: HappyRobotCallback;
  try {
    payload = (raw.length > 0 ? JSON.parse(raw) : {}) as HappyRobotCallback;
  } catch {
    return fail("json_invalido", "Callback body is not valid JSON.", 400);
  }

  const actionRef = payload.localActionId ?? payload.externalActionId;
  const info = Array.isArray(payload.newInformation) ? payload.newInformation : [];
  if (!payload.status && info.length === 0) {
    return fail(
      "cuerpo_invalido",
      "Callback contains neither status nor new information: nothing to apply.",
      400,
    );
  }

  // 3. Idempotency: the same repeated callback returns the same response
  //    without touching state again.
  const key = deliveryKey(request, raw, payload);
  const previo = seenDelivery(key);
  if (previo) {
    return json({ ...previo.body, duplicate: true }, previo.status);
  }

  const ingestedEventIds: string[] = [];
  const notes: string[] = [];
  let status = 200;

  // 4. New information -> system signals. Ingested before moving action
  //    status: even if the action no longer exists, what the person on the
  //    phone reported remains valuable for replanning.
  for (const item of info) {
    const payloadEvento: IncomingEventPayload = {
      source: "happyrobot",
      title: item.type ? `New information: ${item.type}` : "New information from HappyRobot",
      description: item.description ?? "Information gathered during a HappyRobot interaction.",
      zoneId: item.zoneId,
      category: item.type ?? "coordinacion",
      // What someone reports on the phone arrives with high confidence but
      // unverified: enters as a strong unconfirmed signal unless stated otherwise.
      severity: item.severity && severidades.includes(item.severity) ? item.severity : "high",
      confidence:
        item.confidence && confianzas.includes(item.confidence) ? item.confidence : "high",
      confirmed: item.confirmed ?? null,
    };
    const resultado = addEvent(payloadEvento, "happyrobot");
    ingestedEventIds.push(resultado.event.id);
    if (resultado.duplicate)
      notes.push(`Signal merged with an equivalent one: ${resultado.event.title}.`);
  }

  // 5. Action status.
  let action = null;
  if (payload.status) {
    const mapeado = statusMap[payload.status.toLowerCase()];
    if (!mapeado) {
      const body = {
        error: `Unrecognized status "${payload.status}".`,
        code: "cuerpo_invalido",
        ingestedEventIds,
      };
      rememberDelivery(key, 400, body);
      return json(body, 400);
    }
    if (!actionRef) {
      notes.push("Callback contains status but does not identify any local action.");
      status = 202;
    } else {
      try {
        action = setActionStatus(
          actionRef,
          mapeado,
          payload.externalActionId,
          mapeado === "failed"
            ? (payload.error ?? payload.summary ?? "HappyRobot marked the action as failed.")
            : undefined,
          "happyrobot",
        );
      } catch {
        // The action may have been reset between the call and the callback.
        notes.push(`No local action exists with reference "${actionRef}".`);
        status = 202;
      }
    }
  }

  const body: Record<string, unknown> = {
    ok: true,
    duplicate: false,
    action,
    ingestedEventIds,
    notes,
    summary: payload.summary ?? null,
  };
  rememberDelivery(key, status, body);
  return json(body, status);
}
