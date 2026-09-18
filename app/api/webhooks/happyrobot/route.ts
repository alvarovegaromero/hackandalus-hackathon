// PROPIETARIO: agente de integración HappyRobot, contactos y escalado.
// Entrada de callbacks de HappyRobot. Ruta SEPARADA a propósito: aquí solo
// entran llamadas externas, con secreto obligatorio. Las operaciones de la
// interfaz (cancelar, reintentar) viven en /api/actions/[id]/status y no
// pueden compartir esta puerta, porque exigirles secreto rompe la UI.
//
// Este es el bucle que más puntua del reto: HappyRobot llama a alguien, lo que
// esa persona cuenta entra como señal nueva y el plan se rehace solo.

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { WEBHOOK_SECRET_HEADER, isWebhookSecretConfigured, verifyWebhookSecret } from "@/lib/happyrobot";
import { addEvent, setActionStatus } from "@/lib/store";
import type { ActionStatus, Confidence, IncomingEventPayload, Severity } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cabeceras y forma de error alineadas con `lib/validation.ts` (`error` +
 * `code`), sin importarlo: esa capa válida cuerpos de la interfaz y aquí hace
 * falta el texto crudo del cuerpo para calcular la huella de idempotencia.
 */
const NO_CACHE = {
  "cache-control": "no-store, no-cache, must-revalidate",
  pragma: "no-cache"
} as const;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_CACHE });
}

function fail(code: string, error: string, status: number, extra: Record<string, unknown> = {}) {
  return json({ error, code, ...extra }, status);
}

/** Esta ruta solo atiende callbacks: cualquier otro método se rechaza. */
const noPermitido = () =>
  NextResponse.json(
    { error: "Método no permitido. Métodos válidos en esta ruta: POST.", code: "metodo_no_permitido" },
    { status: 405, headers: { ...NO_CACHE, allow: "POST" } }
  );

export const GET = noPermitido;
export const PUT = noPermitido;
export const PATCH = noPermitido;
export const DELETE = noPermitido;

// ---------------------------------------------------------------------------
// Forma del callback (ver docs/happyDocumentation.md)
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
  /** Identificador de entrega, si HappyRobot lo envia. */
  deliveryId?: string;
  eventId?: string;
  newInformation?: NewInformationItem[];
}

/** Estados externos -> estados locales. */
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
  canceled: "cancelled"
};

const severidades: Severity[] = ["low", "medium", "high", "critical"];
const confianzas: Confidence[] = ["low", "medium", "high"];

// ---------------------------------------------------------------------------
// Idempotencia de entrada
// ---------------------------------------------------------------------------

interface ProcessedDelivery {
  at: number;
  status: number;
  body: Record<string, unknown>;
}

declare global {
  var happyRobotDeliveries: Map<string, ProcessedDelivery> | undefined;
}

/** Ventana durante la que un callback repetido se considera el mismo. */
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
 * Clave de entrega: la que mande HappyRobot si la manda, y si no una huella
 * del cuerpo. Dos callbacks identicos comparten huella, así que un reenvio no
 * duplica señales ni vuelve a mover el estado de la acción.
 */
function deliveryKey(request: Request, raw: string, payload: HappyRobotCallback): string {
  const cabecera =
    request.headers.get("x-happyrobot-delivery-id") ?? request.headers.get("x-happyrobot-event-id");
  const declarado = cabecera ?? payload.deliveryId ?? payload.eventId;
  if (declarado) return `id:${declarado}`;
  return `hash:${createHash("sha256").update(raw).digest("hex")}`;
}

// ---------------------------------------------------------------------------
// Ruta
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // 1. Secreto obligatorio. Sin variable configurada la ruta se cierra: un
  //    webhook público sin secreto deja inyectar señales falsas en la crisis.
  const verificacion = verifyWebhookSecret(request);
  if (!verificacion.ok) {
    const configurado = isWebhookSecretConfigured();
    return fail(
      configurado ? "no_autorizado" : "error_interno",
      verificacion.reason ?? "Callback rechazado.",
      configurado ? 401 : 503,
      { expectedHeader: WEBHOOK_SECRET_HEADER }
    );
  }

  // 2. Cuerpo.
  const raw = await request.text();
  let payload: HappyRobotCallback;
  try {
    payload = (raw.length > 0 ? JSON.parse(raw) : {}) as HappyRobotCallback;
  } catch {
    return fail("json_invalido", "El cuerpo del callback no es JSON válido.", 400);
  }

  const actionRef = payload.localActionId ?? payload.externalActionId;
  const info = Array.isArray(payload.newInformation) ? payload.newInformation : [];
  if (!payload.status && info.length === 0) {
    return fail(
      "cuerpo_invalido",
      "El callback no trae ni estado ni información nueva: no hay nada que aplicar.",
      400
    );
  }

  // 3. Idempotencia: el mismo callback repetido devuelve la misma respuesta
  //    sin volver a tocar el estado.
  const key = deliveryKey(request, raw, payload);
  const previo = seenDelivery(key);
  if (previo) {
    return json({ ...previo.body, duplicate: true }, previo.status);
  }

  const ingestedEventIds: string[] = [];
  const notes: string[] = [];
  let status = 200;

  // 4. Información nueva -> señales del sistema. Se ingesta antes de mover el
  //    estado de la acción: aunque la acción ya no exista, lo que ha contado
  //    la persona al teléfono sigue siendo valioso para replanificar.
  for (const item of info) {
    const payloadEvento: IncomingEventPayload = {
      source: "happyrobot",
      title: item.type ? `Información nueva: ${item.type}` : "Información nueva desde HappyRobot",
      description: item.description ?? "Información recogida durante una interacción de HappyRobot.",
      zoneId: item.zoneId,
      category: item.type ?? "coordinacion",
      // Lo que cuenta alguien al teléfono llega con confianza alta pero sin
      // verificar: entra como señal fuerte y sin confirmar salvo que lo digan.
      severity: item.severity && severidades.includes(item.severity) ? item.severity : "high",
      confidence: item.confidence && confianzas.includes(item.confidence) ? item.confidence : "high",
      confirmed: item.confirmed ?? null
    };
    const resultado = addEvent(payloadEvento, "happyrobot");
    ingestedEventIds.push(resultado.event.id);
    if (resultado.duplicate) notes.push(`Señal fusionada con una equivalente: ${resultado.event.title}.`);
  }

  // 5. Estado de la acción.
  let action = null;
  if (payload.status) {
    const mapeado = statusMap[payload.status.toLowerCase()];
    if (!mapeado) {
      const body = {
        error: `Estado "${payload.status}" no reconocido.`,
        code: "cuerpo_invalido",
        ingestedEventIds
      };
      rememberDelivery(key, 400, body);
      return json(body, 400);
    }
    if (!actionRef) {
      notes.push("El callback trae estado pero no identifica ninguna acción local.");
      status = 202;
    } else {
      try {
        action = setActionStatus(
          actionRef,
          mapeado,
          payload.externalActionId,
          mapeado === "failed"
            ? (payload.error ?? payload.summary ?? "HappyRobot marcó la acción como fallida.")
            : undefined,
          "happyrobot"
        );
      } catch {
        // La acción puede haberse reiniciado entre la llamada y el callback.
        notes.push(`No existe ninguna acción local con referencia "${actionRef}".`);
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
    summary: payload.summary ?? null
  };
  rememberDelivery(key, status, body);
  return json(body, status);
}
