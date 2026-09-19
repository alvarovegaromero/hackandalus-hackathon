// OWNER: P4 Resource Dispatch transport; reuses the existing HappyRobot configuration.
import { z } from "zod";
import { happyRobotConfig, runEndpoint } from "../happyrobot";

export class DispatchStartError extends Error {
  constructor(
    public readonly status: "failed" | "unknown",
    message: string,
  ) {
    super(message);
  }
}

/** One network attempt only: HappyRobot does not document idempotency guarantees. */
export async function startResourceDispatch(payload: Record<string, unknown>, fetcher = fetch) {
  const config = happyRobotConfig();
  if (!config.apiKey || !config.workflows.dispatch)
    throw new DispatchStartError(
      "failed",
      "HappyRobot API key or dispatch workflow is not configured.",
    );
  try {
    const response = await fetcher(runEndpoint(config.workflows.dispatch, config), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [config.authHeader]: config.authScheme
          ? `${config.authScheme} ${config.apiKey}`
          : config.apiKey,
        [config.idempotencyHeader]: String(payload.dispatch_id),
      },
      body: JSON.stringify({ payload, environment: config.environment }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok)
      throw new DispatchStartError(
        response.status >= 400 && response.status < 500 ? "failed" : "unknown",
        `HappyRobot start returned HTTP ${response.status}.`,
      );
    // Never synthesize a run ID or retry an ambiguous response.
    return z.object({ run_id: z.string().min(1).max(500) }).parse(await response.json()).run_id;
  } catch (error) {
    if (error instanceof DispatchStartError) throw error;
    throw new DispatchStartError(
      "unknown",
      "HappyRobot start outcome is unknown; reconcile the run before retrying.",
    );
  }
}
