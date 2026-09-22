import { setTimeout as delay } from "node:timers/promises";
import { readCoordinatorState, runCoordinatorCycle } from "@/lib/coordinator/runtime";
import { authorizeDemoControl } from "@/lib/demo-access";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Runs coordinator cycles without injecting events, on a fresh serverless budget, so a
 * run's last accepted reports get ranked. The coordinator commit is all-or-nothing: one
 * missing priority rejects the whole proposal, so cycles are retried (each is a fresh
 * model attempt) until one produces a complete plan or the budget runs out. Every
 * successful commit persists, so clicking again continues where this left off.
 */
export async function POST(request: Request) {
  const denied = authorizeDemoControl(request);
  if (denied) return denied;
  let outcome = "";
  const deadline = Date.now() + 100_000;
  for (let attempt = 0; attempt < 8 && Date.now() < deadline; attempt++) {
    const state = await readCoordinatorState();
    if (!state.events.length) {
      outcome = "NO_ACTIVE_EVENTS";
      break;
    }
    if (state.events.every((event) => event.priority)) {
      outcome = "OK";
      break;
    }
    const result = await runCoordinatorCycle("manual.settle");
    outcome = result.outcome;
    // BUSY means another cycle holds the lease; UNAVAILABLE is usually an incomplete
    // proposal. Both are retryable: wait briefly and let the next attempt try again.
    if (outcome !== "OK") await delay(2500);
  }
  const state = await readCoordinatorState();
  const unranked = state.events.filter((event) => !event.priority).length;
  return Response.json({ outcome, unranked });
}
