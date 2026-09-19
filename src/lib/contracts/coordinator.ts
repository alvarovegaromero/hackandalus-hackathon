// OWNER: P0/P4 global coordinator state and model proposal contracts.
import { z } from "zod";
import { normalizedReportSchema } from "../report";
import { impactFactorsSchema } from "./triage";

export const COORDINATOR_TICK_MS = 5000;
export const ambulanceIdSchema = z.enum(
  Array.from({ length: 10 }, (_, i) => `ambulance-${i + 1}`) as [string, ...string[]],
);
export const policeIdSchema = z.enum(
  Array.from({ length: 10 }, (_, i) => `police-${i + 1}`) as [string, ...string[]],
);
export const civilGuardIdSchema = z.enum(
  Array.from({ length: 10 }, (_, i) => `civil-guard-${i + 1}`) as [string, ...string[]],
);
export const resourceIdSchema = z.union([ambulanceIdSchema, policeIdSchema, civilGuardIdSchema]);
const patrolInventorySchema = (ids: typeof policeIdSchema) =>
  z.strictObject({
    total: z.literal(10),
    available: z.number().int().min(0).max(10),
    allocated: z.number().int().min(0).max(10),
    unavailable: z.number().int().min(0).max(10).optional(),
    units: z
      .array(
        z.strictObject({
          id: ids,
          status: z.enum(["available", "assigned", "unavailable"]),
          eventId: z.uuid().nullable(),
        }),
      )
      .length(10),
  });
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
  policeAssignments: z.array(z.strictObject({ unitId: policeIdSchema, eventId: z.uuid() })).max(10),
  civilGuardAssignments: z
    .array(z.strictObject({ unitId: civilGuardIdSchema, eventId: z.uuid() }))
    .max(10),
  missions: z
    .array(
      z.strictObject({
        action: z.enum(["create", "update", "cancel"]),
        missionId: z.uuid().nullable(),
        expectedRevision: z.number().int().positive().nullable(),
        eventIds: z.array(z.uuid()).min(1).max(100),
        objective: z.string().min(1).max(2000),
        instructions: z.string().min(1).max(4000),
      }),
    )
    .max(20),
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
    police: patrolInventorySchema(policeIdSchema),
    civilGuard: patrolInventorySchema(civilGuardIdSchema),
    ambulances: z.strictObject({
      total: z.literal(10),
      available: z.number().int().min(0).max(10),
      allocated: z.number().int().min(0).max(10),
      unavailable: z.number().int().min(0).max(10).optional(),
      units: z
        .array(
          z.strictObject({
            id: ambulanceIdSchema,
            status: z.enum(["available", "assigned", "unavailable"]),
            eventId: z.uuid().nullable(),
          }),
        )
        .length(10),
    }),
  })
  .superRefine((state, ctx) => {
    const eventIds = new Set(state.events.map((e) => e.eventId));
    for (const inventory of [state.police, state.civilGuard]) {
      if (
        new Set(inventory.units.map((u) => u.id)).size !== 10 ||
        inventory.units.some((u) =>
          u.status !== "assigned" ? u.eventId !== null : !u.eventId || !eventIds.has(u.eventId),
        ) ||
        inventory.allocated !== inventory.units.filter((u) => u.status === "assigned").length ||
        (inventory.unavailable ?? 0) !==
          inventory.units.filter((u) => u.status === "unavailable").length ||
        inventory.available + inventory.allocated + (inventory.unavailable ?? 0) !== 10
      )
        ctx.addIssue({ code: "custom", message: "Invalid patrol inventory" });
    }
    const units = state.ambulances.units;
    if (
      eventIds.size !== state.events.length ||
      new Set(units.map((u) => u.id)).size !== 10 ||
      units.some((u) =>
        u.status !== "assigned" ? u.eventId !== null : !u.eventId || !eventIds.has(u.eventId),
      ) ||
      state.ambulances.allocated !== units.filter((u) => u.status === "assigned").length ||
      (state.ambulances.unavailable ?? 0) !==
        units.filter((u) => u.status === "unavailable").length ||
      state.ambulances.available +
        state.ambulances.allocated +
        (state.ambulances.unavailable ?? 0) !==
        10
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
    state.ambulances.units.some((u) => u.status === "unavailable" && assignments.has(u.id)) ||
    state.ambulances.units.some(
      (u) => u.status === "assigned" && assignments.get(u.id) !== u.eventId,
    )
  )
    throw new Error("Invalid or stale proposal, or attempted release/reassignment.");
  for (const [inventory, allocations] of [
    [state.police, proposal.policeAssignments],
    [state.civilGuard, proposal.civilGuardAssignments],
  ] as const) {
    const assigned = new Map(allocations.map((a) => [a.unitId, a.eventId]));
    if (
      assigned.size !== allocations.length ||
      allocations.some((a) => !events.has(a.eventId)) ||
      inventory.units.some((u) => u.status === "unavailable" && assigned.has(u.id)) ||
      inventory.units.some((u) => u.status === "assigned" && assigned.get(u.id) !== u.eventId)
    )
      throw new Error("Invalid patrol assignments");
  }
  if (
    proposal.missions.some(
      (m) =>
        m.eventIds.some((id) => !events.has(id)) ||
        new Set(m.eventIds).size !== m.eventIds.length ||
        (m.action === "create"
          ? m.missionId !== null || m.expectedRevision !== null
          : !m.missionId || !m.expectedRevision),
    ) ||
    new Set(proposal.missions.filter((m) => m.missionId).map((m) => m.missionId)).size !==
      proposal.missions.filter((m) => m.missionId).length
  )
    throw new Error("Invalid mission events");
  return proposal;
}
