import { after } from "next/server";
import { authorizeDashboardRead, authorizePipeline } from "@/lib/pipeline-auth";
import { readCoordinatorState } from "@/lib/coordinator/runtime";
import { processDispatchReplanning } from "@/lib/coordinator/background";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** Read operational assignments and callback evidence without exposing contact configuration. */
export async function GET(request: Request) {
  const denied = authorizeDashboardRead(request);
  if (denied) return denied;
  try {
    const state = await readCoordinatorState();
    const { data, error } = await createServerSupabase()
      .from("resource_dispatches")
      .select(
        "dispatch_id,mission_id,mission_revision,event_id,resource_id,status,provider_run_id,result,start_error,created_at,updated_at",
      )
      .eq("run_id", state.runId)
      .order("created_at")
      .limit(100);
    if (error) throw error;
    return Response.json(
      { runId: state.runId, dispatches: data },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ code: "DISPATCH_STORAGE_UNAVAILABLE" }, { status: 503 });
  }
}

/** Explicit recovery after interrupted background work. Never redials a resource. */
export async function POST(request: Request) {
  const denied = authorizePipeline(request);
  if (denied) return denied;
  after(processDispatchReplanning);
  return Response.json({ status: "recovery_scheduled" }, { status: 202 });
}
