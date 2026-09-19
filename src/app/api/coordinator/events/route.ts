import { authorizePipeline } from "@/lib/pipeline-auth";
import { coordinatorInputSchema } from "@/lib/contracts/coordinator";
import { enqueueCoordinatorEvent, CoordinatorConflict } from "@/lib/coordinator/runtime";
export async function POST(request: Request) {
  const denied = authorizePipeline(request);
  if (denied) return denied;
  const input = coordinatorInputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ code: "INVALID_REPORT" }, { status: 400 });
  try {
    const result = await enqueueCoordinatorEvent(input.data);
    return Response.json(result, { status: result.duplicate ? 200 : 202 });
  } catch (error) {
    return Response.json(
      { code: error instanceof CoordinatorConflict ? error.message : "COORDINATOR_UNAVAILABLE" },
      { status: error instanceof CoordinatorConflict ? 409 : 503 },
    );
  }
}
