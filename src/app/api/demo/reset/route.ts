import { createServerSupabase } from "@/lib/supabase/server";
import { resetEventPipeline } from "@/lib/event-pipeline";
import { authorizeDemoControl } from "@/lib/demo-access";

export async function POST(request: Request) {
  const denied = authorizeDemoControl(request);
  if (denied) return denied;
  const { data, error } = await createServerSupabase().rpc("reset_coordinator_demo");
  if (error || !data) {
    console.error("Coordinator reset failed", { code: error?.code, message: error?.message });
    return Response.json(
      {
        error:
          error?.code === "PGRST202"
            ? "Reset function is unavailable. Apply coordinator reset migration 006."
            : `Could not reset coordinator (${error?.code ?? "EMPTY_RESULT"}). Check server logs.`,
      },
      { status: 503 },
    );
  }
  resetEventPipeline();
  return Response.json({ runId: data.runId });
}
