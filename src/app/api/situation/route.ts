// OWNER: API hardening and input validation agent.
// Live state read: polled by the UI every 4 seconds.

import { pollSituation } from "@/lib/store";
import { apiErrorFromThrown, apiOk, methodNotAllowed } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // `pollSituation` (and not `getSituation`) because polling is what
    // advances the scenario and sweeps stalled actions. With `getSituation`
    // the scenario never advanced and hung actions were never detected.
    return apiOk(pollSituation());
  } catch (error) {
    return apiErrorFromThrown(error, "Could not read situation");
  }
}

export const POST = methodNotAllowed(["GET"]);
export const PUT = methodNotAllowed(["GET"]);
export const PATCH = methodNotAllowed(["GET"]);
export const DELETE = methodNotAllowed(["GET"]);
