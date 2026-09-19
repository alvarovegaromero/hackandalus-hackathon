// OWNER: shared-code demo access and browser session authorization.
import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const DEMO_SESSION_SECONDS = 26 * 60 * 60;
export const DEMO_COOKIE = process.env.NODE_ENV === "production" ? "__Host-faro-demo" : "faro-demo";

export function demoAccessEnabled() {
  return Boolean(
    process.env.DEMO_ACCESS_CODE &&
    process.env.CRISIS_API_TOKEN &&
    process.env.ACTION_EXECUTION_MODE === "mock",
  );
}

function signature(value: string) {
  return createHmac("sha256", process.env.CRISIS_API_TOKEN!)
    .update(JSON.stringify(["faro-demo-v1", process.env.DEMO_ACCESS_CODE, value]))
    .digest("hex");
}

function equal(actual: string, expected: string) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function matchesDemoCode(code: unknown) {
  return (
    demoAccessEnabled() &&
    typeof code === "string" &&
    code.length <= 128 &&
    equal(code, process.env.DEMO_ACCESS_CODE!)
  );
}

export function createDemoSession() {
  if (!demoAccessEnabled()) throw new Error("Demo access is disabled.");
  const expiresAt = Date.now() + DEMO_SESSION_SECONDS * 1000;
  const payload = `${expiresAt}.${randomBytes(16).toString("hex")}`;
  return { value: `${payload}.${signature(payload)}`, expiresAt };
}

export function demoSessionExpiry(value: string | undefined): number | undefined {
  if (!demoAccessEnabled() || !value || value.length > 160) return;
  const match = /^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(value);
  if (!match) return;
  const expiresAt = Number(match[1]);
  if (expiresAt <= Date.now() || expiresAt > Date.now() + DEMO_SESSION_SECONDS * 1000) return;
  if (!equal(match[3], signature(`${match[1]}.${match[2]}`))) return;
  return expiresAt;
}

export function hasDemoSession(request: Request) {
  const prefix = `${DEMO_COOKIE}=`;
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return demoSessionExpiry(cookie?.slice(prefix.length)) !== undefined;
}

/** Cookie-authorized mutations must originate from this application. */
export function requireSameOrigin(request: Request): Response | undefined {
  // Next may reconstruct request.url with an internal hostname behind a proxy.
  // Host is the browser-facing authority and cannot be overridden by browser JS.
  const url = new URL(request.url);
  const origin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (request.headers.get("origin") !== origin) {
    return Response.json({ error: "Same-origin request required." }, { status: 403 });
  }
}

/** Only fixture/reset controls accept this session; general intake keeps Bearer auth. */
export function authorizeDemoControl(request: Request): Response | undefined {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  if (process.env.NODE_ENV === "development") return;
  if (!demoAccessEnabled()) {
    return Response.json({ error: "Demo controls are disabled." }, { status: 404 });
  }
  if (!hasDemoSession(request)) {
    return Response.json({ error: "Unlock the demo to continue." }, { status: 401 });
  }
}
