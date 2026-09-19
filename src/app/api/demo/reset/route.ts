// OWNER: API hardening and input validation agent.
// Crisis state reset. Protected route: destructive.

import { resetSituation } from "@/lib/store";
import { apiErrorFromThrown, apiOk, autorizarRutaDemo, methodNotAllowed } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const noAutorizado = autorizarRutaDemo(request);
  if (noAutorizado) return noAutorizado;

  // Intentionally does not read body: reset takes no parameters, so an empty
  // body or "{}" from the UI are treated equally.
  try {
    return apiOk(resetSituation());
  } catch (error) {
    return apiErrorFromThrown(error, "Could not reset demo");
  }
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
