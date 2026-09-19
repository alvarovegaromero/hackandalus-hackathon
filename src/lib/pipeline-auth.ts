// OWNER: event ingestion and telemetry pipeline.
import { timingSafeEqual } from "node:crypto";
import { hasDemoSession } from "./demo-access";

/** Local demo is open. Configured tokens are always enforced; production fails closed. */
export function authorizePipeline(request: Request): Response | undefined {
  const token = process.env.CRISIS_API_TOKEN;
  if (!token) {
    if (process.env.NODE_ENV !== "production") return;
    return Response.json(
      { error: "Configure CRISIS_API_TOKEN before exposing the pipeline.", code: "no_autorizado" },
      { status: 503 },
    );
  }
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return Response.json({ error: "Unauthorized", code: "no_autorizado" }, { status: 401 });
  }
}

/** Local dashboard reads may use the browser's same-origin context, never a client token. */
export function authorizeDashboardRead(request: Request): Response | undefined {
  if (hasDemoSession(request)) return;
  if (
    process.env.NODE_ENV === "development" &&
    request.headers.get("sec-fetch-site") === "same-origin"
  )
    return;
  return authorizePipeline(request);
}
