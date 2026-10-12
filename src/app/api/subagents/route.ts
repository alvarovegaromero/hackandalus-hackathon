import { authorizeDashboardRead } from "@/lib/pipeline-auth";
import { readSubagents } from "@/lib/subagents/repository";
import { isDemoShowcase } from "@/lib/demo-access";
import { showcaseSnapshot } from "@/lib/demo/showcase";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const denied = authorizeDashboardRead(request);
  if (denied) return denied;
  try {
    if (isDemoShowcase())
      return Response.json(showcaseSnapshot.missions, { headers: { "Cache-Control": "no-store" } });
    return Response.json(await readSubagents(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ code: "SUBAGENTS_UNAVAILABLE" }, { status: 503 });
  }
}
