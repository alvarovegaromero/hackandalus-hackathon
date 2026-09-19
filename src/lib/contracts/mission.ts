// OWNER: P4 subagent execution boundary; parent owns mission creation and reservations.
import { z } from "zod";
import { ambulanceIdSchema } from "./coordinator";

export const missionToolSchema = z.enum(["contactService", "getContactResult"]);
export const missionInputSchema = z
  .strictObject({
    missionId: z.uuid(),
    runId: z.uuid(),
    eventId: z.uuid(),
    revision: z.literal(1),
    objective: z.string().min(1).max(2000),
    instructions: z.string().min(1).max(4000),
    context: z.strictObject({
      incidentSummary: z.string().min(1).max(4000),
      priority: z.enum(["low", "medium", "high", "critical"]),
    }),
    assignedResourceIds: z.array(ambulanceIdSchema).max(10),
    allowedTools: z.array(missionToolSchema).max(2),
  })
  .superRefine((m, ctx) => {
    if (
      new Set(m.assignedResourceIds).size !== m.assignedResourceIds.length ||
      new Set(m.allowedTools).size !== m.allowedTools.length
    )
      ctx.addIssue({ code: "custom", message: "Resources and tool permissions must be unique." });
  });
export const contactInputSchema = z.strictObject({
  service: z.enum(["medical_coordination", "emergency_coordination"]),
  message: z.string().min(1).max(2000),
});
export const contactOperationSchema = contactInputSchema.extend({
  operationId: z.uuid(),
  provider: z.literal("happyrobot_mock"),
  status: z.enum(["pending", "acknowledged"]),
  realActionsExecuted: z.literal(false),
});
export const missionDecisionSchema = z.strictObject({
  status: z.enum(["waiting", "blocked", "completed"]),
  summary: z.string().min(1).max(4000),
  resourceRequest: z
    .strictObject({
      type: z.literal("ambulance"),
      additionalQuantity: z.number().int().min(1).max(100),
      reason: z.string().min(1).max(2000),
    })
    .nullable(),
});
export type MissionInput = z.infer<typeof missionInputSchema>;
export type ContactOperation = z.infer<typeof contactOperationSchema>;
export type MissionDecision = z.infer<typeof missionDecisionSchema>;
export const missionResultSchema = missionDecisionSchema.extend({
  status: z.enum(["waiting", "blocked", "completed", "failed"]),
  updateId: z.uuid(),
  missionId: z.uuid(),
  missionRevision: z.literal(1),
  needsParentDecision: z.boolean(),
  externalOperationIds: z.array(z.uuid()).max(2),
  executionMode: z.literal("simulation"),
  realActionsExecuted: z.literal(false),
});
export type MissionResult = z.infer<typeof missionResultSchema>;

export function validateMissionDecision(input: unknown, operations: ContactOperation[]) {
  const decision = missionDecisionSchema.parse(input);
  if (
    decision.status === "completed" &&
    (!operations.length ||
      operations.some((o) => o.status !== "acknowledged") ||
      decision.resourceRequest)
  )
    throw new Error(
      "Completion requires acknowledged mock contacts and no outstanding resource request.",
    );
  if (decision.status === "waiting" && !operations.some((o) => o.status === "pending"))
    throw new Error("Waiting requires a persisted pending contact.");
  return decision;
}
