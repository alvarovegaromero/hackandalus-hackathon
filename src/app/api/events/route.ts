// OWNER: API hardening and input validation agent.
// Signal ingestion into the command center.

import { acceptIncomingEvent, EventConflict } from "@/lib/event-pipeline";
import { authorizePipeline } from "@/lib/pipeline-auth";
import { enqueueLegacyEvent, CoordinatorConflict } from "@/lib/coordinator/runtime";
import type { IncomingEventPayload } from "@/lib/types";
import {
  apiError,
  apiErrorFromThrown,
  apiOk,
  incomingEventSchema,
  methodNotAllowed,
  parseJsonBody,
  validarReferencias,
} from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const denied = authorizePipeline(request);
  if (denied) return denied;
  const parsed = await parseJsonBody(request, incomingEventSchema);
  if (!parsed.ok) return parsed.response;

  // The zone is checked against live state: previously a non-existent zone was
  // accepted and the signal became orphaned, never appearing in any priority.
  const referencias = validarReferencias({ zoneId: parsed.data.zoneId });
  if (referencias) return referencias;

  try {
    const { id, ...payload } = parsed.data;
    const durable = await enqueueLegacyEvent(payload as IncomingEventPayload, id);
    const accepted = acceptIncomingEvent(payload as IncomingEventPayload, durable.eventId);
    // The durable coordinator owns processing; telemetry remains a receipt projection.
    return apiOk({ ...accepted, ...durable }, durable.duplicate ? 200 : 202);
  } catch (error) {
    if (error instanceof EventConflict) return apiError("conflicto", error.message, 409);
    if (error instanceof CoordinatorConflict) return apiError("conflicto", error.message, 409);
    return apiErrorFromThrown(error, "Could not register signal");
  }
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
