import { z } from "zod";
import { authorizeDashboardRead } from "@/lib/pipeline-auth";
import { readSubagents } from "@/lib/subagents/repository";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ missionId: string }> }) {
  const denied = authorizeDashboardRead(request);
  if (denied) return denied;
  const id = z.uuid().safeParse((await context.params).missionId);
  if (!id.success) return Response.json({ code: "INVALID_MISSION_ID" }, { status: 400 });
  try {
    const state = await readSubagents(id.data);
    return Response.json(state, {
      status: state.missions.length ? 200 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ code: "SUBAGENTS_UNAVAILABLE" }, { status: 503 });
  }
}
