import { authorizeDashboardRead } from "@/lib/pipeline-auth";
import { readSubagents } from "@/lib/subagents/repository";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const denied = authorizeDashboardRead(request);
  if (denied) return denied;
  try {
    return Response.json(await readSubagents(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ code: "SUBAGENTS_UNAVAILABLE" }, { status: 503 });
  }
}
