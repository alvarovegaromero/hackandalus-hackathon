// PROPIETARIO: agente de endurecimiento de la API y validacion de entrada.
// Entrada de senales al centro de mando.

import { addEvent } from "@/lib/store";
import type { IncomingEventPayload } from "@/lib/types";
import {
  apiErrorFromThrown,
  apiOk,
  incomingEventSchema,
  methodNotAllowed,
  parseJsonBody,
  validarReferencias,
} from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, incomingEventSchema);
  if (!parsed.ok) return parsed.response;

  // La zona se comprueba contra el estado vivo: antes una zona inexistente se
  // aceptaba y la senal quedaba huerfana, sin aparecer en ninguna prioridad.
  const referencias = validarReferencias({ zoneId: parsed.data.zoneId });
  if (referencias) return referencias;

  try {
    const result = addEvent(parsed.data as IncomingEventPayload);
    return apiOk(result, result.duplicate ? 200 : 201);
  } catch (error) {
    return apiErrorFromThrown(error, "No se pudo registrar la señal");
  }
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
