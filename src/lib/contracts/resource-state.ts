// OWNER: P0/P5 persisted finite-resource snapshot contract.
import { z } from "zod";

export const resourceTypeSchema = z.enum(["ambulance"]);

/** Initial demo capacities. Only backend code may initialize or change these totals. */
export const INITIAL_RESOURCE_CAPACITIES = Object.freeze({
  ambulance: 10,
});

export const RESOURCE_STATE_POLL_MS = 3000;
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const resourceQuantitySchema = z.strictObject({
  resourceType: resourceTypeSchema,
  quantity: count.min(1),
});

export const resourceCounterSchema = z
  .strictObject({
    resourceType: resourceTypeSchema,
    label: z.string().min(1),
    unit: z.literal("vehicle"),
    total: count,
    available: count,
    allocated: count,
  })
  .refine((row) => row.available + row.allocated === row.total, {
    message: "Available and allocated quantities must equal total capacity.",
  });

export const activeResourceAllocationSchema = z.strictObject({
  allocationId: z.uuid(),
  eventId: z.uuid(),
  executionId: z.uuid(),
  planId: z.uuid(),
  resources: z.array(resourceQuantitySchema).length(1),
  allocatedAt: z.iso.datetime(),
  expectedReleaseAt: z.iso.datetime().nullable(),
});

/** GET /api/state success body, including coherent counters and active allocations. */
export const resourceStateSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    stateId: z.uuid(),
    runId: z.uuid(),
    revision: count,
    generatedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    storage: z.literal("supabase"),
    executionMode: z.literal("simulation"),
    pollAfterMs: z.literal(RESOURCE_STATE_POLL_MS),
    resources: z.array(resourceCounterSchema).length(resourceTypeSchema.options.length),
    allocations: z.array(activeResourceAllocationSchema),
  })
  .superRefine((state, ctx) => {
    const ids = state.allocations.map((allocation) => allocation.allocationId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        path: ["allocations"],
        message: "Allocation IDs must be unique.",
      });
    }
    for (const row of state.resources) {
      const allocated = state.allocations.reduce(
        (total, allocation) =>
          total +
          allocation.resources.reduce(
            (sum, item) => sum + (item.resourceType === row.resourceType ? item.quantity : 0),
            0,
          ),
        0,
      );
      if (row.allocated !== allocated) {
        ctx.addIssue({
          code: "custom",
          path: ["resources"],
          message: "Counters must match active allocations in the same snapshot.",
        });
      }
    }
  });

export type ResourceType = z.infer<typeof resourceTypeSchema>;
export type ResourceState = z.infer<typeof resourceStateSchema>;
export type ResourceQuantity = z.infer<typeof resourceQuantitySchema>;
export type ActiveResourceAllocation = z.infer<typeof activeResourceAllocationSchema>;
