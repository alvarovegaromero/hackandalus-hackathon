import { NextResponse } from "next/server";
import { validateWebhookSecret } from "@/lib/happyrobot";
import { cancelAction, retryAction, setActionStatus } from "@/lib/store";
import type { ActionStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const allowedStatuses: ActionStatus[] = [
  "pending",
  "approved",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "cancelled"
];

const externalStatusMap: Record<string, ActionStatus> = {
  completed: "succeeded",
  complete: "succeeded",
  success: "succeeded",
  in_progress: "running",
  needs_human: "blocked",
  error: "failed"
};

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!validateWebhookSecret(request)) {
    return NextResponse.json({ error: "Invalid HappyRobot webhook secret" }, { status: 401 });
  }

  const payload = (await request.json()) as {
    status?: ActionStatus | "completed" | "complete" | "success" | "in_progress" | "needs_human" | "error";
    operation?: "cancel" | "retry";
    externalActionId?: string;
    localActionId?: string;
    error?: string;
  };

  try {
    const localActionId = payload.localActionId ?? params.id;
    if (payload.operation === "cancel") return NextResponse.json({ action: cancelAction(localActionId) });
    if (payload.operation === "retry") return NextResponse.json({ action: retryAction(localActionId) });

    const status = payload.status ? externalStatusMap[payload.status] ?? payload.status : undefined;
    if (!status || !allowedStatuses.includes(status)) {
      return NextResponse.json({ error: "Unsupported action status" }, { status: 400 });
    }

    const action = setActionStatus(localActionId, status, payload.externalActionId, payload.error);
    return NextResponse.json({ action });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 404 });
  }
}
