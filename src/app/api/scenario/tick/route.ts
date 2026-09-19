// OWNER: self-advancing scenario agent.
// Manual script advancement: applies due beats and returns the situation.
// The UI does not need to call this (polling /api/situation already advances
// the script), but it is useful for the presenter, tests, and an external
// cron if deployed in an environment without long-running processes.

import { stopHeartbeat } from "@/lib/scenario";
import { getSituation, pollSituation } from "@/lib/store";
import { apiErrorFromThrown, apiOk, methodNotAllowed } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    // Intentionally does not read body: tick takes no parameters.
    const situacion = pollSituation();
    // If script has ended, this is a good place to stop the heartbeat.
    if (!situacion.scenario.running) stopHeartbeat();
    return apiOk(situacion);
  } catch (error) {
    return apiErrorFromThrown(error, "Could not advance scenario");
  }
}

/** Side-effect-free read of scenario state, convenient for demo debugging. */
export async function GET() {
  try {
    return apiOk(getSituation().scenario);
  } catch (error) {
    return apiErrorFromThrown(error, "Could not read scenario state");
  }
}

export const PUT = methodNotAllowed(["GET", "POST"]);
export const PATCH = methodNotAllowed(["GET", "POST"]);
export const DELETE = methodNotAllowed(["GET", "POST"]);
