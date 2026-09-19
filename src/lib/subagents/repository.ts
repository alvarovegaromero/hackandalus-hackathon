// OWNER: P4 durable subagent execution and activity; never mutates inventory.
import "server-only";
import { readCoordinatorState } from "../coordinator/runtime";
import { createServerSupabase } from "../supabase/server";
import { missionInputSchema, type MissionInput } from "../contracts/mission";

export async function missionRpc(kind: string, token: string, data: unknown = {}) {
  const result = await createServerSupabase().rpc("subagent_execution", {
    p_kind: kind,
    p_token: token,
    p_data: data,
  });
  if (result.error || !result.data) throw new Error("Subagent persistence unavailable.");
  return result.data as {
    code: string;
    mission?: unknown;
    result?: unknown;
    operation?: unknown;
    operations?: unknown;
    duplicate?: boolean;
  };
}

/** Parent calls after committing its reservation; retries the same immutable snapshot. */
export async function submitReservedMission(input: MissionInput) {
  const mission = missionInputSchema.parse(input);
  const result = await missionRpc("submit", mission.missionId, mission);
  if (result.code !== "OK") throw new Error(result.code);
  return {
    missionId: mission.missionId,
    duplicate: result.duplicate,
    storage: "supabase" as const,
  };
}

/** Parent and FE consume this persisted read model; reading never starts execution. */
export async function readSubagents(missionId?: string) {
  const db = createServerSupabase();
  const { runId } = await readCoordinatorState();
  let query = db
    .from("subagent_missions")
    .select("mission_id,input,status,attempts,result,operations,created_at,updated_at")
    .eq("run_id", runId)
    .order("created_at")
    .limit(100);
  if (missionId) query = query.eq("mission_id", missionId);
  const { data, error } = await query;
  if (error) throw new Error("Subagent state unavailable.");
  let activity: unknown[] = [];
  if (missionId && data?.length) {
    const rows = await db
      .from("subagent_activity")
      .select("id,mission_id,type,payload,created_at")
      .eq("mission_id", missionId)
      .order("id", { ascending: false })
      .limit(100);
    if (rows.error) throw new Error("Subagent activity unavailable.");
    activity = rows.data.reverse();
  }
  return {
    schemaVersion: 1,
    executionMode: "simulation",
    pollAfterMs: 3000,
    missions: data,
    activity,
  };
}
