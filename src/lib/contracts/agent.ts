// OWNER: P0/P4 planning output and audit contracts.
import { z } from "zod";
import { evidenceRefSchema, processingContextSchema } from "./filter";
import { plannerPriorityDecisionSchema } from "./triage";

/** Model-authored content only; IDs and plan versions are assigned by the server. */
export const plannerOutputSchema = z.strictObject({
  decision: plannerPriorityDecisionSchema,
  objective: z.string().min(1).max(2000),
  steps: z
    .array(z.strictObject({ description: z.string().min(1).max(2000) }))
    .min(1)
    .max(10),
});

export const agentMessageSchema = processingContextSchema.extend({
  messageId: z.uuid(),
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string().min(1),
  createdAt: z.iso.datetime(),
  toolCallId: z.uuid().nullable(),
});

export const agentPlanSchema = processingContextSchema.extend({
  planId: z.uuid(),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  supersedesPlanId: z.uuid().nullable(),
  basedOnRunRevision: z.number().int().nonnegative(),
  priorityDecisionId: z.uuid(),
  evidence: z.array(evidenceRefSchema).min(1),
  summary: z.string().min(1),
  decidedAt: z.iso.datetime(),
  objective: z.string().min(1).max(2000),
  steps: z
    .array(
      z.strictObject({
        stepId: z.uuid(),
        description: z.string().min(1).max(2000),
        actionId: z.uuid().nullable(),
      }),
    )
    .min(1)
    .max(10),
});

/** P0 supplies authorized, safe summaries of persisted reports/decisions/outcomes. */
export const planningContextSchema = z.strictObject({
  planVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  history: z
    .array(
      z.strictObject({
        runId: z.uuid(),
        revision: z.number().int().nonnegative(),
        summary: z.string().min(1).max(4000),
        evidence: z.array(evidenceRefSchema),
      }),
    )
    .max(100),
});

export type AgentPlan = z.infer<typeof agentPlanSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type PlanningContext = z.infer<typeof planningContextSchema>;
export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

export const simulatedResponseInputSchema = z.strictObject({
  resources: plannerPriorityDecisionSchema.shape.proposedResources.max(20),
  communications: z
    .array(
      z.strictObject({
        channel: z.enum(["voice", "chat", "email"]),
        audience: z.enum(["operator", "responders", "affected_people"]),
        message: z.string().min(1).max(2000),
      }),
    )
    .max(10),
});

/** Local-only mock result, never evidence that an external action occurred. */
export const simulatedToolExecutionSchema = processingContextSchema.extend({
  toolCallId: z.uuid(),
  toolName: z.literal("simulateResponse"),
  status: z.literal("simulated"),
  mode: z.literal("simulation"),
  realActionsExecuted: z.literal(false),
  arguments: simulatedResponseInputSchema,
  result: z.strictObject({
    resourceAvailability: z.literal("unlimited"),
    simulatedResources: plannerPriorityDecisionSchema.shape.proposedResources.max(20),
    communications: z
      .array(
        z.strictObject({
          channel: z.enum(["voice", "chat", "email"]),
          audience: z.enum(["operator", "responders", "affected_people"]),
          status: z.literal("simulated"),
          provider: z.literal("happyrobot_mock"),
        }),
      )
      .max(10),
    summary: z.string().min(1),
  }),
  observedAt: z.iso.datetime(),
});

export type SimulatedToolExecution = z.infer<typeof simulatedToolExecutionSchema>;
