// PROPIETARIO: agente de endurecimiento de la API y validacion de entrada.
//
// Ruta de INTERFAZ para operar sobre una accion: cancelar, reintentar o fijar
// su estado a mano. NO es el callback de HappyRobot.
//
// Antes esta ruta mezclaba las dos responsabilidades y exigia el secreto del
// webhook: con `HAPPYROBOT_WEBHOOK_SECRET` definido, como recomienda
// `.env.example`, los botones de cancelar y reintentar devolvian 401 y la
// interfaz quedaba inservible. El callback externo vive ahora en
// `app/api/webhooks/happyrobot`, con su propio secreto, y aqui no se pide
// ninguno: son operaciones humanas desde el panel.

import { cancelAction, getSituation, retryAction, setActionStatus } from "@/lib/store";
import type { Action } from "@/lib/types";
import { actionStatusSchema, apiError, apiErrorFromThrown, apiOk, methodNotAllowed, parseJsonBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Busca por id local o por id externo, igual que hace el store. */
function findAction(actionId: string): Action | undefined {
  return getSituation().actions.find(
    (candidate) => candidate.id === actionId || candidate.externalActionId === actionId
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(request, actionStatusSchema, { permitirVacio: false });
  if (!parsed.ok) return parsed.response;

  const payload = parsed.data;
  const actionId = payload.localActionId ?? id;
  const action = findAction(actionId);
  if (!action) {
    return apiError("no_encontrado", `No existe ninguna acción con identificador "${actionId}".`, 404);
  }

  const operation = payload.operation ?? "set-status";

  try {
    if (operation === "cancel") {
      // Cancelar algo ya terminado o ya cancelado no es un error del servidor:
      // es un conflicto de estado y se responde 409.
      if (action.status === "succeeded" || action.status === "cancelled") {
        return apiError(
          "conflicto",
          `La acción ya está en estado "${action.status}" y no se puede cancelar.`,
          409
        );
      }
      return apiOk({ action: cancelAction(action.id) });
    }

    if (operation === "retry") {
      if (action.status === "running") {
        return apiError("conflicto", "La acción está en curso: cancélala antes de reintentarla.", 409);
      }
      if (action.status === "succeeded") {
        return apiError("conflicto", "La acción ya terminó con éxito: no tiene sentido reintentarla.", 409);
      }
      return apiOk({ action: retryAction(action.id) });
    }

    if (!payload.status) {
      return apiError(
        "cuerpo_invalido",
        "Para fijar el estado hay que indicar el campo status.",
        400,
        [{ campo: "status", mensaje: "Campo obligatorio con la operación set-status." }]
      );
    }

    // Cambio de estado iniciado por el operador: el actor es "operator", no
    // "happyrobot", para que la auditoria no atribuya a la integracion algo
    // que hizo una persona.
    const updated = setActionStatus(
      action.id,
      payload.status,
      payload.externalActionId,
      payload.error,
      "operator"
    );
    return apiOk({ action: updated });
  } catch (error) {
    return apiErrorFromThrown(error, "No se pudo actualizar la acción");
  }
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
