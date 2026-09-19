// OWNER: API hardening and input validation agent.
// Signal ingestion into the command center.

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

  // The zone is checked against live state: previously a non-existent zone was
  // accepted and the signal became orphaned, never appearing in any priority.
  const referencias = validarReferencias({ zoneId: parsed.data.zoneId });
  if (referencias) return referencias;

  try {
    const result = addEvent(parsed.data as IncomingEventPayload);
    return apiOk(result, result.duplicate ? 200 : 201);
  } catch (error) {
    return apiErrorFromThrown(error, "Could not register signal");
  }
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
