import { authorizePipeline } from "@/lib/pipeline-auth";

export async function POST(request: Request) {
  const denied = authorizePipeline(request);
  if (denied) return denied;
  return Response.json(
    {
      code: "GLOBAL_COORDINATOR_REQUIRED",
      error: "Submit reports to /api/coordinator/events; the global worker owns planning.",
    },
    { status: 410 },
  );
}
