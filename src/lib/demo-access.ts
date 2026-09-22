// OWNER: time-limited public demo access.
import "server-only";

export const DEMO_PUBLIC_DURATION_MS = 26 * 60 * 60 * 1000;

/**
 * Read-only showcase after the hackathon: the dashboard renders a frozen snapshot
 * of the last run with no controls and no Supabase dependency. Independent of the
 * timed public window; mutations stay closed because DEMO_PUBLIC_STARTED_AT is unset.
 */
export function isDemoShowcase(): boolean {
  return process.env.DEMO_SHOWCASE === "true";
}

/** A single fixed window shared by every visitor and server instance. */
export function publicDemoExpiresAt(): number | undefined {
  if (!["mock", "happyrobot"].includes(process.env.ACTION_EXECUTION_MODE ?? "")) return;
  const activation = process.env.DEMO_PUBLIC_STARTED_AT;
  if (!activation) return;
  const startedAt = Date.parse(activation);
  if (!Number.isFinite(startedAt) || new Date(startedAt).toISOString() !== activation) return;
  const expiresAt = startedAt + DEMO_PUBLIC_DURATION_MS;
  const now = Date.now();
  if (now < startedAt || now >= expiresAt) return;
  return expiresAt;
}

/** Public demo mutations must originate from this application. */
export function requireSameOrigin(request: Request): Response | undefined {
  // Next may reconstruct request.url with an internal hostname behind a proxy.
  // Host is the browser-facing authority and cannot be overridden by browser JS.
  const url = new URL(request.url);
  const origin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (request.headers.get("origin") !== origin) {
    return Response.json({ error: "Same-origin request required." }, { status: 403 });
  }
}

/** Only fixture/reset controls are public during the window; intake keeps Bearer auth. */
export function authorizeDemoControl(request: Request): Response | undefined {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  if (process.env.ACTION_EXECUTION_MODE === "happyrobot") {
    return Response.json({ error: "Demo controls are disabled in live mode." }, { status: 403 });
  }
  if (process.env.NODE_ENV === "development") return;
  if (!publicDemoExpiresAt()) {
    return Response.json({ error: "The public demo is closed." }, { status: 403 });
  }
}
