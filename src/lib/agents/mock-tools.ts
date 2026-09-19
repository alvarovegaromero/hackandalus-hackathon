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

/** A fresh, isolated simulation ledger per planning call. Never imports a live adapter. */
export function createMockPlanningTools(request: AgentRequest) {
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
          "Simulate finite resource assignments under unlimited availability and hypothetical HappyRobot communications. No resource is dispatched and no message is sent. Call once with the proposed resources and communications, then use this simulated result in your final plan.",
        inputSchema: simulatedResponseInputSchema,
        execute: async (input) => {
          if (executions.length > 0)
            throw new Error("Only one simulation is allowed per planner turn.");
          const args = simulatedResponseInputSchema.parse(input);
          const execution = simulatedToolExecutionSchema.parse({
            ...context,
            toolCallId: randomUUID(),
            toolName: "simulateResponse",
            status: "simulated",
            mode: "simulation",
            realActionsExecuted: false,
            arguments: args,
            result: {
              resourceAvailability: "unlimited",
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
