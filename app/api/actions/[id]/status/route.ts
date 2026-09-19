// OWNER: API hardening and input validation agent.
//
// UI route to operate on an action: cancel, retry, or manually set its
// status. This is NOT the HappyRobot callback.
//
// Previously this route mixed both responsibilities and required the webhook
// secret: with `HAPPYROBOT_WEBHOOK_SECRET` defined, as recommended by
// `.env.example`, cancel and retry buttons returned 401 and broke the UI.
// The external callback now lives in `app/api/webhooks/happyrobot`, with its
// own secret, and none is required here: these are human operations from the panel.

import { cancelAction, getSituation, retryAction, setActionStatus } from "@/lib/store";
import type { Action } from "@/lib/types";
import {
  actionStatusSchema,
  apiError,
  apiErrorFromThrown,
  apiOk,
  methodNotAllowed,
  parseJsonBody,
} from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Finds by local ID or external ID, same as the store. */
function findAction(actionId: string): Action | undefined {
  return getSituation().actions.find(
    (candidate) => candidate.id === actionId || candidate.externalActionId === actionId,
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
    return apiError("no_encontrado", `No action found with identifier "${actionId}".`, 404);
  }

  const operation = payload.operation ?? "set-status";

  try {
    if (operation === "cancel") {
      // Cancelling an already finished or cancelled action is not a server error:
      // it is a state conflict and returns 409.
      if (action.status === "succeeded" || action.status === "cancelled") {
        return apiError(
          "conflicto",
          `Action is already in "${action.status}" state and cannot be cancelled.`,
          409,
        );
      }
      return apiOk({ action: cancelAction(action.id) });
    }

    if (operation === "retry") {
      if (action.status === "running") {
        return apiError(
          "conflicto",
          "Action is currently running: cancel it before retrying.",
          409,
        );
      }
      if (action.status === "succeeded") {
        return apiError("conflicto", "Action already succeeded: retrying makes no sense.", 409);
      }
      return apiOk({ action: retryAction(action.id) });
    }

    if (!payload.status) {
      return apiError(
        "cuerpo_invalido",
        "Setting status requires specifying the status field.",
        400,
        [{ campo: "status", mensaje: "Required field for set-status operation." }],
      );
    }

    // Status change initiated by operator: actor is "operator", not
    // "happyrobot", so the audit trail does not attribute a human action
    // to the integration.
    const updated = setActionStatus(
      action.id,
      payload.status,
      payload.externalActionId,
      payload.error,
      "operator",
    );
    return apiOk({ action: updated });
  } catch (error) {
    return apiErrorFromThrown(error, "Could not update action");
  }
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
