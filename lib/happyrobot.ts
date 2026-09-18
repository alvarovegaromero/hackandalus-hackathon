import type { Action, ExecutionMode } from "./types";

interface HappyRobotResult {
  externalActionId: string;
  mode: ExecutionMode;
}

export function getExecutionMode(): ExecutionMode {
  return process.env.ACTION_EXECUTION_MODE === "happyrobot" ? "happyrobot" : "mock";
}

export function isHappyRobotConfigured() {
  return Boolean(
    process.env.HAPPYROBOT_API_KEY &&
      process.env.HAPPYROBOT_BASE_URL &&
      process.env.HAPPYROBOT_AGENT_ID
  );
}

export function validateWebhookSecret(request: Request) {
  const expected = process.env.HAPPYROBOT_WEBHOOK_SECRET;
  if (!expected) return true;
  return request.headers.get("x-happyrobot-secret") === expected;
}

export async function executeHappyRobotAction(action: Action): Promise<HappyRobotResult> {
  const mode = getExecutionMode();

  if (mode === "mock") {
    return {
      externalActionId: `mock-${action.id}`,
      mode
    };
  }

  if (!isHappyRobotConfigured()) {
    throw new Error("HappyRobot credentials are missing. Set HAPPYROBOT_API_KEY, HAPPYROBOT_BASE_URL, and HAPPYROBOT_AGENT_ID.");
  }

  const baseUrl = process.env.HAPPYROBOT_BASE_URL!;
  const idempotencyKey = action.externalActionId ?? action.id;
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/agents/${process.env.HAPPYROBOT_AGENT_ID}/actions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.HAPPYROBOT_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey
    },
    body: JSON.stringify({
      channel: action.channel === "call" ? "voice" : action.channel,
      target: action.target,
      objective: action.objective,
      metadata: {
        localActionId: action.id,
        zoneId: action.zoneId,
        reason: action.reason,
        idempotencyKey
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HappyRobot action failed: ${response.status} ${text}`);
  }

  const body = (await response.json()) as { id?: string; actionId?: string };
  return {
    externalActionId: body.id ?? body.actionId ?? `happyrobot-${action.id}`,
    mode
  };
}
