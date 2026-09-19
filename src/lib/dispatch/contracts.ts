// OWNER: P4 HappyRobot resource dispatch wire contract and persisted evidence.
import { z } from "zod";
import { resourceIdSchema } from "../contracts/coordinator";

export const dispatchOutcomeSchema = z
  .enum([
    "accepted",
    "accepted_with_constraint",
    "accepted_with_limitation",
    "rejected",
    "unavailable",
    "unclear",
    "no_answer",
    "failed",
  ])
  .transform((value) =>
    value === "accepted_with_limitation" ? ("accepted_with_constraint" as const) : value,
  );
const text = z.string().max(8000).nullable().optional();
export const dispatchResultSchema = z
  .object({
    dispatch_id: z.uuid(),
    resource_id: resourceIdSchema,
    mission_id: z.uuid().optional(),
    action_id: z.uuid().optional(),
    assignment_id: z.uuid().optional(),
    incident_id: z.uuid().optional(),
    plan_id: text,
    run_id: z.string().min(1).max(500).nullable().optional(),
    native_interaction_id: text,
    dispatch_status: dispatchOutcomeSchema,
    eta_minutes: z.number().finite().nonnegative().nullable().optional(),
    constraint_description: text,
    rejection_reason: text,
    responder_statement: text,
    summary: text,
    transcript: z.string().max(32000).nullable().optional(),
    transcript_reference: text,
    claims: z
      .array(z.object({ statement: z.string().max(4000), uncertainty: text }).passthrough())
      .max(50)
      .nullable()
      .optional(),
    completed_at: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (value.mission_id && value.action_id && value.mission_id !== value.action_id)
      context.addIssue({ code: "custom", message: "Mission references disagree." });
    if (value.assignment_id && value.assignment_id !== value.dispatch_id)
      context.addIssue({
        code: "custom",
        message: "Assignment reference disagrees with dispatch.",
      });
  });
export type DispatchResult = z.infer<typeof dispatchResultSchema>;

export function parseDispatchResult(body: unknown): DispatchResult {
  const envelope = z.record(z.string(), z.unknown()).parse(body);
  const value =
    envelope.dispatch_result ??
    (typeof envelope.dispatch_result_json === "string"
      ? JSON.parse(envelope.dispatch_result_json)
      : envelope);
  return dispatchResultSchema.parse(value);
}

export interface DispatchRecord {
  dispatch_id: string;
  mission_id: string;
  mission_revision: number;
  run_id: string;
  event_id: string;
  resource_id: string;
  payload: Record<string, unknown>;
  status: string;
  provider_run_id: string | null;
}
export interface DispatchRpcResult {
  code: string;
  duplicate?: boolean;
  stale?: boolean;
  dispatchId?: string;
  missionId?: string;
  resourceId?: string;
  outcome?: string;
  dispatches?: DispatchRecord[];
  dispatch?: DispatchRecord;
}
export type DispatchRpc = (kind: string, data: unknown) => Promise<DispatchRpcResult>;
