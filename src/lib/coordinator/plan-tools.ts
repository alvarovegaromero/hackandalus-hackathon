// OWNER: Person A integration: audited parent plan edits without resource mutation.
import "server-only";
import { createHash } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import { globalPlanSchema } from "../contracts/coordinator";
import { createServerSupabase } from "../supabase/server";

export const parentPlanUpdateSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  plan: globalPlanSchema.pick({ objective: true, steps: true }),
  reason: z.string().min(1).max(2000),
});

export async function updateParentPlan(
  runId: string,
  input: z.infer<typeof parentPlanUpdateSchema>,
) {
  z.uuid().parse(runId);
  const args = parentPlanUpdateSchema.parse(input);
  // Stable key for an identical retry, including a lost database response.
  const hash = createHash("sha256")
    .update(JSON.stringify({ runId, ...args }))
    .digest("hex");
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const { data, error } = await createServerSupabase().rpc("update_parent_plan", {
    p_run_id: runId,
    p_update_id: id,
    p_expected_revision: args.expectedRevision,
    p_plan: args.plan,
    p_reason: args.reason,
  });
  if (error || !data) return { code: "PLAN_UPDATE_UNAVAILABLE" };
  return data;
}

/** Add to the parent's tool set only; run identity comes from trusted server context. */
export function createParentPlanTools(runId: string) {
  z.uuid().parse(runId);
  return {
    updateGlobalPlan: tool({
      description:
        "Persist the global objective and ordered steps for ALL active incidents. Use the revision from your latest state read. Does not reserve, release or transfer resources. STATE_CONFLICT or INPUT_PENDING requires a fresh context before retrying. A successful edit replaces the current plan text and invalidates older in-flight coordinator proposals; do not also commit an old proposal afterwards. Give a brief reason, not private reasoning.",
      inputSchema: parentPlanUpdateSchema,
      execute: (input) => updateParentPlan(runId, input),
    }),
  };
}
