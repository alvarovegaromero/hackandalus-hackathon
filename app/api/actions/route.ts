// OWNER: API hardening and input validation agent.
// Manual action creation by an operator.

import { createAction } from "@/lib/store";
import {
  apiErrorFromThrown,
  apiOk,
  createActionSchema,
  methodNotAllowed,
  parseJsonBody,
  validarReferencias,
} from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, createActionSchema, { permitirVacio: false });
  if (!parsed.ok) return parsed.response;

  const referencias = validarReferencias({
    zoneId: parsed.data.zoneId,
    resourceId: parsed.data.resourceId,
    contactId: parsed.data.contactId,
  });
  if (referencias) return referencias;

  try {
    const action = createAction(parsed.data);
    return apiOk({ action }, 201);
  } catch (error) {
    return apiErrorFromThrown(error, "Could not create action");
  }
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
