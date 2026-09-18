import { start } from "workflow/api";
import { authorize } from "@/lib/api-auth";
import { crisisEventSchema } from "@/lib/domain";
import { crisisWorkflow } from "@/workflows/crisis";

export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  const parsed = crisisEventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Invalid event", issues: parsed.error.issues }, { status: 400 });
  const run = await start(crisisWorkflow, [parsed.data]);
  return Response.json({ runId: run.runId }, { status: 202 });
}
