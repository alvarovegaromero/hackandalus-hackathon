// OWNER: P0/P4 global coordinator state and model proposal contracts.
import { z } from "zod";
import { normalizedReportSchema } from "../report";
import { impactFactorsSchema } from "./triage";

export const COORDINATOR_TICK_MS = 5000;
export const ambulanceIdSchema = z.enum(
  Array.from({ length: 10 }, (_, i) => `ambulance-${i + 1}`) as [string, ...string[]],
);
const priority = z.enum(["low", "medium", "high", "critical"]);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const globalPlanSchema = z.strictObject({
  objective: z.string().min(1).max(2000),
  steps: z.array(z.string().min(1).max(2000)).min(1).max(20),
});
export const coordinatorInputSchema = z.strictObject({
  report: normalizedReportSchema,
  factors: impactFactorsSchema.optional(),
});
export const coordinatorProposalSchema = z.strictObject({
  basedOnRevision: revision,
  situationOverview: z.string().min(1).max(4000),
  plan: globalPlanSchema,
  priorities: z
    .array(z.strictObject({ eventId: z.uuid(), priority, rationale: z.string().min(1).max(2000) }))
    .max(100),
  assignments: z
    .array(z.strictObject({ ambulanceId: ambulanceIdSchema, eventId: z.uuid() }))
    .max(10),
});
export const coordinatorStateSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    stateId: z.uuid(),
    runId: z.uuid(),
    revision,
    updatedAt: z.iso.datetime(),
    generatedAt: z.iso.datetime(),
    storage: z.literal("supabase"),
    executionMode: z.literal("simulation"),
    pollAfterMs: z.literal(3000),
    situationOverview: z.string().max(4000),
    plan: globalPlanSchema.nullable(),
    events: z
      .array(
        z.strictObject({
          eventId: z.uuid(),
          summary: z.string(),
          status: z.literal("active"),
          priority: priority.nullable(),
          rationale: z.string().nullable(),
        }),
      )
      .max(100),
    ambulances: z.strictObject({
      total: z.literal(10),
      available: z.number().int().min(0).max(10),
      allocated: z.number().int().min(0).max(10),
      units: z
        .array(
          z.strictObject({
            id: ambulanceIdSchema,
            status: z.enum(["available", "assigned"]),
            eventId: z.uuid().nullable(),
          }),
        )
        .length(10),
    }),
  })
  .superRefine((state, ctx) => {
    const eventIds = new Set(state.events.map((e) => e.eventId));
    const units = state.ambulances.units;
    if (
      eventIds.size !== state.events.length ||
      new Set(units.map((u) => u.id)).size !== 10 ||
      units.some((u) =>
        u.status === "available" ? u.eventId !== null : !u.eventId || !eventIds.has(u.eventId),
      ) ||
      state.ambulances.allocated !== units.filter((u) => u.status === "assigned").length ||
      state.ambulances.available + state.ambulances.allocated !== 10
    )
      ctx.addIssue({
        code: "custom",
        message: "Inventory counters, assignments and event references must agree.",
      });
  });
export type CoordinatorState = z.infer<typeof coordinatorStateSchema>;
export type CoordinatorProposal = z.infer<typeof coordinatorProposalSchema>;
export type CoordinatorInput = z.infer<typeof coordinatorInputSchema>;

export function validateCoordinatorProposal(
  state: CoordinatorState,
  input: unknown,
): CoordinatorProposal {
  const proposal = coordinatorProposalSchema.parse(input);
  const events = new Set(state.events.map((e) => e.eventId));
  const priorities = new Set(proposal.priorities.map((p) => p.eventId));
  const assignments = new Map(proposal.assignments.map((a) => [a.ambulanceId, a.eventId]));
  if (
    proposal.basedOnRevision !== state.revision ||
    priorities.size !== events.size ||
    priorities.size !== proposal.priorities.length ||
    [...priorities].some((id) => !events.has(id)) ||
    assignments.size !== proposal.assignments.length ||
    [...assignments.values()].some((id) => !events.has(id)) ||
    state.ambulances.units.some(
      (u) => u.status === "assigned" && assignments.get(u.id) !== u.eventId,
    )
  )
    throw new Error("Invalid or stale proposal, or attempted release/reassignment.");
  return proposal;
}
