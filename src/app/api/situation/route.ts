// Compatibility tombstone. The scaffold scenario is no longer advanced by viewers.
export async function GET() {
  return Response.json(
    {
      code: "SITUATION_RETIRED",
      error: "Use /api/state for coordination and /api/map for geography.",
    },
    { status: 410 },
  );
}
