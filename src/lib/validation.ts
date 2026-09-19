// OWNER: API hardening and input validation agent.
//
// Single layer of validation and error responses for all routes in
// `app/api`. Before this module, each route used `(await request.json()) as T`,
// which is a TypeScript cast with no runtime checks: a malformed body
// crashed with a 500 and a non-existent zone was accepted silently.
//
// Rules enforced by this module:
//  - All error responses have the same shape.
//  - All bodies are validated with zod before touching the store.
//  - References (zone, resource, contact) are checked against live state,
//    not just against the type.

import { NextResponse } from "next/server";
import { z } from "zod";

import { getSituation } from "./store";

// ---------------------------------------------------------------------------
// Error shape
// ---------------------------------------------------------------------------

/**
 * API error codes. These are stable identifiers for the client,
 * so they remain ASCII without accents.
 */
export type ApiErrorCode =
  | "cuerpo_invalido"
  | "json_invalido"
  | "cuerpo_vacio"
  | "cuerpo_demasiado_grande"
  | "tipo_contenido_no_soportado"
  | "referencia_desconocida"
  | "no_autorizado"
  | "no_encontrado"
  | "conflicto"
  | "metodo_no_permitido"
  | "error_interno";

export interface ApiErrorDetail {
  campo: string;
  mensaje: string;
}

/**
 * Error body common to the entire API. `error` is kept as a string because
 * it was already read by the UI and tests; `code` and `detalles` are additive.
 */
export interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
  detalles?: ApiErrorDetail[];
}

const NO_CACHE_HEADERS = {
  "cache-control": "no-store, no-cache, must-revalidate",
  pragma: "no-cache",
} as const;

/** Successful response with no-cache headers: state changes every second. */
export function apiOk<T>(body: T, status = 200, extraHeaders: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_CACHE_HEADERS, ...extraHeaders } });
}

/** Error response with the unique API shape. */
export function apiError(
  code: ApiErrorCode,
  error: string,
  status: number,
  detalles?: ApiErrorDetail[],
  extraHeaders: Record<string, string> = {},
) {
  const body: ApiErrorBody = detalles?.length ? { error, code, detalles } : { error, code };
  return NextResponse.json(body, { status, headers: { ...NO_CACHE_HEADERS, ...extraHeaders } });
}

/**
 * Translates an error thrown by the store into an appropriate HTTP code:
 * "not found" is 404, any unexpected error is 500 (not 404, as all routes
 * previously did).
 */
export function apiErrorFromThrown(error: unknown, contexto: string) {
  const mensaje = error instanceof Error ? error.message : String(error);
  if (/not found|no encontrad/i.test(mensaje)) {
    return apiError("no_encontrado", `${contexto}: requested resource was not found.`, 404);
  }
  // The raw message is not filtered beyond what is necessary to debug the demo,
  // but is left visible: this is a hackathon environment.
  return apiError("error_interno", `${contexto}: internal error (${mensaje}).`, 500);
}

/** Handler for disallowed methods, with the correct `Allow` header. */
export function methodNotAllowed(permitidos: string[]) {
  return () =>
    apiError(
      "metodo_no_permitido",
      `Method not allowed. Valid methods on this route: ${permitidos.join(", ")}.`,
      405,
      undefined,
      { allow: permitidos.join(", ") },
    );
}

// ---------------------------------------------------------------------------
// Body reading and validation
// ---------------------------------------------------------------------------

/** Body size limit. Sufficient for any real signal and prevents abuse. */
export const MAX_BODY_BYTES = 32 * 1024;

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

function contentTypeAceptable(request: Request): boolean {
  const raw = request.headers.get("content-type");
  // Missing header is accepted: `new Request(url, { body })` and some clients
  // omit it, and the body is validated during parsing anyway.
  if (!raw) return true;
  const tipo = raw.split(";")[0]!.trim().toLowerCase();
  return (
    tipo === "application/json" || tipo.endsWith("+json") || tipo === "text/plain" || tipo === ""
  );
}

function describeIssue(issue: z.core.$ZodIssue): ApiErrorDetail {
  const campo = issue.path.length ? issue.path.join(".") : "(body)";

  switch (issue.code) {
    case "invalid_type":
      return { campo, mensaje: `Expected ${issue.expected}, received different type.` };
    case "invalid_value":
      return {
        campo,
        mensaje: `Invalid value. Allowed values: ${issue.values.map((value) => String(value)).join(", ")}.`,
      };
    case "unrecognized_keys":
      return { campo, mensaje: `Unrecognized fields: ${issue.keys.join(", ")}.` };
    case "too_small":
      return {
        campo,
        mensaje: `Value is too short or small (minimum ${String(issue.minimum)}).`,
      };
    case "too_big":
      return {
        campo,
        mensaje: `Value is too long or large (maximum ${String(issue.maximum)}).`,
      };
    default:
      return { campo, mensaje: issue.message };
  }
}

/**
 * Reads request body and validates it against a zod schema.
 * Covers: incorrect Content-Type, oversized body, empty body,
 * malformed JSON, non-object JSON, and invalid fields.
 */
export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  opciones: { permitirVacio?: boolean } = {},
): Promise<ParsedBody<T>> {
  const { permitirVacio = true } = opciones;

  if (!contentTypeAceptable(request)) {
    return {
      ok: false,
      response: apiError(
        "tipo_contenido_no_soportado",
        "Body must be sent as application/json.",
        415,
      ),
    };
  }

  const declarado = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declarado) && declarado > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: apiError(
        "cuerpo_demasiado_grande",
        `Body exceeds maximum allowed size of ${MAX_BODY_BYTES} bytes.`,
        413,
      ),
    };
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return {
      ok: false,
      response: apiError("cuerpo_invalido", "Could not read request body.", 400),
    };
  }

  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: apiError(
        "cuerpo_demasiado_grande",
        `Body exceeds maximum allowed size of ${MAX_BODY_BYTES} bytes.`,
        413,
      ),
    };
  }

  let valor: unknown;
  if (raw.trim() === "") {
    if (!permitirVacio) {
      return {
        ok: false,
        response: apiError("cuerpo_vacio", "Missing request body: expected a JSON object.", 400),
      };
    }
    // An empty body is equivalent to `{}`: the schema decides if that suffices.
    valor = {};
  } else {
    try {
      valor = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        response: apiError("json_invalido", "Body is not valid JSON.", 400),
      };
    }
  }

  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    return {
      ok: false,
      response: apiError("cuerpo_invalido", "Body must be a JSON object.", 400),
    };
  }

  const resultado = schema.safeParse(valor);
  if (!resultado.success) {
    return {
      ok: false,
      response: apiError(
        "cuerpo_invalido",
        "Invalid request: check the specified fields.",
        400,
        resultado.error.issues.map(describeIssue),
      ),
    };
  }

  return { ok: true, data: resultado.data };
}

// ---------------------------------------------------------------------------
// Domain schemas
// ---------------------------------------------------------------------------

export const severitySchema = z.enum(["low", "medium", "high", "critical"]);
export const confidenceSchema = z.enum(["low", "medium", "high"]);
export const eventSourceSchema = z.enum([
  "happyrobot",
  "sensor",
  "operator",
  "public",
  "demo",
  "scenario",
]);
export const actionChannelSchema = z.enum([
  "call",
  "sms",
  "email",
  "ticket",
  "webhook",
  "whatsapp",
  "slack",
]);
export const demoKindSchema = z.enum([
  "incident",
  "resource-down",
  "route-blocked",
  "integration-failure",
]);

/** States that an operator can manually set from the UI. */
export const operatorActionStatusSchema = z.enum([
  "pending",
  "approved",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
]);

const texto = (max: number) => z.string().trim().min(1).max(max);
const identificador = z.string().trim().min(1).max(80);

/**
 * Incoming signal. Fields are optional because the store applies defaults,
 * but the object cannot be empty: a POST with nothing useful created a
 * phantom signal in the default zone.
 * Strict by design: a misspelled field (`zoneid`, `severidad`) must fail
 * loudly rather than being lost silently.
 */
export const incomingEventSchema = z
  .strictObject({
    source: eventSourceSchema.optional(),
    title: texto(200).optional(),
    description: texto(2000).optional(),
    zoneId: identificador.optional(),
    category: texto(80).optional(),
    severity: severitySchema.optional(),
    confidence: confidenceSchema.optional(),
    confirmed: z.boolean().nullable().optional(),
  })
  .refine((valor) => Boolean(valor.zoneId ?? valor.category ?? valor.title ?? valor.description), {
    message: "Provide at least zoneId, category, title, or description to create a signal.",
  });

export type IncomingEventInput = z.infer<typeof incomingEventSchema>;

export const createActionSchema = z.strictObject({
  channel: actionChannelSchema,
  target: texto(200),
  objective: texto(300),
  reason: texto(500),
  zoneId: identificador,
  resourceId: identificador.optional(),
  contactId: identificador.optional(),
});

export type CreateActionInput = z.infer<typeof createActionSchema>;

export const markEventSchema = z.strictObject({
  confirmed: z.boolean(),
});

/**
 * Status route body, which is now UI-only (cancel, retry, or set status).
 * The external HappyRobot callback lives in `app/api/webhooks/happyrobot`,
 * with its own secret.
 */
export const actionStatusSchema = z
  .strictObject({
    operation: z.enum(["cancel", "retry", "set-status"]).optional(),
    status: operatorActionStatusSchema.optional(),
    externalActionId: identificador.optional(),
    localActionId: identificador.optional(),
    error: texto(500).optional(),
  })
  .refine((valor) => Boolean(valor.operation ?? valor.status), {
    message: "Specify an operation (cancel, retry, or set-status) or a valid status.",
  });

export type ActionStatusInput = z.infer<typeof actionStatusSchema>;

export const demoInjectSchema = z.strictObject({
  kind: demoKindSchema.optional(),
});

// ---------------------------------------------------------------------------
// Reference validation against live state
// ---------------------------------------------------------------------------

export interface ReferenciasAValidar {
  zoneId?: string;
  resourceId?: string;
  contactId?: string;
}

/**
 * Checks that payload references actually exist.
 * Previously, `zoneId: "zone-nope"` was saved and the signal became orphaned,
 * with no zone to prioritize.
 */
export function validarReferencias(referencias: ReferenciasAValidar): NextResponse | null {
  const situacion = getSituation();
  const detalles: ApiErrorDetail[] = [];

  if (
    referencias.zoneId !== undefined &&
    !situacion.zones.some((zona) => zona.id === referencias.zoneId)
  ) {
    detalles.push({
      campo: "zoneId",
      mensaje: `Zone "${referencias.zoneId}" does not exist. Valid zones: ${situacion.zones
        .map((zona) => zona.id)
        .join(", ")}.`,
    });
  }

  if (
    referencias.resourceId !== undefined &&
    !situacion.resources.some((recurso) => recurso.id === referencias.resourceId)
  ) {
    detalles.push({
      campo: "resourceId",
      mensaje: `Resource "${referencias.resourceId}" does not exist.`,
    });
  }

  if (
    referencias.contactId !== undefined &&
    !situacion.contacts.some((contacto) => contacto.id === referencias.contactId)
  ) {
    detalles.push({
      campo: "contactId",
      mensaje: `Contact "${referencias.contactId}" does not exist.`,
    });
  }

  if (!detalles.length) return null;
  return apiError(
    "referencia_desconocida",
    "Request references elements that do not exist.",
    400,
    detalles,
  );
}

// ---------------------------------------------------------------------------
// Demo route protection
// ---------------------------------------------------------------------------

/** Header where the demo route token is sent. */
export const DEMO_TOKEN_HEADER = "x-demo-token";

/**
 * Demo routes manipulate and reset crisis state, so they cannot remain open.
 * Rules designed so the presenter does not struggle with auth before the jury:
 *
 *  - `DEMO_API_TOKEN` defined: must send that token (header `x-demo-token`,
 *    `Authorization: Bearer <token>`, or `?token=`).
 *  - `DEMO_API_TOKEN` empty and NODE_ENV is not production: open, frictionless.
 *    This is local demo mode.
 *  - `DEMO_API_TOKEN` empty and NODE_ENV is production: routes disabled.
 *    Without a secret they are not exposed to the internet.
 */
export function autorizarRutaDemo(request: Request): NextResponse | null {
  const esperado = process.env.DEMO_API_TOKEN?.trim();

  if (!esperado) {
    if (process.env.NODE_ENV === "production") {
      return apiError(
        "no_autorizado",
        "Demo routes are disabled in production. Set DEMO_API_TOKEN to enable them.",
        401,
      );
    }
    return null;
  }

  const cabecera = request.headers.get(DEMO_TOKEN_HEADER);
  const autorizacion = request.headers.get("authorization");
  const bearer = autorizacion?.toLowerCase().startsWith("bearer ")
    ? autorizacion.slice("bearer ".length).trim()
    : null;
  let query: string | null = null;
  try {
    query = new URL(request.url).searchParams.get("token");
  } catch {
    query = null;
  }

  const recibido = cabecera ?? bearer ?? query;
  if (recibido && recibido === esperado) return null;

  return apiError(
    "no_autorizado",
    `Demo routes require a token: send the ${DEMO_TOKEN_HEADER} header with the value of DEMO_API_TOKEN.`,
    401,
  );
}
