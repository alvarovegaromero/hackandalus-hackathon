// PROPIETARIO: agente de endurecimiento de la API y validacion de entrada.
// Confirmacion o descarte de una senal por parte de un operador.

import { markEvent } from "@/lib/store";
import {
  apiErrorFromThrown,
  apiOk,
  markEventSchema,
  methodNotAllowed,
  parseJsonBody
} from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // `confirmed` es obligatorio: antes un cuerpo sin ese campo se interpretaba
  // como "descartar" por culpa de `Boolean(payload.confirmed)`.
  const parsed = await parseJsonBody(request, markEventSchema, { permitirVacio: false });
  if (!parsed.ok) return parsed.response;

  try {
    const event = markEvent(id, parsed.data.confirmed);
    return apiOk({ event });
  } catch (error) {
    return apiErrorFromThrown(error, "No se pudo marcar la señal");
  }
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
