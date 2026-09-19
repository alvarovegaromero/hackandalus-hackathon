import { authorizePipeline } from "@/lib/pipeline-auth";

export async function POST(request: Request) {
  const denied = authorizePipeline(request);
  if (denied) return denied;
  return Response.json(
    {
      code: "RESOURCE_RELEASE_NOT_ENABLED",
      error: "Ambulances remain assigned. Resource-release input is future work.",
    },
    { status: 501 },
  );
}
