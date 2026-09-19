import type { Plan } from "../domain";

// Explicit boundary until the team's actual HappyRobot contract is available.
// Never pretend a proposed communication has been sent.
export async function executeAction(action: Plan["actions"][number]) {
  return {
    status: "blocked" as const,
    action,
    reason: "HappyRobot pending configuration: demo operation and recipients undefined.",
  };
}
