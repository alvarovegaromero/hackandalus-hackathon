import { createServerSupabase } from "@/lib/supabase/server";
import { resetEventPipeline } from "@/lib/event-pipeline";

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development")
    return Response.json({ error: "Demo controls are only available locally." }, { status: 404 });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Same-origin request required." }, { status: 403 });
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
