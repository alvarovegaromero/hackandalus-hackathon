import { authorizeDashboardRead } from "@/lib/pipeline-auth";
import { readCoordinatorState } from "@/lib/coordinator/runtime";
import { isDemoShowcase } from "@/lib/demo-access";
import { showcaseSnapshot } from "@/lib/demo/showcase";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = authorizeDashboardRead(request);
  if (denied)
    return Response.json(
      {
        error: "Resource state access denied.",
        code: denied.status === 401 ? "UNAUTHORIZED" : "STATE_UNAVAILABLE",
      },
      { status: denied.status, headers: { "Cache-Control": "no-store" } },
    );
  try {
    if (isDemoShowcase())
      return Response.json(showcaseSnapshot.state, { headers: { "Cache-Control": "no-store" } });
    return Response.json(await readCoordinatorState(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Resource inventory is unavailable.", code: "STATE_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
