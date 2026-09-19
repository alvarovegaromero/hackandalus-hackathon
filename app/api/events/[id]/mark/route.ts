// OWNER: API hardening and input validation agent.
// Operator confirmation or dismissal of a signal.

import { markEvent } from "@/lib/store";
import {
  apiErrorFromThrown,
  apiOk,
  markEventSchema,
  methodNotAllowed,
  parseJsonBody,
} from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // `confirmed` is required: previously a body missing this field was interpreted
  // as "discard" due to `Boolean(payload.confirmed)`.
  const parsed = await parseJsonBody(request, markEventSchema, { permitirVacio: false });
  if (!parsed.ok) return parsed.response;

  try {
    const event = markEvent(id, parsed.data.confirmed);
    return apiOk({ event });
  } catch (error) {
    return apiErrorFromThrown(error, "Could not mark signal");
  }
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
