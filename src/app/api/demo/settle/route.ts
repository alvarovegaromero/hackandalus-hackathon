import { setTimeout as delay } from "node:timers/promises";
import { readCoordinatorState, runCoordinatorCycle } from "@/lib/coordinator/runtime";
import { authorizeDemoControl } from "@/lib/demo-access";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Runs coordinator cycles without injecting events, on a fresh serverless budget,
 * so the last accepted reports of a run get ranked. One cycle prioritizes every
 * accepted event, so a single call usually clears any leftover "unassessed".
 */
export async function POST(request: Request) {
  const denied = authorizeDemoControl(request);
  if (denied) return denied;
  let outcome = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await runCoordinatorCycle("manual.settle");
    outcome = result.outcome;
    if (outcome === "NO_ACTIVE_EVENTS" || outcome === "COORDINATOR_UNAVAILABLE") break;
    if (outcome === "OK") {
      const state = await readCoordinatorState();
      if (state.events.every((event) => event.priority)) break;
    }
    await delay(1500);
  }
  const state = await readCoordinatorState();
  const unranked = state.events.filter((event) => !event.priority).length;
  return Response.json({ outcome, unranked });
}
