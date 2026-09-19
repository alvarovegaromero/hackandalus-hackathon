// OWNER: API hardening and input validation agent.
// Human approval of an action: the point where the system acts.

import { approveAction } from "@/lib/store";
import { apiErrorFromThrown, apiOk, methodNotAllowed } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // This route does not read a body: the identifier is in the path and approval
  // takes no parameters. A body sent by the UI is ignored.
  try {
    const action = await approveAction(id);
    return apiOk({ action });
  } catch (error) {
    return apiErrorFromThrown(error, "Could not approve action");
  }
}

export const GET = methodNotAllowed(["POST"]);
export const PUT = methodNotAllowed(["POST"]);
export const PATCH = methodNotAllowed(["POST"]);
export const DELETE = methodNotAllowed(["POST"]);
