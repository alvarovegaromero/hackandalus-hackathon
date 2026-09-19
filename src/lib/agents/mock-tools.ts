// OWNER: P4 local simulated resource/communication tools; no external effects.
import { randomUUID } from "node:crypto";
import { tool } from "ai";
import {
  simulatedResponseInputSchema,
  simulatedToolExecutionSchema,
  type SimulatedToolExecution,
} from "../contracts/agent";
import { processingContextSchema } from "../contracts/filter";
import type { AgentRequest } from "../contracts/triage";
import type { ResourceState } from "../contracts/resource-state";

/** A fresh, isolated simulation ledger per planning call. Never imports a live adapter. */
export function createMockPlanningTools(request: AgentRequest, state?: ResourceState) {
  const context = processingContextSchema.parse({
    schemaVersion: request.schemaVersion,
    runId: request.runId,
    eventId: request.eventId,
    executionId: request.executionId,
  });
  const executions: SimulatedToolExecution[] = [];
  return {
    executions,
    tools: {
      simulateResponse: tool({
        description:
          "Propose ambulance assignments within the supplied inventory and hypothetical HappyRobot communications. Use an empty resource list when none are available or needed. No physical dispatch or message is sent. Call once, then copy these resources into the final plan.",
        inputSchema: simulatedResponseInputSchema,
        execute: async (input) => {
          if (executions.length > 0)
            throw new Error("Only one simulation is allowed per planner turn.");
          const args = simulatedResponseInputSchema.parse(input);
          const quantity = args.resources.reduce((sum, item) => sum + item.quantity, 0);
          if (state && quantity > state.resources[0].available)
            throw new Error("The proposal exceeds available ambulances.");
          const execution = simulatedToolExecutionSchema.parse({
            ...context,
            toolCallId: randomUUID(),
            toolName: "simulateResponse",
            status: "simulated",
            mode: "simulation",
            realActionsExecuted: false,
            arguments: args,
            result: {
              resourceAvailability: state ? "finite" : "unlimited",
              simulatedResources: args.resources,
              communications: args.communications.map(({ channel, audience }) => ({
                channel,
                audience,
                status: "simulated",
                provider: "happyrobot_mock",
              })),
              summary:
                "Simulation only. Resources were not dispatched and communications were not sent.",
            },
            observedAt: new Date().toISOString(),
          });
          executions.push(execution);
          return execution;
        },
      }),
    },
  };
}
