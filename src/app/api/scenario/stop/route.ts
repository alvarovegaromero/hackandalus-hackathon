// OWNER: self-advancing scenario agent.
// Pauses the script. This is not a reset: elapsed script time is preserved
// and calling /api/scenario/start again continues where it left off.

import { stopHeartbeat } from "@/lib/scenario";
import { stopScenarioRun } from "@/lib/store";
import { apiErrorFromThrown, apiOk, methodNotAllowed } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    // Stop heartbeat first: otherwise an in-flight tick could fire a
    // beat right after the operator requested to stop.
    stopHeartbeat();
    return apiOk(stopScenarioRun());
  } catch (error) {
    return apiErrorFromThrown(error, "Could not stop scenario");
  }
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
