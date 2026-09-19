// PROPIETARIO: agente de endurecimiento de la API y validacion de entrada.
// Entrada de senales al centro de mando.

import { acceptIncomingEvent, EventConflict } from "@/lib/event-pipeline";
import { authorizePipeline } from "@/lib/pipeline-auth";
import { addEvent } from "@/lib/store";
import type { IncomingEventPayload } from "@/lib/types";
import {
  apiErrorFromThrown,
  apiError,
  apiOk,
  incomingEventSchema,
  methodNotAllowed,
  parseJsonBody,
  validarReferencias,
} from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = authorizePipeline(request);
  if (denied) return denied;
  const parsed = await parseJsonBody(request, incomingEventSchema);
  if (!parsed.ok) return parsed.response;

  // La zona se comprueba contra el estado vivo: antes una zona inexistente se
  // aceptaba y la senal quedaba huerfana, sin aparecer en ninguna prioridad.
  const referencias = validarReferencias({ zoneId: parsed.data.zoneId });
  if (referencias) return referencias;

  try {
    const { id, ...payload } = parsed.data;
    const accepted = acceptIncomingEvent(payload as IncomingEventPayload, id);
    // Preserve the existing command-center projection; it is not the future
    // filtering/triage/LLM pipeline and has its own semantic signal merging.
    if (!accepted.duplicate) {
      try {
        addEvent(payload as IncomingEventPayload);
      } catch {
        console.warn(
          JSON.stringify({ type: "command_center.projection_failed", eventId: accepted.eventId }),
        );
      }
    }
    return apiOk(accepted, accepted.duplicate ? 200 : 202);
  } catch (error) {
    if (error instanceof EventConflict) return apiError("conflicto", error.message, 409);
    return apiErrorFromThrown(error, "No se pudo registrar la señal");
  }
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
