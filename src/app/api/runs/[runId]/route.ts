import { getRun } from "workflow/api";
import { authorize } from "@/lib/api-auth";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const denied = authorize(request);
  if (denied) return denied;
  const { runId } = await context.params;
  const run = getRun(runId);
  const status = await run.status;
  return Response.json({
    runId,
    status,
    result: status === "completed" ? await run.returnValue : null,
  });
}
