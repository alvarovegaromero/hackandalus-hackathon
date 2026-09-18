import type { CrisisEvent } from "../lib/domain";
import { coordinate } from "../lib/agents/coordinator";
import { executeAction } from "../lib/integrations/happyrobot";

export async function crisisWorkflow(event: CrisisEvent) {
  "use workflow";

  const decision = await planResponse(event);
  const results = await prepareActions(decision.plan);
  return { ...decision, results };
}

async function planResponse(event: CrisisEvent) {
  "use step";
  return coordinate(event);
}

async function prepareActions(plan: Awaited<ReturnType<typeof coordinate>>["plan"]) {
  "use step";
  return Promise.all(plan.actions.map(executeAction));
}
