// PROPIETARIO: agente de endurecimiento de la API y validación de entrada.
//
// Capa única de validación y de respuestas de error para todas las rutas de
// `app/api`. Antes de este módulo cada ruta hacía `(await request.json()) as T`,
// que es un casteo de TypeScript sin ninguna comprobación en tiempo de
// ejecución: un cuerpo malformado reventaba con un 500 y una zona inexistente
// se aceptaba en silencio.
//
// Reglas que impone este módulo:
//  - Todas las respuestas de error tienen la misma forma, en castellano.
//  - Todos los cuerpos se validan con zod antes de tocar el store.
//  - Las referencias (zona, recurso, contacto) se comprueban contra el estado
//    vivo, no solo contra el tipo.

import { NextResponse } from "next/server";
import { z } from "zod";

import { getSituation } from "./store";

// ---------------------------------------------------------------------------
// Forma de los errores
// ---------------------------------------------------------------------------

/**
 * Códigos de error de la API. Son identificadores estables para el cliente,
 * así que van en ASCII sin acentos; el texto legible sí lleva acentos.
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
 * Cuerpo de error común a toda la API. `error` se mantiene como cadena porque
 * es lo que ya leían la interfaz y los tests; `code` y `detalles` son aditivos.
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

/** Respuesta correcta con cabeceras de no-cache: el estado cambia cada segundo. */
export function apiOk<T>(body: T, status = 200, extraHeaders: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_CACHE_HEADERS, ...extraHeaders } });
}

/** Respuesta de error con la forma única de la API. */
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
 * Traduce un error lanzado por el store a un código HTTP con criterio:
 * "no encontrado" es 404, cualquier otra cosa inesperada es 500 (no 404, como
 * hacían todas las rutas antes).
 */
export function apiErrorFromThrown(error: unknown, contexto: string) {
  const mensaje = error instanceof Error ? error.message : String(error);
  if (/not found|no encontrad/i.test(mensaje)) {
    return apiError("no_encontrado", `${contexto}: no se encontró el recurso solicitado.`, 404);
  }
  // No se filtra el mensaje crudo al cliente más allá de lo necesario para
  // depurar la demo, pero sí se deja visible: es un entorno de hackathon.
  return apiError("error_interno", `${contexto}: error interno (${mensaje}).`, 500);
}

/** Handler para métodos no permitidos, con la cabecera `Allow` correcta. */
export function methodNotAllowed(permitidos: string[]) {
  return () =>
    apiError(
      "metodo_no_permitido",
      `Método no permitido. Métodos válidos en esta ruta: ${permitidos.join(", ")}.`,
      405,
      undefined,
      { allow: permitidos.join(", ") },
    );
}

// ---------------------------------------------------------------------------
// Lectura y validación del cuerpo
// ---------------------------------------------------------------------------

/** Límite de cuerpo. Suficiente para cualquier señal real y corta los abusos. */
export const MAX_BODY_BYTES = 32 * 1024;

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

function contentTypeAceptable(request: Request): boolean {
  const raw = request.headers.get("content-type");
  // Sin cabecera se acepta: `new Request(url, { body })` y algunos clientes no
  // la envían, y el cuerpo se valida igualmente al parsear.
  if (!raw) return true;
  const tipo = raw.split(";")[0]!.trim().toLowerCase();
  return (
    tipo === "application/json" || tipo.endsWith("+json") || tipo === "text/plain" || tipo === ""
  );
}

function describeIssue(issue: z.core.$ZodIssue): ApiErrorDetail {
  const campo = issue.path.length ? issue.path.join(".") : "(cuerpo)";

  switch (issue.code) {
    case "invalid_type":
      return { campo, mensaje: `Se esperaba ${issue.expected} y llegó otro tipo de valor.` };
    case "invalid_value":
      return {
        campo,
        mensaje: `Valor no válido. Valores admitidos: ${issue.values.map((value) => String(value)).join(", ")}.`,
      };
    case "unrecognized_keys":
      return { campo, mensaje: `Campos no reconocidos: ${issue.keys.join(", ")}.` };
    case "too_small":
      return {
        campo,
        mensaje: `El valor es demasiado corto o pequeño (mínimo ${String(issue.minimum)}).`,
      };
    case "too_big":
      return {
        campo,
        mensaje: `El valor es demasiado largo o grande (máximo ${String(issue.maximum)}).`,
      };
    default:
      return { campo, mensaje: issue.message };
  }
}

/**
 * Lee el cuerpo de la petición y lo valida contra un esquema zod.
 * Cubre: Content-Type incorrecto, cuerpo gigante, cuerpo vacío, JSON
 * malformado, JSON que no es un objeto y campos no válidos.
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
        "El cuerpo debe enviarse como application/json.",
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
        `El cuerpo supera el máximo admitido de ${MAX_BODY_BYTES} bytes.`,
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
      response: apiError("cuerpo_invalido", "No se pudo leer el cuerpo de la petición.", 400),
    };
  }

  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: apiError(
        "cuerpo_demasiado_grande",
        `El cuerpo supera el máximo admitido de ${MAX_BODY_BYTES} bytes.`,
        413,
      ),
    };
  }

  let valor: unknown;
  if (raw.trim() === "") {
    if (!permitirVacio) {
      return {
        ok: false,
        response: apiError(
          "cuerpo_vacio",
          "Falta el cuerpo de la petición: se espera un objeto JSON.",
          400,
        ),
      };
    }
    // Un cuerpo vacío equivale a `{}`: el esquema decide si eso es suficiente.
    valor = {};
  } else {
    try {
      valor = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        response: apiError("json_invalido", "El cuerpo no es JSON válido.", 400),
      };
    }
  }

  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    return {
      ok: false,
      response: apiError("cuerpo_invalido", "El cuerpo debe ser un objeto JSON.", 400),
    };
  }

  const resultado = schema.safeParse(valor);
  if (!resultado.success) {
    return {
      ok: false,
      response: apiError(
        "cuerpo_invalido",
        "La petición no es válida: revisa los campos indicados.",
        400,
        resultado.error.issues.map(describeIssue),
      ),
    };
  }

  return { ok: true, data: resultado.data };
}

// ---------------------------------------------------------------------------
// Esquemas de dominio
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

/** Estados que un operador puede fijar a mano desde la interfaz. */
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
 * Señal entrante. Los campos son opcionales porque el store aplica valores por
 * defecto, pero el objeto no puede estar vacío: un POST sin nada útil creaba
 * una señal fantasma "Nueva senal de crisis" en la zona por defecto.
 * Es estricto a propósito: un campo mal escrito (`zoneid`, `severidad`) debe
 * fallar de forma ruidosa en vez de perderse en silencio.
 */
export const incomingEventSchema = z
  .strictObject({
    id: z.uuid().optional(),
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
    message: "Indica al menos zoneId, category, title o description para crear una señal.",
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
 * Cuerpo de la ruta de estado, que ahora es solo de interfaz (cancelar,
 * reintentar o fijar estado). El callback externo de HappyRobot vive en
 * `app/api/webhooks/happyrobot`, con su propio secreto.
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
    message: "Indica una operación (cancel, retry o set-status) o un status válido.",
  });

export type ActionStatusInput = z.infer<typeof actionStatusSchema>;

export const demoInjectSchema = z.strictObject({
  kind: demoKindSchema.optional(),
});

// ---------------------------------------------------------------------------
// Validación de referencias contra el estado vivo
// ---------------------------------------------------------------------------

export interface ReferenciasAValidar {
  zoneId?: string;
  resourceId?: string;
  contactId?: string;
}

/**
 * Comprueba que las referencias del payload existen de verdad.
 * Este era el agujero silencioso: `zoneId: "zone-nope"` se guardaba y la señal
 * quedaba huérfana, sin zona a la que subir de prioridad.
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
      mensaje: `La zona "${referencias.zoneId}" no existe. Zonas válidas: ${situacion.zones
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
      mensaje: `El recurso "${referencias.resourceId}" no existe.`,
    });
  }

  if (
    referencias.contactId !== undefined &&
    !situacion.contacts.some((contacto) => contacto.id === referencias.contactId)
  ) {
    detalles.push({
      campo: "contactId",
      mensaje: `El contacto "${referencias.contactId}" no existe.`,
    });
  }

  if (!detalles.length) return null;
  return apiError(
    "referencia_desconocida",
    "La petición apunta a elementos que no existen.",
    400,
    detalles,
  );
}

// ---------------------------------------------------------------------------
// Protección de las rutas de demo
// ---------------------------------------------------------------------------

/** Cabecera donde se envía el token de las rutas de demo. */
export const DEMO_TOKEN_HEADER = "x-demo-token";

/**
 * Las rutas de demo manipulan y reinician el estado de la crisis, así que no
 * pueden quedar abiertas. Reglas, pensadas para que el presentador no pelee con
 * la autenticación delante del jurado:
 *
 *  - `DEMO_API_TOKEN` definido: hay que enviar ese token (cabecera
 *    `x-demo-token`, `Authorization: Bearer <token>` o `?token=`).
 *  - `DEMO_API_TOKEN` vacío y NODE_ENV distinto de production: abierto, sin
 *    fricción. Es el modo de la demo en local.
 *  - `DEMO_API_TOKEN` vacío y NODE_ENV production: rutas desactivadas. Sin
 *    secreto no se exponen a internet.
 */
export function autorizarRutaDemo(request: Request): NextResponse | null {
  const esperado = process.env.DEMO_API_TOKEN?.trim();

  if (!esperado) {
    if (process.env.NODE_ENV === "production") {
      return apiError(
        "no_autorizado",
        "Las rutas de demo están desactivadas en producción. Define DEMO_API_TOKEN para habilitarlas.",
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
    `Las rutas de demo exigen un token: envía la cabecera ${DEMO_TOKEN_HEADER} con el valor de DEMO_API_TOKEN.`,
    401,
  );
}
