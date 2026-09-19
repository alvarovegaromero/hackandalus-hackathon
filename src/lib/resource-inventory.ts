// OWNER: P0 durable simulated ambulance inventory and atomic plan commits.
import "server-only";
import { z } from "zod";
import { createServerSupabase } from "./supabase/server";
import { resourceStateSchema, type ResourceState } from "./contracts/resource-state";
import { agentRequestSchema, type AgentRequest } from "./contracts/triage";
import { planningContextSchema, type PlanningContext } from "./contracts/agent";
import { planReport, type AgentPlanningResult } from "./agents/plan-report";

export class ResourceConflict extends Error {
  constructor(
    public readonly code: string,
    public readonly state: ResourceState,
  ) {
    super(code);
  }
}

export async function readResourceState(): Promise<ResourceState> {
  const { data, error } = await createServerSupabase()
    .from("resource_inventory")
    .select("state")
    .eq("singleton", true)
    .single();
  if (error || !data) throw new Error("Resource inventory is unavailable.");
  return resourceStateSchema.parse({ ...data.state, generatedAt: new Date().toISOString() });
}

async function mutate(operationId: string, command: Record<string, unknown>) {
  const { data, error } = await createServerSupabase().rpc("mutate_resource_inventory", {
    p_operation_id: operationId,
    p_command: command,
  });
  if (error || !data)
    throw new Error("Resource mutation could not be confirmed. Retry the same operation ID.");
  const state = resourceStateSchema.parse(data.state);
  if (data.code !== "OK") throw new ResourceConflict(data.code, state);
  return { state, replayed: Boolean(data.replayed) };
}

export const releaseResourcesSchema = z.strictObject({
  operationId: z.uuid(),
  allocationId: z.uuid(),
  stateId: z.uuid(),
  runId: z.uuid(),
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

/** Release exactly the existing reservation, once. Physical completion is supplied externally. */
export async function releaseResources(input: z.infer<typeof releaseResourcesSchema>) {
  const { operationId, ...command } = releaseResourcesSchema.parse(input);
  return mutate(operationId, { kind: "release", ...command });
}

/** P4 entry point for persisted execution. No database lock is held across a model call. */
export async function planAndAllocate(input: AgentRequest, contextInput: PlanningContext) {
  const request = agentRequestSchema.parse(input);
  const context = planningContextSchema.parse(contextInput);
  const db = createServerSupabase();
  const { data: previous, error } = await db
    .from("resource_operations")
    .select("command")
    .eq("operation_id", request.executionId)
    .maybeSingle();
  if (error) throw new Error("Resource operation lookup failed.");
  const state = await readResourceState();
  const identity = JSON.stringify({ request, context });
  if (previous) {
    if (previous.command.identity !== identity)
      throw new ResourceConflict("IDEMPOTENCY_CONFLICT", state);
    return { planning: previous.command.planning as AgentPlanningResult, state, replayed: true };
  }
  if (request.runId !== state.runId) throw new ResourceConflict("STATE_CONFLICT", state);
  const planning = await planReport(request, context, { resourceState: state });
  const quantity = planning.decision.proposedResources.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
  const committed = await mutate(request.executionId, {
    kind: "allocate",
    stateId: state.stateId,
    runId: state.runId,
    expectedRevision: state.revision,
    quantity,
    identity,
    planning,
  });
  return { planning, ...committed };
}
